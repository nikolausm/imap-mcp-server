/**
 * Outlook-style quoted history for reply drafts (imap_save_reply_draft).
 *
 * The server builds the quote from the original message, so long threads
 * (100+ KB of HTML) never pass through the caller: the new message goes on
 * top, then a "From / Sent / To / Cc / Subject" header block, then the
 * original message's own HTML body (with its <head> styles kept) and its
 * inline images re-attached under the same Content-IDs so cid: links keep
 * working. Kept free of I/O so it can be unit-tested directly.
 */

export interface QuoteOriginal {
  from: string;
  to: string[];
  cc?: string[];
  date?: Date;
  subject: string;
  /** Original HTML with cid: links intact (mailparser keepCidLinks). */
  html?: string;
  text?: string;
}

export interface QuoteInput {
  newHtml?: string;
  newText?: string;
  original: QuoteOriginal;
  /** IANA time zone for the "Sent:" line; default: the machine's zone. */
  timeZone?: string;
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** '"Jane Doe" <jane@x.com>' -> 'Jane Doe <jane@x.com>' (Outlook shows names without quotes). */
export function displayAddress(addr: string): string {
  return addr.replace(/^\s*"([^"]*)"\s*</, '$1 <').trim();
}

/** "Friday, November 20, 2026 12:20 PM", the format Outlook uses in its reply header. */
export function formatSent(date: Date | undefined, timeZone?: string): string {
  if (!date || Number.isNaN(date.getTime())) return '';
  const opts: Intl.DateTimeFormatOptions = {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit',
    ...(timeZone ? { timeZone } : {}),
  };
  // ICU versions differ ("2026 at 12:20 PM" / "2026, 12:20 PM"): normalize to Outlook's "2026 12:20 PM".
  return new Intl.DateTimeFormat('en-US', opts).format(date).replace(/ at /, ' ').replace(/(\d{4}), (\d)/, '$1 $2');
}

/** Inner HTML of <body>, or the whole document when it has no <body>. */
export function bodyInner(html: string): string {
  const m = html.match(/<body\b[^>]*>([\s\S]*)<\/body\s*>/i);
  if (m) return m[1];
  return html.replace(/<!doctype[^>]*>/i, '').replace(/<\/?html\b[^>]*>/gi, '').replace(/<head\b[^>]*>[\s\S]*?<\/head\s*>/i, '');
}

/** <style> blocks of the original's <head> (Outlook's list and font definitions live there). */
export function headStyles(html: string): string {
  const head = html.match(/<head\b[^>]*>([\s\S]*?)<\/head\s*>/i);
  if (!head) return '';
  return (head[1].match(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi) || []).join('\n');
}

/** Content-IDs (without brackets) that the HTML references as cid: links. */
export function referencedCids(html: string): Set<string> {
  const out = new Set<string>();
  for (const m of html.matchAll(/cid:([^"'\s)>]+)/gi)) out.add(decodeURIComponent(m[1]).toLowerCase());
  return out;
}

function headerLines(o: QuoteOriginal, timeZone?: string): Array<[string, string]> {
  const rows: Array<[string, string]> = [
    ['From', displayAddress(o.from)],
    ['Sent', formatSent(o.date, timeZone)],
    ['To', o.to.map(displayAddress).join('; ')],
  ];
  if (o.cc && o.cc.length) rows.push(['Cc', o.cc.map(displayAddress).join('; ')]);
  rows.push(['Subject', o.subject]);
  return rows.filter(([, v]) => v !== '');
}

function textToHtml(text: string): string {
  return `<div style="white-space:pre-wrap">${escapeHtml(text)}</div>`;
}

export function buildQuotedReply(input: QuoteInput): { html: string; text: string } {
  const { original: o, timeZone } = input;
  const rows = headerLines(o, timeZone);

  const font = "font-size:11.0pt;font-family:'Calibri',sans-serif";
  const headerHtml =
    `<div style="border:none;border-top:solid #E1E1E1 1.0pt;padding:3.0pt 0in 0in 0in">` +
    `<p style="margin:0;${font}">` +
    rows.map(([k, v]) => `<b>${k}:</b> ${escapeHtml(v)}`).join('<br>') +
    `</p></div><p style="margin:0">&nbsp;</p>`;

  const originalHtml = o.html ? bodyInner(o.html) : textToHtml(o.text || '');
  const styles = o.html ? headStyles(o.html) : '';
  const newHtml = input.newHtml ?? (input.newText ? textToHtml(input.newText) : '');

  const html =
    `<html><head><meta http-equiv="Content-Type" content="text/html; charset=utf-8">${styles}</head><body>` +
    `<div>${newHtml}</div><p style="margin:0">&nbsp;</p>` +
    `<div>${headerHtml}${originalHtml}</div>` +
    `</body></html>`;

  const text =
    `${input.newText ?? ''}\n\n________________________________\n` +
    rows.map(([k, v]) => `${k}: ${v}`).join('\n') +
    `\n\n${o.text ?? ''}`;

  return { html, text };
}
