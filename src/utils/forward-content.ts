/**
 * Body and attachment helpers for imap_forward_email.
 *
 * Kept free of I/O so the forward rules can be unit-tested directly.
 */
import type { EmailAttachment } from '../types/index.js';

/**
 * Upper bound on the raw size of an original whose attachments are forwarded
 * (`includeAttachments: true`). The source is fetched with a byte limit of one
 * more than this, so an oversized message is detected without downloading it
 * in full, and the forward fails before anything is sent. 25 MiB matches the
 * default of IMAP_MAX_UPLOAD_SIZE.
 */
export const FORWARD_SOURCE_MAX_BYTES = 25 * 1024 * 1024;

// cid: references in the HTML. Based on the pattern mailparser uses
// (MailParser#updateImageLinks), but the scheme matches in any case, and
// < > ( ) end the reference, so an unquoted src=cid:x> or a CSS url(cid:x)
// yields the bare Content-ID. These characters practically never occur in a
// Content-ID (RFC 5322 msg-id allows them only in domain literals).
const CID_REFERENCE = /\bcid:([^'"\s<>()]{1,256})/gi;

/** Content-IDs (without "cid:") referenced from the HTML; compared exactly with each part's Content-ID. */
export function referencedCids(html: string | undefined): Set<string> {
  const cids = new Set<string>();
  for (const match of (html ?? '').matchAll(CID_REFERENCE)) {
    cids.add(match[1]);
  }
  return cids;
}

/** The fields of a mailparser attachment that a forward needs. */
export interface ForwardSourceAttachment {
  filename?: string;
  contentType?: string;
  cid?: string;
  content?: unknown;
  /** Parsed part headers; mailparser gives Content-Type as { value, params }. */
  headers?: { get(name: string): unknown };
}

// Content-Type parameters that change how a part is read: the charset of a
// text part (e.g. iso-8859-1) and the method of a calendar invitation
// (text/calendar; method=REQUEST). The name parameter comes from the filename.
const KEPT_CONTENT_TYPE_PARAMS = ['charset', 'method'];

function contentTypeOf(att: ForwardSourceAttachment): string {
  const type = att.contentType || 'application/octet-stream';
  const header = att.headers?.get('content-type') as { params?: Record<string, unknown> } | undefined;
  const params = KEPT_CONTENT_TYPE_PARAMS
    .map(name => [name, header?.params?.[name]] as const)
    // Token values only, so nothing can break out of the header.
    .filter((entry): entry is readonly [string, string] => typeof entry[1] === 'string' && /^[\w.:+-]+$/.test(entry[1]))
    .map(([name, value]) => `; ${name}=${value}`);
  return type + params.join('');
}

/**
 * Turn the attachments of a parsed original into attachments for the forward.
 *
 * - An image (any image/* type) the HTML references via cid: (parsed with
 *   keepCidLinks, so the reference survives) goes along inline with its cid,
 *   so the forwarded HTML still shows it. References are matched exactly.
 * - Every other part goes along as a regular attachment WITHOUT cid. nodemailer
 *   places every attachment that has a cid into multipart/related next to the
 *   HTML, where some clients do not list it; an original PDF part that carries
 *   a Content-ID header would otherwise disappear from the attachment list. A
 *   cid: link in the HTML to such a part (e.g. <a href="cid:...">) no longer
 *   resolves.
 * - The charset and method parameters of the Content-Type are kept.
 *
 * Throws when a part has no content: a forward missing a requested attachment
 * must fail before sending instead of being reported as a success.
 */
export function forwardAttachments(
  attachments: ForwardSourceAttachment[],
  html: string | undefined,
  uid: number,
): EmailAttachment[] {
  const referenced = referencedCids(html);
  return attachments.map((att, index) => {
    if (!Buffer.isBuffer(att.content)) {
      const name = att.filename ? `"${att.filename}"` : `#${index + 1}`;
      throw new Error(`Attachment ${name} of email UID ${uid} could not be read; the email was not forwarded.`);
    }
    const embedded = !!att.cid && referenced.has(att.cid) && /^image\//i.test(att.contentType ?? '');
    return {
      // An empty name lets nodemailer generate one (attachment-N.<ext>), as it does for unnamed parts.
      filename: att.filename ?? '',
      content: att.content,
      contentType: contentTypeOf(att),
      contentDisposition: embedded ? 'inline' : 'attachment',
      ...(embedded ? { cid: att.cid } : {}),
    };
  });
}

const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, char => HTML_ESCAPES[char]);
}

// Elements that can precede <body> in a document without showing anything.
// The ones with content are skipped up to their end tag, so a "<body>"
// written inside <title>, <style> or <script> is not taken for the real one.
// <noscript> and <xml> (Outlook's Office settings) also appear in heads.
const PROLOG_TAGS = ['html', 'head', 'meta', 'link', 'base'];
const SKIPPED_ELEMENTS = ['title', 'style', 'script', 'noscript', 'xml'];
// One case-insensitive pattern per end tag, created once; exec() with
// lastIndex only moves forward, so searching stays linear.
const END_TAG_PATTERNS = new Map(SKIPPED_ELEMENTS.map(name => [name, new RegExp(`</${name}`, 'gi')]));

const isSpace = (char: string | undefined) =>
  char === ' ' || char === '\t' || char === '\n' || char === '\r' || char === '\f';

/** True when an element named `name` (lowercase) starts at `pos`, as "<name" or "</name". */
function tagAt(html: string, pos: number, name: string, closing = false): boolean {
  const start = pos + (closing ? 2 : 1);
  if (html[pos] !== '<' || (closing && html[pos + 1] !== '/')) return false;
  if (html.slice(start, start + name.length).toLowerCase() !== name) return false;
  const next = html[start + name.length];
  return next === undefined || next === '>' || next === '/' || isSpace(next);
}

/**
 * Index just past the ">" that ends the tag starting at `start`, or -1. A ">"
 * inside a quoted attribute value (onload="if(a>b)...") does not end the tag.
 */
function tagEnd(html: string, start: number): number {
  let quote = '';
  let previous = '';
  for (let i = start + 1; i < html.length; i++) {
    const char = html[i];
    if (quote) {
      if (char === quote) {
        quote = '';
        previous = char;
      }
    } else if (char === '>') {
      return i + 1;
    } else if ((char === '"' || char === "'") && previous === '=') {
      quote = char;
    } else if (!isSpace(char)) {
      previous = char;
    }
  }
  return -1;
}

/**
 * Start of the end tag of `name` at or after `from`, or -1. A match must be a
 * real end tag ("</title>", "</title " ...), not a longer name ("</titlex>"),
 * which does not end the element. Case-insensitive without lowercasing the
 * whole HTML.
 */
function endTagStart(html: string, name: string, from: number): number {
  const pattern = END_TAG_PATTERNS.get(name)!;
  pattern.lastIndex = from;
  for (let match = pattern.exec(html); match; match = pattern.exec(html)) {
    if (tagAt(html, match.index, name, true)) return match.index;
  }
  return -1;
}

/**
 * Index just past the end of the comment that starts at `start` ("<!--"), or
 * -1. Ends where browsers end it: right away for "<!-->" and "<!--->",
 * otherwise at the first "--" followed by ">" or "!>". One forward search for
 * "--", so a long run of dashes stays linear.
 */
function commentEnd(html: string, start: number): number {
  const content = start + 4;
  if (html[content] === '>') return content + 1;
  if (html.startsWith('->', content)) return content + 2;
  for (let dashes = html.indexOf('--', content); dashes >= 0; dashes = html.indexOf('--', dashes + 1)) {
    if (html[dashes + 2] === '>') return dashes + 3;
    if (html.startsWith('!>', dashes + 2)) return dashes + 4;
  }
  return -1;
}

/**
 * Where the forward block goes: right after the opening <body> tag when the
 * document prolog (whitespace, comments, <!DOCTYPE>, <html>, <head> and what
 * may stand in it) leads straight to it, otherwise where the first visible
 * content starts. So a fragment gets the block at its start, a document
 * without <body> gets it after its head instead of before <!DOCTYPE>, and HTML
 * that mailparser built from a text part followed by an HTML document gets it
 * before the text, not in the middle.
 *
 * One forward pass that only reads the prolog, using indexOf and short tag
 * checks: the HTML comes from the sender, and with includeAttachments: false
 * it is read without a size bound, so no backtracking regex runs over it.
 */
function forwardBlockPosition(html: string): number {
  let pos = 0;
  for (;;) {
    while (isSpace(html[pos])) pos++;
    if (pos >= html.length) return pos;

    let next: number;
    if (html.startsWith('<!--', pos)) {
      next = commentEnd(html, pos);
    } else if (html.startsWith('<!', pos) || html.startsWith('<?', pos)) {
      // <!DOCTYPE ...>, <?xml ...?>
      const close = html.indexOf('>', pos + 2);
      next = close < 0 ? -1 : close + 1;
    } else if (tagAt(html, pos, 'body')) {
      const end = tagEnd(html, pos);
      return end < 0 ? pos : end;
    } else if (SKIPPED_ELEMENTS.some(name => tagAt(html, pos, name))) {
      const name = SKIPPED_ELEMENTS.find(candidate => tagAt(html, pos, candidate))!;
      const open = tagEnd(html, pos);
      const close = open < 0 ? -1 : endTagStart(html, name, open);
      next = close < 0 ? -1 : tagEnd(html, close);
    } else if (PROLOG_TAGS.some(name => tagAt(html, pos, name)) || tagAt(html, pos, 'head', true)) {
      next = tagEnd(html, pos);
    } else {
      return pos;
    }

    // Unterminated comment, tag or element: the block goes before it.
    if (next < 0) return pos;
    pos = next;
  }
}

/**
 * Put the plain-text block that precedes the original in the text part (the
 * caller's note and the "Forwarded message" header) in front of the original
 * HTML as well, before its first visible content (see forwardBlockPosition).
 * The block is escaped, so a note or a header field such as a subject with
 * "<b>" shows as typed instead of becoming markup. Without an original HTML
 * part nothing is added, so a plain-text original still forwards without an
 * HTML part.
 */
export function prependForwardHtml(html: string | undefined, plainPrefix: string): string | undefined {
  if (!html) return html;
  const prefix = plainPrefix.trim();
  if (!prefix) return html;
  const block = `<div>${escapeHtml(prefix).replace(/\r?\n/g, '<br>\n')}</div><br>\n`;
  const at = forwardBlockPosition(html);
  return html.slice(0, at) + block + html.slice(at);
}
