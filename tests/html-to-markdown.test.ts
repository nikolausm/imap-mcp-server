import { describe, it, expect } from 'vitest';
import { htmlToMarkdown, normalizeWhitespace } from '../src/services/html-to-markdown.js';

describe('htmlToMarkdown', () => {
  it('returns empty string for empty/whitespace input', () => {
    expect(htmlToMarkdown('')).toBe('');
    expect(htmlToMarkdown('   \n  ')).toBe('');
    expect(htmlToMarkdown(null)).toBe('');
    expect(htmlToMarkdown(undefined)).toBe('');
  });

  it('flattens layout/data tables to readable cell text without leaking raw HTML', () => {
    // Email tables (incl. heading-less layout tables) must NOT come back as raw <table> HTML.
    const html = `
      <table>
        <thead><tr><th>Artikel</th><th>Menge</th></tr></thead>
        <tbody><tr><td>Chain Wax</td><td>1</td></tr></tbody>
      </table>
      <table><tr><td><p>Layout cell A</p></td><td><p>Layout cell B</p></td></tr></table>`;
    const md = htmlToMarkdown(html);
    expect(md).toContain('Artikel');
    expect(md).toContain('Chain Wax');
    expect(md).toContain('Layout cell A');
    expect(md).toContain('Layout cell B');
    expect(md).not.toMatch(/<\/?table/i);
    expect(md).not.toMatch(/<\/?t[rdh]/i);
  });

  it('strips hidden / preheader nodes (display:none, max-height:0, font-size:0, opacity:0)', () => {
    const html = `
      <p style="display:none">HIDDEN PREHEADER</p>
      <div style="max-height:0px">collapsed</div>
      <span style="font-size:0">zero font</span>
      <p style="opacity:0">invisible</p>
      <p>Visible body</p>`;
    const md = htmlToMarkdown(html);
    expect(md).toContain('Visible body');
    expect(md).not.toContain('HIDDEN PREHEADER');
    expect(md).not.toContain('collapsed');
    expect(md).not.toContain('zero font');
    expect(md).not.toContain('invisible');
  });

  it('keeps img alt text (where product names live) and drops the image itself', () => {
    const md = htmlToMarkdown('<img alt="Fitgadgets Chain Wax" src="https://track.example/pixel.gif">');
    expect(md).toContain('Fitgadgets Chain Wax');
    expect(md).not.toContain('pixel.gif');
    expect(md).not.toContain('![');
  });

  it('drops images with no alt (tracking pixels)', () => {
    const md = htmlToMarkdown('<p>Body</p><img src="https://track.example/p.gif" width="1" height="1">');
    expect(md.trim()).toBe('Body');
  });

  it('shortens long tracking URLs to the path before the query', () => {
    const longUrl = 'https://example.com/path?utm_source=' + 'x'.repeat(120);
    const md = htmlToMarkdown(`<a href="${longUrl}">Order details</a>`);
    expect(md).toContain('[Order details](https://example.com/path)');
    expect(md).not.toContain('utm_source');
  });

  it('keeps short links inline and renders mailto as plain text', () => {
    expect(htmlToMarkdown('<a href="https://ame3.ai/x">link</a>')).toContain('[link](https://ame3.ai/x)');
    const mailto = htmlToMarkdown('<a href="mailto:peter@example.com">Peter</a>');
    expect(mailto).toBe('Peter');
  });

  it('removes <style>/<script> content entirely and emits no raw HTML tags', () => {
    const html = `<style>.x{color:red}</style><script>track()</script><h1>Heading</h1><p>Para</p>`;
    const md = htmlToMarkdown(html);
    expect(md).toContain('# Heading');
    expect(md).toContain('Para');
    expect(md).not.toContain('color:red');
    expect(md).not.toContain('track()');
    expect(md).not.toMatch(/<[a-z][^>]*>/i);
  });

  it('collapses invisible spacer chars and excess blank lines', () => {
    const out = normalizeWhitespace('a­​‌\n\n\n\nb c   \n');
    expect(out).toBe('a\n\nb c');
  });
});
