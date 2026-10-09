import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import {
  generateReplySubject,
  generateForwardSubject,
  composeReplyBody,
  composeForwardBody
} from '../src/utils/reply-forward-helpers.js';

const mockDate = new Date('2026-01-01T12:00:00Z');

// Mock email for testing
const mockOriginalEmail = {
  from: 'sender@example.com',
  to: ['recipient@example.com', 'user@example.com'],
  subject: 'Original Subject',
  date: mockDate,
  messageId: '<original@example.com>',
  inReplyTo: '<parent@example.com>',
  references: ['<grandparent@example.com>', '<parent@example.com>'],
  textContent: 'Original message',
  htmlContent: '<p>Original message</p>',
  headers: {
    'references': '<grandparent@example.com> <parent@example.com>'
  },
};

const mockAccount = {
  id: 'acc1',
  email: 'user@example.com',
  user: 'user@example.com',
  defaultBcc: ['archive@example.com']
};

describe('Reply/Forward Draft Helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Subject generation', () => {
    it('should generate Reply subject with Re: prefix', () => {
      expect(generateReplySubject('Hello')).toBe('Re: Hello');
      expect(generateReplySubject('Test Subject')).toBe('Re: Test Subject');
    });

    it('should not duplicate Re: prefix', () => {
      expect(generateReplySubject('Re: Hello')).toBe('Re: Hello');
      expect(generateReplySubject('re: Hello')).toBe('re: Hello');
      expect(generateReplySubject('RE: Hello')).toBe('RE: Hello');
      expect(generateReplySubject('Re: Re: Hello')).toBe('Re: Re: Hello');
    });

    it('should generate Forward subject with Fwd: prefix', () => {
      expect(generateForwardSubject('Hello')).toBe('Fwd: Hello');
      expect(generateForwardSubject('Important')).toBe('Fwd: Important');
    });

    it('should not duplicate Fwd: prefix', () => {
      expect(generateForwardSubject('Fwd: Hello')).toBe('Fwd: Hello');
      expect(generateForwardSubject('fwd: Hello')).toBe('fwd: Hello');
      expect(generateForwardSubject('FWD: Hello')).toBe('FWD: Hello');
    });
  });

  // NOTE: buildReferences and buildReplyRecipients unit tests are covered upstream
  // in tests/reply-all.test.ts. We keep only integration tests that verify our draft
  // tools use these helpers correctly.

  describe('Body composition', () => {
    it('should compose reply body with quoted original', () => {
      const result = composeReplyBody('My reply', undefined, mockOriginalEmail, true);

      expect(result.text).toContain('My reply');
      expect(result.text).toContain('On');
      expect(result.text).toContain('sender@example.com');
      expect(result.text).toContain('Original message');
      // Should have quoted lines
      expect(result.text).toContain('> Original message');
      // Should NOT have artificial separator
      expect(result.text).not.toContain('--=');
      expect(result.text).not.toContain('---');
    });

    it('should compose reply body without quoted original', () => {
      const result = composeReplyBody('My reply', undefined, mockOriginalEmail, false);

      expect(result.text).toBe('My reply');
      expect(result.text).not.toContain('Original message');
    });

    it('should compose forward body with header block', () => {
      const result = composeForwardBody('Please see this', undefined, mockOriginalEmail, true);

      expect(result.text).toContain('Please see this');
      expect(result.text).toContain('---------- Forwarded message ----------');
      expect(result.text).toContain('From: sender@example.com');
      expect(result.text).toContain('Subject: Original Subject');
      expect(result.text).toContain('To: recipient@example.com,user@example.com');
      expect(result.text).toContain('Original message');
    });

    it('should compose forward body without original content', () => {
      const result = composeForwardBody('Just the intro', undefined, mockOriginalEmail, false);

      expect(result.text).toBe('Just the intro');
      expect(result.text).not.toContain('Forwarded message');
      expect(result.text).not.toContain('Original message');
    });

    it('should handle HTML forward body', () => {
      const result = composeForwardBody('Intro', '<p>HTML intro</p>', mockOriginalEmail, true);

      expect(result.html).toContain('HTML intro');
      expect(result.html).toContain('Forwarded message');
      expect(result.html).toContain('Original message');
    });

    it('should handle empty new content', () => {
      const result1 = composeReplyBody('', undefined, mockOriginalEmail, true);
      const result2 = composeForwardBody('', undefined, mockOriginalEmail, true);

      // Should still include quoted content even with empty new content
      expect(result1.text).toContain('Original message');
      expect(result2.text).toContain('Original message');
    });

    it('should handle undefined new content', () => {
      const result1 = composeReplyBody(undefined, undefined, mockOriginalEmail, true);
      const result2 = composeForwardBody(undefined, undefined, mockOriginalEmail, true);

      expect(result1.text).toContain('Original message');
      expect(result2.text).toContain('Original message');
    });
  });

  describe('MIME structure handling for HTML-only detection', () => {
    // Test the isHtmlOnlyMessage helper with various MIME structures
    // to ensure it correctly detects whether a genuine text/plain part exists

    // Helper to create EmailContent from parsed source
    function createEmailContentFromSource(source: string): Promise<any> {
      const { simpleParser } = require('mailparser');
      return simpleParser(source).then((parsed: any) => {
        const headers: Record<string, string | string[]> = {};
        const headerToString = (v: unknown): string => {
          if (typeof v === 'string') return v;
          if (v && typeof v === 'object' && 'text' in v) return String((v as { text: string }).text);
          if (v && typeof v === 'object' && 'value' in v) return String((v as { value: string }).value);
          if (v && typeof v === 'object') return JSON.stringify(v);
          return String(v);
        };

        if (parsed.headers) {
          for (const [key, value] of parsed.headers) {
            if (typeof value === 'string') {
              headers[key] = value;
            } else if (Array.isArray(value)) {
              headers[key] = value.map(headerToString);
            } else {
              headers[key] = headerToString(value);
            }
          }
        }

        return {
          from: parsed.from?.text || '',
          to: parsed.to ? (Array.isArray(parsed.to) ? parsed.to.map((t: any) => t.text || '') : [parsed.to.text || '']) : [],
          subject: parsed.subject || '',
          date: parsed.date || new Date(),
          messageId: parsed.messageId || '',
          headers,
          textContent: parsed.text || undefined,
          htmlContent: parsed.html || undefined,
          textAsHtml: parsed.textAsHtml || undefined
        };
      });
    }

    it('should detect HTML-only for text/html top-level', async () => {
      const source = 'Content-Type: text/html\n\n<p>HTML only content</p>';
      const email = await createEmailContentFromSource(source);

      expect(email.textContent).toBeDefined();
      expect(email.textContent).toContain('HTML only content');
      expect(email.htmlContent).toBeDefined();

      const result = composeReplyBody('Reply', undefined, email, true);
      expect(result.text).toContain('Reply');
      expect(result.text).toContain('HTML only content');
    });

    it('should detect genuine text/plain in multipart/alternative', async () => {
      const source = `MIME-Version: 1.0
Content-Type: multipart/alternative; boundary="b"

--b
Content-Type: text/plain

Plain text version

--b
Content-Type: text/html

<p>HTML version</p>

--b--`;
      const email = await createEmailContentFromSource(source);

      expect(email.textContent).toBeDefined();
      expect(email.textContent).toContain('Plain text version');
      expect(email.htmlContent).toBeDefined();

      const result = composeReplyBody('Reply', undefined, email, true);
      expect(result.text).toContain('Reply');
      expect(result.text).toContain('Plain text version');
    });

    it('should detect HTML-only for multipart/related with text/html + inline image', async () => {
      const source = `MIME-Version: 1.0
Content-Type: multipart/related; boundary="b"; type="text/html"

--b
Content-Type: text/html

<p>HTML with image: <img src="cid:logo"></p>

--b
Content-Type: image/png
Content-ID: <logo>
Content-Disposition: inline
Content-Transfer-Encoding: base64

iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==

--b--`;
      const email = await createEmailContentFromSource(source);

      expect(email.textContent).toBeUndefined();
      expect(email.htmlContent).toBeDefined();
      expect(email.textAsHtml).toBeUndefined();

      const result = composeReplyBody('Reply', undefined, email, true);
      expect(result.text).toContain('Reply');
      expect(result.text).not.toContain('HTML with image');
    });

    it('should detect HTML-only for multipart/mixed with text/html + attachment', async () => {
      const source = `MIME-Version: 1.0
Content-Type: multipart/mixed; boundary="b"

--b
Content-Type: text/html

<p>HTML content only</p>

--b
Content-Type: application/pdf
Content-Disposition: attachment; filename="doc.pdf"
Content-Transfer-Encoding: base64

JVBERi0xLjQKJcOkw0zrBEY:

--b--`;
      const email = await createEmailContentFromSource(source);

      expect(email.textContent).toBeUndefined();
      expect(email.htmlContent).toBeDefined();
      expect(email.textAsHtml).toBeUndefined();

      const result = composeReplyBody('Reply', undefined, email, true);
      expect(result.text).toContain('Reply');
      expect(result.text).not.toContain('HTML content only');
    });

    it('should detect genuine text/plain in nested multipart/alternative', async () => {
      const source = `MIME-Version: 1.0
Content-Type: multipart/mixed; boundary="b"

--b
MIME-Version: 1.0
Content-Type: multipart/alternative; boundary="c"

--c
Content-Type: text/plain

Nested plain text content.

--c
Content-Type: text/html

<p>Nested HTML content.</p>

--c--

--b
Content-Type: application/pdf
Content-Disposition: attachment; filename="doc.pdf"
Content-Transfer-Encoding: base64

JVBERi0xLjQKJcOkw0zrBEY:

--b--`;
      const email = await createEmailContentFromSource(source);

      expect(email.textContent).toBeDefined();
      expect(email.textContent).toContain('Nested plain text content');
      expect(email.htmlContent).toBeDefined();

      const result = composeReplyBody('Reply', undefined, email, true);
      expect(result.text).toContain('Reply');
      expect(result.text).toContain('Nested plain text content');
    });

    describe('SafeLinks cleanup in quoted HTML', () => {
      // Test that http/https SafeLinks are unwrapped
      it('should unwrap SafeLink with http destination', async () => {
        const source = `Content-Type: text/html

<p><a href="https://eur02.safelinks.protection.outlook.com/?url=http%3A%2F%2Fexample.com%2F&data=test">Example</a></p>`;
        const email = await createEmailContentFromSource(source);

        const result = composeReplyBody('Reply', undefined, email, true);
        expect(result.html).toBeDefined();
        expect(result.html).toContain('http://example.com/');
        expect(result.html).not.toContain('safelinks.protection.outlook.com');
      });

      it('should unwrap SafeLink with https destination', async () => {
        const source = `Content-Type: text/html

<p><a href="https://eur02.safelinks.protection.outlook.com/?url=https%3A%2F%2Fsecure.example.com%2Fpage&data=test">Secure</a></p>`;
        const email = await createEmailContentFromSource(source);

        const result = composeReplyBody('Reply', undefined, email, true);
        expect(result.html).toBeDefined();
        expect(result.html).toContain('https://secure.example.com/page');
        expect(result.html).not.toContain('safelinks.protection.outlook.com');
      });

      // Test that unsafe URL schemes are NOT unwrapped
      it('should NOT unwrap SafeLink with javascript: destination', async () => {
        const source = `Content-Type: text/html

<p><a href="https://eur02.safelinks.protection.outlook.com/?url=javascript%3Aalert%281%29&data=test">Click</a></p>`;
        const email = await createEmailContentFromSource(source);

        const result = composeReplyBody('Reply', undefined, email, true);
        expect(result.html).toBeDefined();
        // Should NOT be unwrapped - still contains SafeLink domain
        expect(result.html).toContain('safelinks.protection.outlook.com');
        expect(result.html).not.toContain('javascript:alert(1)');
      });

      it('should NOT unwrap SafeLink with data: destination', async () => {
        const source = `Content-Type: text/html

<p><a href="https://eur02.safelinks.protection.outlook.com/?url=data%3Atext%2Fhtml%2C%3Cscript%3Ealert%281%29%3C%2Fscript%3E&data=test">Click</a></p>`;
        const email = await createEmailContentFromSource(source);

        const result = composeReplyBody('Reply', undefined, email, true);
        expect(result.html).toBeDefined();
        // Should NOT be unwrapped - still contains SafeLink domain
        expect(result.html).toContain('safelinks.protection.outlook.com');
        expect(result.html).not.toContain('data:text/html');
      });

      // Test edge cases
      it('should preserve human-readable text with SafeLink href', async () => {
        const source = `Content-Type: text/html

<p><a href="https://eur02.safelinks.protection.outlook.com/?url=https%3A%2F%2Fsocial.example.com&data=test">Visit our social media page</a></p>`;
        const email = await createEmailContentFromSource(source);

        const result = composeReplyBody('Reply', undefined, email, true);
        expect(result.html).toBeDefined();
        expect(result.html).toContain('social.example.com');
        expect(result.html).toContain('Visit our social media page');
        expect(result.html).not.toContain('safelinks.protection.outlook.com');
      });

      it('should leave ordinary URLs unchanged', async () => {
        const source = `Content-Type: text/html

<p><a href="https://www.example.com">Example Website</a></p>`;
        const email = await createEmailContentFromSource(source);

        const result = composeReplyBody('Reply', undefined, email, true);
        expect(result.html).toBeDefined();
        expect(result.html).toContain('https://www.example.com');
        expect(result.html).toContain('Example Website');
      });

      it('should leave malformed SafeLinks unchanged', async () => {
        const source = `Content-Type: text/html

<p><a href="https://eur02.safelinks.protection.outlook.com/?invalid=no-url-param">Broken SafeLink</a></p>`;
        const email = await createEmailContentFromSource(source);

        const result = composeReplyBody('Reply', undefined, email, true);
        expect(result.html).toBeDefined();
        expect(result.html).toContain('safelinks.protection.outlook.com');
      });

      it('should handle SafeLinks in HTML-only email', async () => {
        const source = fs.readFileSync(path.join(__dirname, 'fixtures', 'outlook-safelinks-html-only.eml'), 'utf8');
        const email = await createEmailContentFromSource(source);

        const result = composeReplyBody('Test reply', undefined, email, true);
        expect(result.html).toBeDefined();
        expect(result.html).toContain('http://www.example.com/page');
        expect(result.html).not.toContain('safelinks.protection.outlook.com');
      });

      it('should handle SafeLink with & in query parameters', async () => {
        const source = `Content-Type: text/html

<p><a href="https://eur02.safelinks.protection.outlook.com/?url=https%3A%2F%2Fexample.com%2Fpage%3Ffoo%3D1%26bar%3D2&data=test">Link</a></p>`;
        const email = await createEmailContentFromSource(source);

        const result = composeReplyBody('Reply', undefined, email, true);
        expect(result.html).toBeDefined();
        expect(result.html).toContain('https://example.com/page?foo=1&amp;bar=2');
        expect(result.html).not.toContain('safelinks.protection.outlook.com');
      });

      it('should preserve existing entity text in human-readable anchors', async () => {
        const source = `Content-Type: text/html

<p><a href="https://eur02.safelinks.protection.outlook.com/?url=https%3A%2F%2Fexample.com%2Fmenu&data=test">Fish &amp; Chips</a></p>`;
        const email = await createEmailContentFromSource(source);

        const result = composeReplyBody('Reply', undefined, email, true);
        expect(result.html).toBeDefined();
        expect(result.html).toContain('Fish &amp; Chips');
        expect(result.html).not.toContain('Fish &amp;amp; Chips');
        expect(result.html).not.toContain('safelinks.protection.outlook.com');
      });
    });
  });

  describe('HTML escaping', () => {
    it('should escape hostile from address in reply HTML', () => {
      const hostileEmail = {
        ...mockOriginalEmail,
        from: 'Evil <attacker@example.com> & <script>alert(1)</script>'
      };

      const result = composeReplyBody('My reply', undefined, hostileEmail, true);
      expect(result.html).toBeDefined();

      // Should escape hostile content
      expect(result.html).toContain('&lt;attacker@example.com&gt;');
      expect(result.html).toContain('&amp;');
      expect(result.html).toContain('&lt;script&gt;');
      expect(result.html).not.toContain('<script>');
      expect(result.html).not.toContain('attacker@example.com> & <script');
    });

    it('should escape hostile subject in forward HTML', () => {
      const hostileEmail = {
        ...mockOriginalEmail,
        subject: 'Hello <script>alert(1)</script> & "test"'
      };

      const result = composeForwardBody('My forward', undefined, hostileEmail, true);
      expect(result.html).toBeDefined();

      // Should escape hostile content in subject (HTML text context: quotes don't need escaping)
      expect(result.html).toContain('&lt;script&gt;');
      expect(result.html).toContain('&amp;');
      expect(result.html).toContain('"test"'); // Quotes in text content don't need HTML escaping
      expect(result.html).not.toContain('<script>');
      expect(result.html).not.toContain('& "test"');
    });

    it('should escape textContent fallback with special characters', () => {
      const emailWithSpecialChars = {
        ...mockOriginalEmail,
        textContent: 'A & B < C > D',
        textAsHtml: undefined
      };

      const result = composeReplyBody('My reply', undefined, emailWithSpecialChars, true);
      expect(result.html).toBeDefined();

      // Should escape special characters in fallback text
      expect(result.html).toContain('A &amp; B &lt; C &gt; D');
      expect(result.html).not.toContain('A & B < C > D');
    });

    it('should escape newContentText with special characters', () => {
      // Need includeQuotedOriginal=true and original content to trigger HTML generation
      const result = composeReplyBody('A & B < C > D', undefined, mockOriginalEmail, true);
      expect(result.html).toBeDefined();

      // Should preserve paragraph structure and escape special characters
      expect(result.html).toContain('&amp;');
      expect(result.html).toContain('&lt;');
      expect(result.html).toContain('&gt;');
      expect(result.html).not.toContain('A & B < C > D');
    });

    it('should escape hostile to addresses in forward HTML', () => {
      const hostileEmail = {
        ...mockOriginalEmail,
        to: ['Attacker <evil@example.com> & <script>alert(1)</script>']
      };

      const result = composeForwardBody('My forward', undefined, hostileEmail, true);
      expect(result.html).toBeDefined();

      // Should escape hostile content in To field
      expect(result.html).toContain('&lt;evil@example.com&gt;');
      expect(result.html).toContain('&amp;');
      expect(result.html).toContain('&lt;script&gt;');
      expect(result.html).not.toContain('<script>');
    });
  });
});

describe('Tool Registration', () => {
  it('should have READ_ONLY_TOOLS exported', async () => {
    // Import the tools registration to verify it exists
    const { READ_ONLY_TOOLS } = await import('../src/tools/index.js');

    expect(typeof READ_ONLY_TOOLS).toBe('object');
    expect(Array.isArray(READ_ONLY_TOOLS)).toBe(true);
  });

  it('should not include draft tools in read-only mode', async () => {
    const { READ_ONLY_TOOLS } = await import('../src/tools/index.js');

    expect(READ_ONLY_TOOLS).not.toContain('imap_save_reply_draft');
    expect(READ_ONLY_TOOLS).not.toContain('imap_save_forward_draft');

    // But should include read-only tools
    expect(READ_ONLY_TOOLS).toContain('imap_search_emails');
    expect(READ_ONLY_TOOLS).toContain('imap_get_email');
  });
});
