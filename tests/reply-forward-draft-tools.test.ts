import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import {
  extractEmail,
  generateReplySubject,
  generateForwardSubject,
  extractReplyRecipients,
  buildReplyThreadingHeaders,
  composeReplyBody,
  composeForwardBody,
  resolveReplyForwardBcc
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

  describe('Email extraction', () => {
    it('should extract email from formatted address', () => {
      expect(extractEmail('Alice <alice@example.com>')).toBe('alice@example.com');
      expect(extractEmail('alice@example.com')).toBe('alice@example.com');
      expect(extractEmail('  Alice Bob <test@example.com>  ')).toBe('test@example.com');
      expect(extractEmail('user@example.com')).toBe('user@example.com');
    });

    it('should return lowercase for comparison', () => {
      expect(extractEmail('Alice <ALICE@EXAMPLE.COM>')).toBe('alice@example.com');
      expect(extractEmail('TEST@EXAMPLE.COM')).toBe('test@example.com');
    });
  });

  describe('Threading headers', () => {
    it('should build reply threading headers with existing References', () => {
      const result = buildReplyThreadingHeaders(mockOriginalEmail);
      
      expect(result.inReplyTo).toBe('<original@example.com>');
      expect(result.references).toContain('<grandparent@example.com>');
      expect(result.references).toContain('<parent@example.com>');
      expect(result.references).toContain('<original@example.com>');
      // Should preserve original formatting
      expect(result.references).toMatch(/<grandparent@example\.com>.*<parent@example\.com>.*<original@example\.com>/);
    });

    it('should build reply threading headers with no existing References', () => {
      const emailNoRefs = {
        ...mockOriginalEmail,
        headers: {},
      };

      const result = buildReplyThreadingHeaders(emailNoRefs);
      
      expect(result.inReplyTo).toBe('<original@example.com>');
      expect(result.references).toBe('<original@example.com>');
    });

    it('should avoid duplicate Message-ID in References chain', () => {
      // Original message ID already in References chain
      const emailWithDup = {
        ...mockOriginalEmail,
        headers: {
          'references': '<parent@example.com> <original@example.com>'
        }
      };

      const result = buildReplyThreadingHeaders(emailWithDup);
      
      expect(result.inReplyTo).toBe('<original@example.com>');
      // Should preserve existing References without adding duplicate
      expect(result.references).toBe('<parent@example.com> <original@example.com>');
    });

    it('should handle malformed References header', () => {
      const emailBadRefs = {
        ...mockOriginalEmail,
        headers: {
          'references': '' // Empty references
        }
      };

      const result = buildReplyThreadingHeaders(emailBadRefs);
      
      expect(result.inReplyTo).toBe('<original@example.com>');
      expect(result.references).toBe('<original@example.com>');
    });

    it('should handle undefined References header', () => {
      const emailNoRefs = {
        ...mockOriginalEmail,
        headers: {} // No references header at all
      };

      const result = buildReplyThreadingHeaders(emailNoRefs);
      
      expect(result.inReplyTo).toBe('<original@example.com>');
      expect(result.references).toBe('<original@example.com>');
    });
  });

  describe('Recipient extraction', () => {
    it('should extract normal reply recipients (just sender)', () => {
      const result = extractReplyRecipients(mockOriginalEmail, 'user@example.com', false);
      
      expect(result.to).toEqual(['sender@example.com']);
      expect(result.cc).toEqual([]);
    });

    it('should extract reply-all recipients excluding self', () => {
      const result = extractReplyRecipients(mockOriginalEmail, 'user@example.com', true);
      
      // Should include sender + all To recipients except user@example.com
      expect(result.to).toContain('sender@example.com');
      expect(result.to).toContain('recipient@example.com');
      expect(result.to).not.toContain('user@example.com');
      expect(result.to.length).toBe(2);
      expect(result.cc).toEqual([]);
    });

    it('should handle sender with display name', () => {
      const emailWithDisplayName = {
        ...mockOriginalEmail,
        from: 'Sender Name <sender@example.com>',
        to: ['recipient@example.com']
      };

      const result = extractReplyRecipients(emailWithDisplayName, 'user@example.com', false);
      
      expect(result.to).toEqual(['Sender Name <sender@example.com>']);
      expect(result.cc).toEqual([]);
    });

    it('should handle multiple recipients with display names', () => {
      const emailWithDisplayNames = {
        from: 'Sender <sender@example.com>',
        to: ['Recipient One <recipient@example.com>', 'User <user@example.com>'],
        headers: {}
      };

      const result = extractReplyRecipients(emailWithDisplayNames, 'user@example.com', true);
      
      expect(result.to).toContain('Sender <sender@example.com>');
      expect(result.to).toContain('Recipient One <recipient@example.com>');
      expect(result.to).not.toContain('User <user@example.com>');
      expect(result.to.length).toBe(2);
      expect(result.cc).toEqual([]);
    });

    it('should handle case-insensitive email comparison', () => {
      const emailCaseDiff = {
        from: 'SENDER@example.com',
        to: ['RECIPIENT@example.com', 'USER@example.com'],
        headers: {}
      };

      const result = extractReplyRecipients(emailCaseDiff, 'user@example.com', true);
      
      // Should exclude user@example.com even though case is different
      expect(result.to).toContain('SENDER@example.com');
      expect(result.to).toContain('RECIPIENT@example.com');
      expect(result.to).not.toContain('USER@example.com');
      expect(result.to.length).toBe(2);
      expect(result.cc).toEqual([]);
    });

    it('should respect Reply-To header over From', () => {
      const emailWithReplyTo = {
        ...mockOriginalEmail,
        from: 'sender@example.com',
        headers: {
          ...mockOriginalEmail.headers,
          'Reply-To': 'reply-to@example.com'
        }
      };

      const result = extractReplyRecipients(emailWithReplyTo, 'user@example.com', false);
      
      expect(result.to).toEqual(['reply-to@example.com']);
      expect(result.cc).toEqual([]);
    });

    it('should respect reply-to header (lowercase) over From', () => {
      const emailWithReplyTo = {
        ...mockOriginalEmail,
        from: 'sender@example.com',
        headers: {
          ...mockOriginalEmail.headers,
          'reply-to': 'reply-to@example.com'
        }
      };

      const result = extractReplyRecipients(emailWithReplyTo, 'user@example.com', false);
      
      expect(result.to).toEqual(['reply-to@example.com']);
      expect(result.cc).toEqual([]);
    });

    it('should preserve Cc recipients in reply-all', () => {
      const emailWithCc = {
        ...mockOriginalEmail,
        headers: {
          ...mockOriginalEmail.headers,
          'Cc': ['cc1@example.com', 'cc2@example.com']
        }
      };

      const result = extractReplyRecipients(emailWithCc, 'user@example.com', true);
      
      // Should have sender and To recipients in To
      expect(result.to).toContain('sender@example.com');
      expect(result.to).toContain('recipient@example.com');
      expect(result.to).not.toContain('user@example.com');
      // Should have Cc recipients in Cc
      expect(result.cc).toContain('cc1@example.com');
      expect(result.cc).toContain('cc2@example.com');
      expect(result.cc.length).toBe(2);
    });

    it('should exclude own address from Cc in reply-all', () => {
      const emailWithCc = {
        ...mockOriginalEmail,
        headers: {
          ...mockOriginalEmail.headers,
          'Cc': ['cc1@example.com', 'user@example.com', 'cc2@example.com']
        }
      };

      const result = extractReplyRecipients(emailWithCc, 'user@example.com', true);
      
      // Should not include user@example.com in Cc
      expect(result.cc).toContain('cc1@example.com');
      expect(result.cc).toContain('cc2@example.com');
      expect(result.cc).not.toContain('user@example.com');
      expect(result.cc.length).toBe(2);
    });

    it('should handle Reply-To with reply-all and preserve To/Cc semantics', () => {
      const emailWithReplyToAndCc = {
        ...mockOriginalEmail,
        from: 'sender@example.com',
        headers: {
          'Reply-To': 'reply-to@example.com',
          'Cc': ['cc1@example.com']
        }
      };

      const result = extractReplyRecipients(emailWithReplyToAndCc, 'user@example.com', true);
      
      // Reply-To should be in To
      expect(result.to).toContain('reply-to@example.com');
      // Original To should also be in To (except self)
      expect(result.to).toContain('recipient@example.com');
      expect(result.to).not.toContain('user@example.com');
      // Cc should be preserved
      expect(result.cc).toContain('cc1@example.com');
    });
  });

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
      it('should unwrap SafeLink to original destination', async () => {
        const source = `Content-Type: text/html

<p><a href="https://eur02.safelinks.protection.outlook.com/?url=http%3A%2F%2Fwww.example.com%2F&data=test">Example</a></p>`;
        const email = await createEmailContentFromSource(source);

        const result = composeReplyBody('Reply', undefined, email, true);
        expect(result.html).toBeDefined();
        // Should contain the original URL, not the SafeLink domain
        expect(result.html).toContain('http://www.example.com/');
        expect(result.html).not.toContain('safelinks.protection.outlook.com');
      });

      it('should preserve human-readable text with SafeLink href', async () => {
        const source = `Content-Type: text/html

<p><a href="https://eur02.safelinks.protection.outlook.com/?url=https%3A%2F%2Ffacebook.com&data=test">Visit our Facebook page</a></p>`;
        const email = await createEmailContentFromSource(source);

        const result = composeReplyBody('Reply', undefined, email, true);
        expect(result.html).toBeDefined();
        // Should have the original URL
        expect(result.html).toContain('facebook.com');
        // Should preserve human-readable text
        expect(result.html).toContain('Visit our Facebook page');
        // Should not contain SafeLink domain
        expect(result.html).not.toContain('safelinks.protection.outlook.com');
      });

      it('should leave ordinary URLs unchanged', async () => {
        const source = `Content-Type: text/html

<p><a href="https://www.example.com">Example Website</a></p>`;
        const email = await createEmailContentFromSource(source);

        const result = composeReplyBody('Reply', undefined, email, true);
        expect(result.html).toBeDefined();
        // Ordinary links should remain unchanged
        expect(result.html).toContain('https://www.example.com');
        expect(result.html).toContain('Example Website');
        expect(result.html).not.toContain('safelinks.protection.outlook.com');
      });

      it('should leave malformed SafeLinks unchanged', async () => {
        const source = `Content-Type: text/html

<p><a href="https://eur02.safelinks.protection.outlook.com/?invalid=no-url-param">Broken SafeLink</a></p>`;
        const email = await createEmailContentFromSource(source);

        const result = composeReplyBody('Reply', undefined, email, true);
        expect(result.html).toBeDefined();
        // Should preserve the original since it has no url parameter
        expect(result.html).toContain('safelinks.protection.outlook.com');
      });

      it('should handle SafeLinks in HTML-only email', async () => {
        const source = fs.readFileSync(path.join(__dirname, 'fixtures', 'outlook-safelinks-html-only.eml'), 'utf8');
        const email = await createEmailContentFromSource(source);

        const result = composeReplyBody('Test reply', undefined, email, true);
        expect(result.html).toBeDefined();
        // Should have unwrapped SafeLinks to original URLs
        expect(result.html).toContain('http://www.example.com/page');
        // Should not contain SafeLink domains
        expect(result.html).not.toContain('safelinks.protection.outlook.com');
      });
    });
  });

  describe('BCC resolution', () => {
    it('should return undefined when no BCC specified', () => {
      const result = resolveReplyForwardBcc({}, undefined);
      expect(result).toBeUndefined();
    });

    it('should return account defaultBcc when no explicit BCC', () => {
      const result = resolveReplyForwardBcc(mockAccount, undefined);
      // mergeBcc returns string for single recipient
      expect(result).toBe('archive@example.com');
    });

    it('should merge account defaultBcc with explicit bcc', () => {
      const result = resolveReplyForwardBcc(mockAccount, ['extra@example.com']);
      
      // Should contain both default and explicit
      expect(result).toContain('archive@example.com');
      expect(result).toContain('extra@example.com');
    });

    it('should handle string BCC parameter', () => {
      const result = resolveReplyForwardBcc(mockAccount, 'string@example.com');
      expect(result).toBeDefined();
    });

    describe('Forward draft threading behavior', () => {
      it('should verify that forward drafts do not set threading headers', () => {
        // This is a conceptual test - the actual tool implementation
        // should set inReplyTo: undefined and references: undefined
        // This ensures forwarded messages don't get threaded with the original conversation
        
        // We can't directly test the tool here without mocking the entire infrastructure,
        // but we can verify that the composeForwardBody function doesn't add threading info
        const result = composeForwardBody('Test', undefined, mockOriginalEmail, true);
        
        // The body composition should not contain In-Reply-To or References headers
        expect(result.text).not.toContain('In-Reply-To:');
        expect(result.text).not.toContain('References:');
      });
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