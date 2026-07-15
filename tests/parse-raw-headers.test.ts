import { describe, it, expect } from 'vitest';
import { parseRawHeaders } from '../src/services/imap-service.js';

describe('parseRawHeaders', () => {
  it('parses simple headers with lowercased keys', () => {
    const h = parseRawHeaders('From: a@b.com\r\nSubject: Hello\r\n');
    expect(h.from).toBe('a@b.com');
    expect(h.subject).toBe('Hello');
  });

  it('accepts a Buffer as input', () => {
    const h = parseRawHeaders(Buffer.from('X-Mailer: Sendy\r\n', 'utf8'));
    expect(h['x-mailer']).toBe('Sendy');
  });

  it('unfolds continuation lines', () => {
    const raw = 'Authentication-Results: mx.example.de;\r\n dmarc=none;\r\n\tspf=softfail\r\n';
    expect(parseRawHeaders(raw)['authentication-results']).toBe(
      'mx.example.de; dmarc=none; spf=softfail',
    );
  });

  it('joins repeated headers with newlines', () => {
    const raw = 'Received: from a\r\nReceived: from b\r\n';
    expect(parseRawHeaders(raw).received).toBe('from a\nfrom b');
  });

  it('handles LF-only line endings and ignores malformed lines', () => {
    const h = parseRawHeaders('From: a@b.com\ngarbage-without-colon\nSubject: Hi\n');
    expect(h.from).toBe('a@b.com');
    expect(h.subject).toBe('Hi');
    expect(Object.keys(h)).toHaveLength(2);
  });

  it('returns an empty object for empty input', () => {
    expect(parseRawHeaders('')).toEqual({});
  });
});
