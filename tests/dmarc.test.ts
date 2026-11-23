import { describe, it, expect, vi, beforeEach } from 'vitest';
import { gzipSync, deflateRawSync, crc32 } from 'zlib';
import { parseDmarcXml, extractDmarcXml, unzipEntries, DecodeBudget, DMARC_LIMITS } from '../src/utils/dmarc.js';
import { dmarcTools, DMARC_TOOL_LIMITS } from '../src/tools/dmarc-tools.js';

// A Microsoft-style aggregate report: one clean Titan record, one record where
// aligned DKIM failed but SPF passed (so DMARC still passes), and one full fail.
const SAMPLE_XML = `<?xml version="1.0"?>
<feedback xmlns="urn:ietf:params:xml:ns:dmarc-2.0">
  <report_metadata>
    <org_name>Enterprise Outlook</org_name>
    <email>dmarcreport@microsoft.com</email>
    <report_id>966d138a62474f22a70181e0ca142b93</report_id>
    <date_range><begin>1794960000</begin><end>1795046400</end></date_range>
  </report_metadata>
  <policy_published>
    <domain>example.com</domain><adkim>r</adkim><aspf>r</aspf><p>none</p><sp>none</sp><pct>100</pct>
  </policy_published>
  <record>
    <row><source_ip>3.93.85.209</source_ip><count>3</count>
      <policy_evaluated><disposition>none</disposition><dkim>pass</dkim><spf>pass</spf></policy_evaluated></row>
    <identifiers><envelope_from>example.com</envelope_from><header_from>example.com</header_from></identifiers>
    <auth_results><dkim><domain>example.com</domain><selector>titan1</selector><result>pass</result></dkim>
      <spf><domain>example.com</domain><scope>mfrom</scope><result>pass</result></spf></auth_results>
  </record>
  <record>
    <row><source_ip>209.209.25.128</source_ip><count>1</count>
      <policy_evaluated><disposition>none</disposition><dkim>fail</dkim><spf>pass</spf></policy_evaluated></row>
    <identifiers><header_from>example.com</header_from></identifiers>
    <auth_results><dkim><domain>example.com</domain><result>fail</result></dkim>
      <spf><domain>example.com</domain><result>pass</result></spf></auth_results>
  </record>
  <record>
    <row><source_ip>198.51.100.7</source_ip><count>2</count>
      <policy_evaluated><disposition>none</disposition><dkim>fail</dkim><spf>fail</spf></policy_evaluated></row>
    <identifiers><header_from>example.com</header_from></identifiers>
    <auth_results><spf><domain>spammer.test</domain><result>softfail</result></spf></auth_results>
  </record>
</feedback>`;

/** Build a ZIP the way Google does: deflate + data descriptor (sizes zeroed in the local header). */
function makeZip(name: string, content: Buffer): Buffer {
  const data = deflateRawSync(content);
  const crc = crc32(content);
  const nameBuf = Buffer.from(name);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(0x08, 6); // bit 3: data descriptor follows
  local.writeUInt16LE(8, 8);
  local.writeUInt16LE(nameBuf.length, 26);
  const descriptor = Buffer.alloc(16);
  descriptor.writeUInt32LE(0x08074b50, 0);
  descriptor.writeUInt32LE(crc, 4);
  descriptor.writeUInt32LE(data.length, 8);
  descriptor.writeUInt32LE(content.length, 12);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(0x08, 8);
  central.writeUInt16LE(8, 10);
  central.writeUInt32LE(crc, 16);
  central.writeUInt32LE(data.length, 20);
  central.writeUInt32LE(content.length, 24);
  central.writeUInt16LE(nameBuf.length, 28);
  central.writeUInt32LE(0, 42);
  const cdOffset = local.length + nameBuf.length + data.length + descriptor.length;
  const cdSize = central.length + nameBuf.length;
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(1, 8);
  eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(cdSize, 12);
  eocd.writeUInt32LE(cdOffset, 16);
  return Buffer.concat([local, nameBuf, data, descriptor, central, nameBuf, eocd]);
}

describe('parseDmarcXml', () => {
  it('extracts metadata, policy and per-record results', () => {
    const r = parseDmarcXml(SAMPLE_XML);
    expect(r.orgName).toBe('Enterprise Outlook');
    expect(r.reportId).toBe('966d138a62474f22a70181e0ca142b93');
    expect(r.begin).toBe('2026-11-18T00:00:00.000Z');
    expect(r.domain).toBe('example.com');
    expect(r.policy).toBe('none');
    expect(r.records).toHaveLength(3);
    expect(r.records[0]).toMatchObject({ sourceIp: '3.93.85.209', count: 3, dkim: 'pass', spf: 'pass', dmarc: 'pass', headerFrom: 'example.com' });
    expect(r.records[0].dkimAuth[0]).toEqual({ domain: 'example.com', result: 'pass', selector: 'titan1' });
  });

  it('treats DKIM-fail/SPF-pass as a DMARC pass but counts the DKIM failure', () => {
    const r = parseDmarcXml(SAMPLE_XML);
    expect(r.records[1].dmarc).toBe('pass');
    expect(r.records[2].dmarc).toBe('fail');
    expect(r.totals).toEqual({ messages: 6, dmarcPass: 4, dmarcFail: 2, dkimFail: 3, spfFail: 2 });
  });

  it('rejects documents that are not DMARC reports', () => {
    expect(() => parseDmarcXml('<html><body>hi</body></html>')).toThrow(/Not a DMARC aggregate report/);
  });
});

describe('extractDmarcXml', () => {
  it('reads .xml.gz attachments', () => {
    const docs = extractDmarcXml(gzipSync(SAMPLE_XML), 'outlook.com!example.com!1!2.xml.gz');
    expect(docs).toHaveLength(1);
    expect(docs[0].name).toBe('outlook.com!example.com!1!2.xml');
    expect(parseDmarcXml(docs[0].xml).records).toHaveLength(3);
  });

  it('reads .zip attachments written with a data descriptor', () => {
    const zip = makeZip('google.com!example.com!1!2.xml', Buffer.from(SAMPLE_XML));
    expect(unzipEntries(zip)[0].name).toBe('google.com!example.com!1!2.xml');
    const docs = extractDmarcXml(zip, 'google.com!example.com!1!2.zip');
    expect(docs).toHaveLength(1);
    expect(parseDmarcXml(docs[0].xml).orgName).toBe('Enterprise Outlook');
  });

  it('reads plain .xml and ignores unrelated attachments', () => {
    expect(extractDmarcXml(Buffer.from(SAMPLE_XML), 'report.xml')).toHaveLength(1);
    expect(extractDmarcXml(Buffer.from('%PDF-1.7 ...'), 'invoice.pdf')).toEqual([]);
  });

  it('refuses a gzip bomb beyond the size cap', () => {
    const bomb = gzipSync(Buffer.alloc(25 * 1024 * 1024, 0x20));
    expect(() => extractDmarcXml(bomb, 'x.xml.gz')).toThrow();
  });
});

describe('imap_get_dmarc_report tool', () => {
  let handler: Function;
  const mockServer = {
    registerTool: vi.fn((name: string, _schema: any, h: Function) => {
      if (name === 'imap_get_dmarc_report') handler = h;
    }),
  };
  const mockImapService = { getAllAttachments: vi.fn() };
  const mockAccountManager = { resolveAccountId: (id: string) => id };

  beforeEach(() => {
    vi.clearAllMocks();
    dmarcTools(mockServer as any, mockImapService as any, mockAccountManager as any);
  });

  it('summarizes several reports and lists failing sources once', async () => {
    mockImapService.getAllAttachments
      .mockResolvedValueOnce([{ filename: 'a.xml.gz', contentType: 'application/gzip', content: gzipSync(SAMPLE_XML) }])
      .mockResolvedValueOnce([{ filename: 'b.zip', contentType: 'application/zip', content: makeZip('b.xml', Buffer.from(SAMPLE_XML)) }]);

    const res = await handler({ accountId: 'acc', folder: 'INBOX', uid: [1, 2], detail: 'issues', resolveHostnames: false });
    const out = JSON.parse(res.content[0].text);
    expect(out.success).toBe(true);
    expect(out.reportCount).toBe(2);
    expect(out.allPass).toBe(false);
    expect(out.totals.messages).toBe(12);
    expect(out.issues.map((i: any) => i.sourceIp).sort()).toEqual(['198.51.100.7', '209.209.25.128']);
    expect(out.issues.find((i: any) => i.sourceIp === '209.209.25.128')).toMatchObject({ messages: 2, dkimFail: 2, spfFail: 0, dmarcFail: 0 });
    // detail=issues hides the clean record
    expect(out.reports[0].records).toHaveLength(2);
  });

  it('returns every record with detail=full and reports allPass for a clean report', async () => {
    const clean = SAMPLE_XML.replace(/<record>[\s\S]*<\/record>/, m => m.split('</record>')[0] + '</record>');
    mockImapService.getAllAttachments.mockResolvedValueOnce([{ filename: 'c.xml', contentType: 'text/xml', content: Buffer.from(clean) }]);
    const res = await handler({ accountId: 'acc', folder: 'INBOX', uid: 3, detail: 'full', resolveHostnames: false });
    const out = JSON.parse(res.content[0].text);
    expect(out.allPass).toBe(true);
    expect(out.issues).toEqual([]);
    expect(out.reports[0].records).toHaveLength(1);
  });

  it('reports emails without a usable attachment as errors instead of throwing', async () => {
    mockImapService.getAllAttachments
      .mockResolvedValueOnce([])
      .mockRejectedValueOnce(new Error('Email with UID 9 not found'));
    const res = await handler({ accountId: 'acc', folder: 'INBOX', uid: [8, 9], detail: 'issues', resolveHostnames: false });
    const out = JSON.parse(res.content[0].text);
    expect(out.success).toBe(false);
    expect(out.reportCount).toBe(0);
    expect(out.allPass).toBe(false);
    expect(out.errors).toHaveLength(2);
    expect(out.errors[1].error).toMatch(/not found/);
  });
});

// ---------------------------------------------------------------------------
// Limits (PR review: every input path must be bounded)
// ---------------------------------------------------------------------------

/** ZIP builder with control over method, entry count and the declared (untrusted) size. */
function makeZipEntries(
  entries: Array<{ name: string; content: Buffer; method?: 0 | 8; declaredSize?: number; flags?: number }>
): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const e of entries) {
    const method = e.method ?? 8;
    const data = method === 8 ? deflateRawSync(e.content) : e.content;
    const nameBuf = Buffer.from(e.name);
    const declared = e.declaredSize ?? e.content.length;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(e.flags ?? 0, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(crc32(e.content), 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(declared, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(e.flags ?? 0, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(crc32(e.content), 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(declared, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, nameBuf, data);
    centrals.push(central, nameBuf);
    offset += local.length + nameBuf.length + data.length;
  }
  const cd = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, eocd]);
}

/** A valid report padded with an XML comment to roughly `bytes`. */
const reportOfSize = (bytes: number) =>
  Buffer.from(SAMPLE_XML.replace('<feedback', `<!--${'x'.repeat(Math.max(0, bytes - SAMPLE_XML.length - 7))}--><feedback`));

const small = () => new DecodeBudget({ maxAttachmentBytes: 64 * 1024, maxReportBytes: 16 * 1024, maxZipEntries: 3, maxTotalDecodedBytes: 40 * 1024 });

describe('DMARC decode limits', () => {
  it('documents its defaults', () => {
    expect(DMARC_LIMITS).toMatchObject({ maxReportBytes: 20 * 1024 * 1024, maxZipEntries: 16 });
    expect(DMARC_LIMITS.maxAttachmentBytes).toBeLessThanOrEqual(DMARC_LIMITS.maxReportBytes);
  });

  describe('raw XML', () => {
    it('accepts a report at the per-report limit', () => {
      const xml = reportOfSize(16 * 1024);
      expect(xml.length).toBe(16 * 1024);
      expect(extractDmarcXml(xml, 'r.xml', small())).toHaveLength(1);
    });
    it('refuses a report over the per-report limit', () => {
      expect(() => extractDmarcXml(reportOfSize(16 * 1024 + 1), 'r.xml', small())).toThrow(/per-report limit/);
    });
    it('refuses an attachment over the attachment limit before decoding', () => {
      expect(() => extractDmarcXml(reportOfSize(64 * 1024 + 1), 'r.xml', small())).toThrow(/over the limit of 65536/);
    });
  });

  describe('gzip', () => {
    it('accepts output at the per-report limit', () => {
      expect(extractDmarcXml(gzipSync(reportOfSize(16 * 1024)), 'r.xml.gz', small())).toHaveLength(1);
    });
    it('refuses output over the per-report limit', () => {
      expect(() => extractDmarcXml(gzipSync(reportOfSize(16 * 1024 + 1)), 'r.xml.gz', small())).toThrow(/more than the allowed 16384/);
    });
    it('refuses a compressed attachment over the attachment limit', () => {
      const b = new DecodeBudget({ maxAttachmentBytes: 100 });
      expect(() => extractDmarcXml(gzipSync(SAMPLE_XML), 'r.xml.gz', b)).toThrow(/over the limit of 100/);
    });
  });

  describe('zip', () => {
    it('refuses too many entries before decoding any', () => {
      const zip = makeZipEntries(Array.from({ length: 4 }, (_, i) => ({ name: `${i}.xml`, content: Buffer.from(SAMPLE_XML) })));
      expect(() => extractDmarcXml(zip, 'r.zip', small())).toThrow(/4 entries, over the limit of 3/);
    });
    it('refuses a stored entry over the limit even when its declared size lies', () => {
      const zip = makeZipEntries([{ name: 'r.xml', content: reportOfSize(16 * 1024 + 1), method: 0, declaredSize: 10 }]);
      expect(() => extractDmarcXml(zip, 'r.zip', small())).toThrow(/over the allowed 16384/);
    });
    it('refuses a deflated entry over the limit even when its declared size lies', () => {
      const zip = makeZipEntries([{ name: 'r.xml', content: reportOfSize(16 * 1024 + 1), declaredSize: 10 }]);
      expect(() => extractDmarcXml(zip, 'r.zip', small())).toThrow(/more than the allowed 16384/);
    });
    it('refuses an entry whose honest declared size is over the limit without inflating it', () => {
      const zip = makeZipEntries([{ name: 'r.xml', content: reportOfSize(16 * 1024 + 1) }]);
      expect(() => extractDmarcXml(zip, 'r.zip', small())).toThrow(/declares 16385 bytes/);
    });
    it('accepts stored and deflated entries within the limit', () => {
      const zip = makeZipEntries([
        { name: 'a.xml', content: Buffer.from(SAMPLE_XML), method: 0 },
        { name: 'b.xml', content: Buffer.from(SAMPLE_XML) },
      ]);
      expect(extractDmarcXml(zip, 'r.zip', small())).toHaveLength(2);
    });
    it('rejects encrypted entries and out-of-range offsets', () => {
      expect(() => extractDmarcXml(makeZipEntries([{ name: 'r.xml', content: Buffer.from(SAMPLE_XML), flags: 1 }]), 'r.zip', small()))
        .toThrow(/Encrypted/);
      const zip = makeZipEntries([{ name: 'r.xml', content: Buffer.from(SAMPLE_XML) }]);
      zip.writeUInt32LE(0xfffff, zip.length - 22 - 46 - 5 + 20); // central dir compSize far past the end
      expect(() => extractDmarcXml(zip, 'r.zip', small())).toThrow(/Invalid ZIP/);
    });
  });

  describe('per-request total', () => {
    it('stops once the decoded total is used up, across attachments and formats', () => {
      const b = small(); // 40 KiB total, 16 KiB per report
      const doc = reportOfSize(15 * 1024);
      expect(extractDmarcXml(doc, 'a.xml', b)).toHaveLength(1);
      expect(extractDmarcXml(gzipSync(doc), 'b.xml.gz', b)).toHaveLength(1);
      // 30 KiB used, 10 KiB left: a 15 KiB entry no longer fits
      expect(() => extractDmarcXml(makeZipEntries([{ name: 'c.xml', content: doc }]), 'c.zip', b)).toThrow(/allowed 10240/);
      expect(() => extractDmarcXml(doc, 'd.xml', b)).toThrow(/per-request decoded limit/);
      expect(b.remaining).toBe(10 * 1024);
    });
  });
});

describe('imap_get_dmarc_report request limits', () => {
  let handler: Function;
  const mockServer = { registerTool: vi.fn((name: string, _s: any, h: Function) => { if (name === 'imap_get_dmarc_report') handler = h; }) };
  const mockImapService = { getAllAttachments: vi.fn() };
  beforeEach(() => {
    vi.clearAllMocks();
    dmarcTools(mockServer as any, mockImapService as any, { resolveAccountId: (id: string) => id } as any);
  });

  it('refuses more UIDs than allowed without reading mail', async () => {
    const uids = Array.from({ length: DMARC_TOOL_LIMITS.maxUidsPerCall + 1 }, (_, i) => i + 1);
    const out = JSON.parse((await handler({ accountId: 'a', folder: 'INBOX', uid: uids, detail: 'issues', resolveHostnames: false })).content[0].text);
    expect(out.success).toBe(false);
    expect(out.error).toMatch(/at most 50/);
    expect(mockImapService.getAllAttachments).not.toHaveBeenCalled();
  });

  it('reports an oversized attachment as an error for that email and keeps going', async () => {
    mockImapService.getAllAttachments
      .mockResolvedValueOnce([{ filename: 'bomb.xml.gz', contentType: 'application/gzip', content: gzipSync(Buffer.alloc(DMARC_LIMITS.maxReportBytes + 1, 0x20)) }])
      .mockResolvedValueOnce([{ filename: 'ok.xml', contentType: 'text/xml', content: Buffer.from(SAMPLE_XML) }]);
    const out = JSON.parse((await handler({ accountId: 'a', folder: 'INBOX', uid: [1, 2], detail: 'issues', resolveHostnames: false })).content[0].text);
    expect(out.success).toBe(false);
    expect(out.allPass).toBe(false);
    expect(out.reportCount).toBe(1);
    expect(out.errors[0]).toMatchObject({ uid: 1, attachment: 'bomb.xml.gz' });
  });

  it('caps the records returned and says so', async () => {
    const many = SAMPLE_XML.replace(/<record>[\s\S]*<\/record>/, m => {
      const fail = m.split('</record>')[2] + '</record>'; // the full-fail record
      return Array.from({ length: DMARC_TOOL_LIMITS.maxRecordsReturned + 5 }, (_, i) => fail.replace('198.51.100.7', `10.0.${Math.floor(i / 256)}.${i % 256}`)).join('');
    });
    mockImapService.getAllAttachments.mockResolvedValueOnce([{ filename: 'm.xml', contentType: 'text/xml', content: Buffer.from(many) }]);
    const out = JSON.parse((await handler({ accountId: 'a', folder: 'INBOX', uid: 1, detail: 'full', resolveHostnames: false })).content[0].text);
    expect(out.reports[0].records).toHaveLength(DMARC_TOOL_LIMITS.maxRecordsReturned);
    expect(out.recordsTruncated).toBe(true);
    expect(out.issuesTruncated).toBe(true);
    expect(out.issues).toHaveLength(DMARC_TOOL_LIMITS.maxRecordsReturned);
    expect(out.totals.messages).toBe(2 * (DMARC_TOOL_LIMITS.maxRecordsReturned + 5));
  });
});
