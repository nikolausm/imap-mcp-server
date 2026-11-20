import { describe, it, expect, vi, beforeEach } from 'vitest';
import { gzipSync, deflateRawSync, crc32 } from 'zlib';
import { parseDmarcXml, extractDmarcXml, unzipEntries } from '../src/utils/dmarc.js';
import { dmarcTools } from '../src/tools/dmarc-tools.js';

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
