import { gunzipSync, inflateRawSync } from 'zlib';

/**
 * DMARC aggregate (RUA) report decoding, with no third-party dependencies.
 *
 * Reports arrive as .xml, .xml.gz or .zip attachments (RFC 7489 appendix C).
 * This module unpacks them and pulls out the fields needed to answer
 * "did anything fail, and who sent it?".
 *
 * Every input path is bounded by {@link DMARC_LIMITS} through a shared
 * {@link DecodeBudget}: raw attachment size, ZIP entry count, the decoded size
 * of each document (raw XML, gzip, stored and deflated ZIP entries alike), and
 * the total decoded bytes per request. Limits are checked before decompressing
 * or parsing wherever the size is known up front, and enforced during
 * decompression where it isn't.
 */
export const DMARC_LIMITS = {
  /** Largest attachment accepted, compressed or not. Real reports are a few KB. */
  maxAttachmentBytes: 5 * 1024 * 1024,
  /** Largest single decoded XML document (any format). */
  maxReportBytes: 20 * 1024 * 1024,
  /** Most files read from one ZIP archive. Reports contain exactly one. */
  maxZipEntries: 16,
  /** Total decoded XML bytes across all attachments in one request. */
  maxTotalDecodedBytes: 40 * 1024 * 1024,
} as const;

export type DmarcLimits = { -readonly [K in keyof typeof DMARC_LIMITS]: number };

/** Tracks the per-request decoded-bytes budget. */
export class DecodeBudget {
  readonly limits: DmarcLimits;
  private used = 0;

  constructor(limits: Partial<DmarcLimits> = {}) {
    this.limits = { ...DMARC_LIMITS, ...limits };
  }

  get remaining(): number {
    return Math.max(0, this.limits.maxTotalDecodedBytes - this.used);
  }

  /** Most bytes the next document may decode to. */
  get nextDocumentCap(): number {
    return Math.min(this.limits.maxReportBytes, this.remaining);
  }

  /** Reserve `bytes` of decoded output, or throw if it doesn't fit. */
  take(bytes: number, what: string): void {
    if (bytes > this.limits.maxReportBytes) {
      throw new Error(`${what} is ${bytes} bytes decoded, over the per-report limit of ${this.limits.maxReportBytes}`);
    }
    if (bytes > this.remaining) {
      throw new Error(`${what} would exceed the per-request decoded limit of ${this.limits.maxTotalDecodedBytes} bytes`);
    }
    this.used += bytes;
  }
}

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
  if (!value || !/^\d{1,12}$/.test(value)) return undefined;
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

/** Parse one DMARC aggregate report XML document (already size-checked). */
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

/** Decompress with zlib, capping output at `cap` bytes. */
function decompressCapped(fn: typeof gunzipSync, input: Buffer, cap: number, what: string): Buffer {
  try {
    // One byte of headroom distinguishes "exactly at the cap" from "over it".
    const out = fn(input, { maxOutputLength: cap + 1 });
    if (out.length > cap) throw new RangeError('over cap');
    return out;
  } catch (err: any) {
    if (err instanceof RangeError || err?.code === 'ERR_BUFFER_TOO_LARGE') {
      throw new Error(`${what} decompresses to more than the allowed ${cap} bytes`);
    }
    throw err;
  }
}

/**
 * Minimal ZIP reader: returns the files inside, using the central directory so
 * entries written with data descriptors (sizes only after the data) work too.
 * Supports stored (0) and deflate (8), which is all report senders use.
 * Entry count, every entry's decoded size and the request total are checked
 * against `budget`, and every offset is bounds-checked against the buffer.
 */
export function unzipEntries(buf: Buffer, budget: DecodeBudget = new DecodeBudget()): Array<{ name: string; data: Buffer }> {
  const fail = (msg: string): never => { throw new Error(`Invalid ZIP: ${msg}`); };
  const u16 = (o: number) => (o + 2 <= buf.length ? buf.readUInt16LE(o) : fail('truncated'));
  const u32 = (o: number) => (o + 4 <= buf.length ? buf.readUInt32LE(o) : fail('truncated'));

  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 0xffff); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) fail('end of central directory not found');
  const entryCount = u16(eocd + 10);
  if (entryCount > budget.limits.maxZipEntries) {
    throw new Error(`ZIP has ${entryCount} entries, over the limit of ${budget.limits.maxZipEntries}`);
  }

  let p = u32(eocd + 16);
  const out: Array<{ name: string; data: Buffer }> = [];
  for (let n = 0; n < entryCount; n++) {
    if (u32(p) !== 0x02014b50) fail('bad central directory entry');
    const flags = u16(p + 8);
    const method = u16(p + 10);
    const compSize = u32(p + 20);
    const size = u32(p + 24);
    const nameLen = u16(p + 28);
    const extraLen = u16(p + 30);
    const commentLen = u16(p + 32);
    const localOffset = u32(p + 42);
    if (p + 46 + nameLen > buf.length) fail('truncated');
    const name = buf.subarray(p + 46, p + 46 + nameLen).toString('utf8');
    p += 46 + nameLen + extraLen + commentLen;

    if (name.endsWith('/')) continue; // directory
    if (flags & 0x1) throw new Error(`Encrypted ZIP entry ${name} is not supported`);
    if (u32(localOffset) !== 0x04034b50) fail('bad local header');
    const dataStart = localOffset + 30 + u16(localOffset + 26) + u16(localOffset + 28);
    if (dataStart + compSize > buf.length) fail('entry data out of range');
    const raw = buf.subarray(dataStart, dataStart + compSize);

    // The declared size is untrusted, but checking it first refuses honest
    // oversized entries before any work; the actual size is enforced below.
    const cap = budget.nextDocumentCap;
    if (size > cap) throw new Error(`ZIP entry ${name} declares ${size} bytes, over the allowed ${cap}`);

    let data: Buffer;
    if (method === 0) {
      if (raw.length > cap) throw new Error(`ZIP entry ${name} is ${raw.length} bytes, over the allowed ${cap}`);
      data = Buffer.from(raw);
    } else if (method === 8) {
      data = decompressCapped(inflateRawSync, raw, cap, `ZIP entry ${name}`);
    } else {
      throw new Error(`Unsupported ZIP compression method ${method} in ${name}`);
    }
    budget.take(data.length, `ZIP entry ${name}`);
    out.push({ name, data });
  }
  return out;
}

/**
 * Turn one attachment into the DMARC XML documents it contains, within
 * `budget`. Detects the format from magic bytes first, then the filename.
 * Returns [] for attachments that aren't reports.
 */
export function extractDmarcXml(
  content: Buffer,
  filename = '',
  budget: DecodeBudget = new DecodeBudget()
): Array<{ name: string; xml: string }> {
  const lower = filename.toLowerCase();
  const isZip = content.length >= 4 && content.readUInt32LE(0) === 0x04034b50;
  const isGzip = content.length >= 2 && content[0] === 0x1f && content[1] === 0x8b;
  const isXml = !isZip && !isGzip &&
    (lower.endsWith('.xml') || /^\s*(<\?xml|<feedback)/.test(content.subarray(0, 200).toString('utf8')));
  if (!isZip && !isGzip && !isXml) return [];

  if (content.length > budget.limits.maxAttachmentBytes) {
    throw new Error(`Attachment ${filename || '(unnamed)'} is ${content.length} bytes, over the limit of ${budget.limits.maxAttachmentBytes}`);
  }

  if (isZip) {
    return unzipEntries(content, budget)
      .filter(e => e.name.toLowerCase().endsWith('.xml'))
      .map(e => ({ name: e.name, xml: e.data.toString('utf8') }));
  }
  if (isGzip) {
    const data = decompressCapped(gunzipSync, content, budget.nextDocumentCap, filename || 'gzip attachment');
    budget.take(data.length, filename || 'gzip attachment');
    return [{ name: filename.replace(/\.gz$/i, ''), xml: data.toString('utf8') }];
  }
  budget.take(content.length, filename || 'XML attachment');
  return [{ name: filename, xml: content.toString('utf8') }];
}
