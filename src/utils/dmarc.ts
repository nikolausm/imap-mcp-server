import { gunzipSync, inflateRawSync } from 'zlib';

/**
 * DMARC aggregate (RUA) report decoding, with no third-party dependencies.
 *
 * Reports arrive as .xml, .xml.gz or .zip attachments (RFC 7489 appendix C).
 * This module unpacks them and pulls out the fields needed to answer
 * "did anything fail, and who sent it?".
 */

/** Hard cap on decompressed size per report, to defuse zip/gzip bombs. */
export const MAX_REPORT_BYTES = 20 * 1024 * 1024;

export interface DmarcAuthResult {
  domain?: string;
  result?: string;
  selector?: string;
}

export interface DmarcRecord {
  sourceIp: string;
  count: number;
  disposition?: string;
  dkim?: string; // policy_evaluated (aligned) result
  spf?: string; // policy_evaluated (aligned) result
  dmarc: 'pass' | 'fail';
  headerFrom?: string;
  dkimAuth: DmarcAuthResult[];
  spfAuth: DmarcAuthResult[];
  hostname?: string;
}

export interface DmarcReport {
  orgName?: string;
  reportId?: string;
  begin?: string; // ISO date-time (UTC)
  end?: string;
  domain?: string;
  policy?: string;
  subdomainPolicy?: string;
  pct?: string;
  totals: {
    messages: number;
    dmarcPass: number;
    dmarcFail: number;
    dkimFail: number; // aligned DKIM failed (SPF may still have passed)
    spfFail: number; // aligned SPF failed (DKIM may still have passed)
  };
  records: DmarcRecord[];
}

const decodeEntities = (s: string): string =>
  s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');

/** All inner texts of <name>…</name> (namespace prefixes tolerated). */
function tags(xml: string, name: string): string[] {
  const re = new RegExp(`<(?:[\\w-]+:)?${name}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:[\\w-]+:)?${name}>`, 'g');
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) out.push(m[1]);
  return out;
}

function tag(xml: string | undefined, name: string): string | undefined {
  if (!xml) return undefined;
  const v = tags(xml, name)[0];
  return v === undefined ? undefined : decodeEntities(v.trim());
}

function epochToIso(value: string | undefined): string | undefined {
  if (!value || !/^\d+$/.test(value)) return undefined;
  return new Date(Number(value) * 1000).toISOString();
}

function authResults(block: string | undefined, name: 'dkim' | 'spf'): DmarcAuthResult[] {
  if (!block) return [];
  return tags(block, name).map(b => ({
    domain: tag(b, 'domain'),
    result: tag(b, 'result'),
    selector: tag(b, 'selector'),
  }));
}

/** Parse one DMARC aggregate report XML document. */
export function parseDmarcXml(xml: string): DmarcReport {
  if (!/<(?:[\w-]+:)?feedback[\s>]/.test(xml)) {
    throw new Error('Not a DMARC aggregate report (no <feedback> element)');
  }
  const meta = tags(xml, 'report_metadata')[0];
  const range = meta ? tags(meta, 'date_range')[0] : undefined;
  const policy = tags(xml, 'policy_published')[0];

  const records: DmarcRecord[] = tags(xml, 'record').map(rec => {
    const row = tags(rec, 'row')[0];
    const evaluated = row ? tags(row, 'policy_evaluated')[0] : undefined;
    const dkim = tag(evaluated, 'dkim');
    const spf = tag(evaluated, 'spf');
    const auth = tags(rec, 'auth_results')[0];
    return {
      sourceIp: tag(row, 'source_ip') ?? '',
      count: Number(tag(row, 'count') ?? '0') || 0,
      disposition: tag(evaluated, 'disposition'),
      dkim,
      spf,
      dmarc: dkim === 'pass' || spf === 'pass' ? 'pass' : 'fail',
      headerFrom: tag(tags(rec, 'identifiers')[0], 'header_from'),
      dkimAuth: authResults(auth, 'dkim'),
      spfAuth: authResults(auth, 'spf'),
    };
  });

  const totals = { messages: 0, dmarcPass: 0, dmarcFail: 0, dkimFail: 0, spfFail: 0 };
  for (const r of records) {
    totals.messages += r.count;
    if (r.dmarc === 'pass') totals.dmarcPass += r.count;
    else totals.dmarcFail += r.count;
    if (r.dkim !== 'pass') totals.dkimFail += r.count;
    if (r.spf !== 'pass') totals.spfFail += r.count;
  }

  return {
    orgName: tag(meta, 'org_name'),
    reportId: tag(meta, 'report_id'),
    begin: epochToIso(tag(range, 'begin')),
    end: epochToIso(tag(range, 'end')),
    domain: tag(policy, 'domain'),
    policy: tag(policy, 'p'),
    subdomainPolicy: tag(policy, 'sp'),
    pct: tag(policy, 'pct'),
    totals,
    records,
  };
}

/**
 * Minimal ZIP reader: returns the files inside, using the central directory so
 * entries written with data descriptors (sizes only after the data) work too.
 * Supports stored (0) and deflate (8), which is all report senders use.
 */
export function unzipEntries(buf: Buffer): Array<{ name: string; data: Buffer }> {
  const EOCD = 0x06054b50;
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 0xffff); i--) {
    if (buf.readUInt32LE(i) === EOCD) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('Invalid ZIP: end of central directory not found');
  const entryCount = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const out: Array<{ name: string; data: Buffer }> = [];
  for (let n = 0; n < entryCount; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('Invalid ZIP: bad central directory entry');
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOffset = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nameLen).toString('utf8');
    p += 46 + nameLen + extraLen + commentLen;

    if (name.endsWith('/')) continue; // directory
    if (buf.readUInt32LE(localOffset) !== 0x04034b50) throw new Error('Invalid ZIP: bad local header');
    const dataStart = localOffset + 30 + buf.readUInt16LE(localOffset + 26) + buf.readUInt16LE(localOffset + 28);
    const raw = buf.subarray(dataStart, dataStart + compSize);
    let data: Buffer;
    if (method === 0) data = Buffer.from(raw);
    else if (method === 8) data = inflateRawSync(raw, { maxOutputLength: MAX_REPORT_BYTES });
    else throw new Error(`Unsupported ZIP compression method ${method} in ${name}`);
    out.push({ name, data });
  }
  return out;
}

/**
 * Turn one attachment into the DMARC XML documents it contains.
 * Detects the format from magic bytes first, then the filename.
 */
export function extractDmarcXml(content: Buffer, filename = ''): Array<{ name: string; xml: string }> {
  const lower = filename.toLowerCase();
  if (content.length >= 4 && content.readUInt32LE(0) === 0x04034b50) {
    return unzipEntries(content)
      .filter(e => e.name.toLowerCase().endsWith('.xml'))
      .map(e => ({ name: e.name, xml: e.data.toString('utf8') }));
  }
  if (content.length >= 2 && content[0] === 0x1f && content[1] === 0x8b) {
    const xml = gunzipSync(content, { maxOutputLength: MAX_REPORT_BYTES }).toString('utf8');
    return [{ name: filename.replace(/\.gz$/i, ''), xml }];
  }
  if (lower.endsWith('.xml') || /^\s*(<\?xml|<feedback)/.test(content.subarray(0, 200).toString('utf8'))) {
    return [{ name: filename, xml: content.toString('utf8') }];
  }
  return [];
}
