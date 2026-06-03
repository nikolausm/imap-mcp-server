// HTML -> Markdown conversion for email bodies.
//
// Why this exists: imap_get_email used to return the raw text/html part, which for a single
// marketing mail can be ~119k characters of <style>/markup/tracking. That crossed the MCP->LLM
// boundary and blew the token budget. This module turns the HTML into compact Markdown so the
// raw HTML never leaves the server.
//
// Turndown (+ gfm plugin) does the heavy lifting; the custom rules below tune it for email:
//   - strip <style>/<script>/<head>/<title>/<noscript>
//   - drop hidden / preheader nodes (display:none, max-height:0, font-size:0, opacity:0, ...)
//   - render <img> as its alt text only (e.g. Amazon product names live in alt), drop the image
//   - shorten tracking URLs and drop empty/mailto-duplicate anchors
//   - collapse invisible spacer chars and blank-line runs
//
// Rule precedence note: Turndown's addRule() *prepends* (so user rules win over the built-in
// CommonMark rules), but remove() appends to a separate list that is only consulted AFTER the
// main rule array. A <p style="display:none"> therefore matches the built-in paragraph rule
// before any remove()-registered filter, so hidden-stripping MUST go through addRule(), not
// remove(). Verified empirically (turndown 7.2.x).

import TurndownService from 'turndown';
import gfmPlugin from 'turndown-plugin-gfm';

// Use ONLY the strikethrough plugin, not the full gfm bundle. The gfm `tables` plugin registers
// a turndownService.keep() for any table without a <th> heading row (lib line ~132), i.e. it
// emits the raw HTML for that table. Marketing emails are built almost entirely from nested
// LAYOUT tables (no heading row), so the full gfm bundle would leak raw HTML for the typical
// email. We instead flatten tables to plain blocks (see the table rules below).
const { strikethrough } = gfmPlugin;

// zero-width / invisible / formatting chars used as preheader spacers in marketing mail
// (mirrors _INVISIBLE in _Tools/scripts/mail-body-clean.py; incl. U+00AD soft hyphen, U+034F).
// Written as ASCII \u escapes on purpose: some of these (e.g. U+2028) are line terminators and
// would break a regex literal written with the raw characters.
const INVISIBLE_CODE_POINTS = [
  0x00ad, 0x034f, 0x061c, 0x115f, 0x1160, 0x17b4, 0x17b5, 0x180e,
  0x200b, 0x200c, 0x200d, 0x200e, 0x200f, 0x2028, 0x2029,
  0x202a, 0x202b, 0x202c, 0x202d, 0x202e,
  0x2060, 0x2061, 0x2062, 0x2063, 0x2064,
  0x2066, 0x2067, 0x2068, 0x2069, 0x206a, 0x206b, 0x206c, 0x206d, 0x206e, 0x206f,
  0xfeff,
];
const INVISIBLE = new RegExp(
  '[' + INVISIBLE_CODE_POINTS.map((c) => '\\u' + c.toString(16).padStart(4, '0')).join('') + ']',
  'g',
);
const NBSP = /\u00a0/g;

function isHidden(node: any): boolean {
  if (!node || typeof node.getAttribute !== 'function') return false;
  const style = (node.getAttribute('style') || '').replace(/\s+/g, '').toLowerCase();
  if (!style) return false;
  return /display:none|visibility:hidden|(?:max-height|font-size|line-height|opacity):0(?![.\d])/.test(style);
}

function buildService(): TurndownService {
  const td = new TurndownService({
    headingStyle: 'atx',
    bulletListMarker: '-',
    codeBlockStyle: 'fenced',
    emDelimiter: '*',
  });

  td.use(strikethrough);

  // Tags whose content is never readable body text.
  td.remove(['style', 'script', 'head', 'title', 'noscript']);

  // Flatten tables to plain blocks. Email tables are overwhelmingly layout scaffolding; rendering
  // them as a GFM grid is noise, and (see import note) the gfm tables plugin would keep them as
  // raw HTML. table/thead/tbody/tfoot/tr are transparent (emit their content); each cell becomes
  // its own block so cell text never glues together. addRule prepends, so these win over both the
  // built-in handling and any plugin rule.
  td.addRule('flattenTableContainers', {
    filter: ['table', 'thead', 'tbody', 'tfoot', 'tr', 'colgroup', 'col', 'caption'],
    replacement: (content: string) => content,
  });
  td.addRule('flattenTableCell', {
    filter: ['th', 'td'],
    replacement: (content: string) => {
      const t = content.trim();
      return t ? t + '\n\n' : '';
    },
  });

  // Hidden / preheader subtrees. Must be addRule (prepends -> precedence) so it preempts the
  // built-in paragraph/div handling. replacement returns '' to discard the rendered subtree.
  td.addRule('stripHidden', {
    filter: (node: any) => isHidden(node),
    replacement: () => '',
  });

  // Images: keep only the alt text (product names, captions); drop the <img> itself.
  td.addRule('imgAlt', {
    filter: 'img',
    replacement: (_content: string, node: any) => {
      const alt = (node.getAttribute('alt') || '').trim();
      return alt || '';
    },
  });

  // Links: shorten tracking URLs, drop empty/mailto-duplicate anchors.
  td.addRule('shortLink', {
    filter: (node: any) => node.nodeName === 'A' && !!node.getAttribute('href'),
    replacement: (content: string, node: any) => {
      const text = content.trim();
      if (!text) return '';
      let href = (node.getAttribute('href') || '').trim();
      if (!href || href.startsWith('mailto:')) return text;
      if (href.length > 100) href = href.split(/[?#]/)[0]; // drop query/fragment (almost always tracking)
      if (!href || href === text) return text;
      return `[${text}](${href})`;
    },
  });

  return td;
}

// Module singleton: rules are static, the service is stateless across conversions.
const service = buildService();

/**
 * Convert an HTML email body to compact Markdown.
 * Returns '' for empty/whitespace-only input. Never throws on conversion failure: on error it
 * falls back to a crude tag-strip so the caller always gets readable text.
 */
export function htmlToMarkdown(html: string | null | undefined): string {
  if (!html || !html.trim()) return '';
  let md: string;
  try {
    md = service.turndown(html);
  } catch {
    // Defensive fallback: strip tags so a converter bug never blanks the body entirely.
    md = html.replace(/<[^>]+>/g, ' ');
  }
  return normalizeWhitespace(md);
}

/** Collapse invisible spacer chars, NBSP, and excess blank lines; trim each line. */
export function normalizeWhitespace(text: string): string {
  let t = text.replace(INVISIBLE, '').replace(NBSP, ' ');
  t = t.replace(/[ \t]+\n/g, '\n');
  t = t.replace(/\n{3,}/g, '\n\n');
  t = t
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/g, ''))
    .join('\n');
  return t.trim();
}
