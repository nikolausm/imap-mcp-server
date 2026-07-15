import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { emailTools } from '../src/tools/email-tools.js';
import { tmpdir } from 'os';
import { join } from 'path';
import { existsSync, rmSync, readFileSync } from 'fs';

// Build a minimal, valid single-page PDF whose page renders `text`.
// pdf.js reconstructs the xref table when missing, so a hand-written body is enough.
function makePdf(text: string): Buffer {
  const stream = `BT /F1 24 Tf 72 700 Td (${text}) Tj ET`;
  const pdf = `%PDF-1.4
1 0 obj
<< /Type /Catalog /Pages 2 0 R >>
endobj
2 0 obj
<< /Type /Pages /Kids [3 0 R] /Count 1 >>
endobj
3 0 obj
<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>
endobj
4 0 obj
<< /Length ${stream.length} >>
stream
${stream}
endstream
endobj
5 0 obj
<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>
endobj
trailer
<< /Root 1 0 R /Size 6 >>
%%EOF`;
  return Buffer.from(pdf, 'latin1');
}

let downloadHandler: Function;

const mockServer = {
  registerTool: vi.fn((name: string, _schema: any, handler: Function) => {
    if (name === 'imap_download_attachment') downloadHandler = handler;
  }),
};

const mockImapService = { getAttachmentContent: vi.fn() };
const mockAccountManager = { resolveAccountId: (id: string) => id };
const mockSmtpService = {};

describe('imap_download_attachment PDF text extraction (pdf-parse v2)', () => {
  // Keep writes inside the temp dir so the test has no side effects on the real downloads folder.
  const savePath = join(tmpdir(), `imap-pdf-extract-${process.pid}.pdf`);

  beforeEach(() => {
    vi.clearAllMocks();
    emailTools(
      mockServer as any,
      mockImapService as any,
      mockAccountManager as any,
      mockSmtpService as any,
    );
  });

  afterEach(() => {
    if (existsSync(savePath)) rmSync(savePath);
  });

  it('should be registered', () => {
    expect(downloadHandler).toBeDefined();
  });

  it('extracts text and page count from a PDF attachment, and saves the file', async () => {
    mockImapService.getAttachmentContent.mockResolvedValueOnce({
      content: makePdf('Hello PDF Migration Test'),
      contentType: 'application/pdf',
      filename: 'invoice.pdf',
    });

    const result = await downloadHandler({
      accountId: 'acc1',
      folder: 'INBOX',
      uid: 1,
      filename: 'invoice.pdf',
      savePath,
      extractText: true,
    });

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.saved).toBe(true);
    expect(parsed.filename).toBe('invoice.pdf');
    expect(parsed.pages).toBe(1);
    expect(parsed.textContent).toContain('Hello PDF Migration Test');
    // Guards the migration detail: v2 appends a "-- 1 of 1 --" page marker
    // unless pageJoiner is set to ''. We rely on the clean 1.x-style text.
    expect(parsed.textContent).not.toContain('-- 1 of 1 --');
    // The binary is also persisted for later access.
    expect(existsSync(savePath)).toBe(true);
    expect(readFileSync(savePath).subarray(0, 5).toString('latin1')).toBe('%PDF-');
  });

  it('falls back to save-only when the PDF cannot be parsed', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockImapService.getAttachmentContent.mockResolvedValueOnce({
      content: Buffer.from('this is not a real pdf', 'utf8'),
      contentType: 'application/pdf',
      filename: 'broken.pdf',
    });

    const result = await downloadHandler({
      accountId: 'acc1',
      folder: 'INBOX',
      uid: 2,
      filename: 'broken.pdf',
      savePath,
      extractText: true,
    });

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.saved).toBe(true);
    // Parsing failed -> no extracted text fields, but the file is still saved.
    expect(parsed.textContent).toBeUndefined();
    expect(parsed.pages).toBeUndefined();
    expect(existsSync(savePath)).toBe(true);
    errorSpy.mockRestore();
  });
});
