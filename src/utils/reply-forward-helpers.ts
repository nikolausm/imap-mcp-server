import type { EmailContent, ImapAccount } from '../types/index.js';
import { htmlToText } from 'html-to-text';

/**
 * Check if an email is HTML-only (no genuine text/plain part).
 * Uses Content-Type header and textContent presence:
 * - top-level text/html => HTML-only (mailparser synthesizes text from HTML)
 * - top-level multipart/* => HTML-only iff textContent is empty/undefined (no genuine text/plain found)
 */
function isHtmlOnlyMessage(email: EmailContent): boolean {
  const contentType = email.headers['content-type'] || email.headers['Content-Type'];
  if (!contentType) return false;

  // Handle both string and object formats
  const contentTypeStr = Array.isArray(contentType)
    ? contentType[0]
    : (typeof contentType === 'string'
       ? contentType
       : (contentType as any).value || String(contentType));

  if (typeof contentTypeStr !== 'string') return false;

  // If top-level is text/html, mailparser synthesizes text from HTML, so no genuine text/plain
  if (contentTypeStr.includes('text/html') && !contentTypeStr.includes('multipart')) {
    return true;
  }

  // For multipart messages: HTML-only if no textContent exists (no genuine text/plain found)
  if (contentTypeStr.includes('multipart')) {
    return !email.textContent;
  }

  // Fallback: assume not HTML-only if we can't determine
  return false;
}

/**
 * Escape a string for safe insertion into HTML text content. */
function escapeHtmlText(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Escape a string for safe insertion into an HTML attribute value. */
function escapeHtmlAttribute(s: string): string {
  return s.replace(/&/g, '&amp;')
           .replace(/</g, '&lt;')
           .replace(/>/g, '&gt;')
           .replace(/"/g, '&quot;')
           .replace(/'/g, '&#x27;');
}

/**
 * Clean up Outlook SafeLinks in HTML for quoting.
 * Replaces links to *.safelinks.protection.outlook.com with their original destination.
 * Preserves human-readable anchor text when present.
 */
function cleanSafeLinks(html: string): string {
  const SAFELINKS_HOST = '.safelinks.protection.outlook.com';

  return html.replace(/<a\s+([^>]*?)href="([^"]*)"([^>]*?)>([^<]*)<\/a>/g, (match, beforeHref, href, afterHref, textContent) => {
    try {
      const url = new URL(href);
      if (!url.hostname.endsWith(SAFELINKS_HOST)) {
        return match;
      }

      // URLSearchParams.get() already percent-decodes, so no need for decodeURIComponent
      const originalUrl = url.searchParams.get('url');
      if (!originalUrl) {
        return match;
      }

      // Validate the destination URL and check protocol
      try {
        const decodedUrlObj = new URL(originalUrl);
        // Only unwrap SafeLinks with http: or https: destinations
        if (!['http:', 'https:'].includes(decodedUrlObj.protocol)) {
          return match;
        }
        // Reconstruct the anchor with cleaned href
        // Use originalUrl directly as it's already decoded by URLSearchParams.get()
        const escapedHref = escapeHtmlAttribute(originalUrl);

        // If visible text is the SafeLink URL itself (allowing &amp; vs &), replace with original
        const unescapedText = textContent.replace(/&amp;/g, '&');
        const cleanText = unescapedText.trim() === href ? originalUrl : textContent;

        // Only escape the replacement text; preserve existing human-readable text unchanged
        const escapedText = cleanText === originalUrl ? escapeHtmlText(cleanText) : cleanText;

        // Reconstruct: ensure proper spacing around href attribute
        const normalizedBeforeHref = beforeHref.trim() ? beforeHref.trim() + ' ' : '';
        return `<a ${normalizedBeforeHref}href="${escapedHref}"${afterHref}>${escapedText}</a>`;
      } catch {
        return match;
      }
    } catch {
      return match;
    }
  });
}

/**
 * Generate reply subject with proper "Re:" prefixing.
 * Avoids accumulating multiple "Re:" prefixes.
 */
export function generateReplySubject(originalSubject: string): string {
  const trimmed = originalSubject.trim();
  if (trimmed.startsWith('Re: ') || trimmed.startsWith('re: ') || trimmed.startsWith('RE: ')) {
    return trimmed;
  }
  return `Re: ${trimmed}`;
}

/**
 * Generate forward subject with proper "Fwd:" prefixing.
 * Avoids accumulating multiple "Fwd:" prefixes.
 */
export function generateForwardSubject(originalSubject: string): string {
  const trimmed = originalSubject.trim();
  if (trimmed.startsWith('Fwd: ') || trimmed.startsWith('fwd: ') || trimmed.startsWith('FWD: ')) {
    return trimmed;
  }
  return `Fwd: ${trimmed}`;
}

/**
 * Compose reply body with conventional attribution and quoting.
 * New content appears first, followed by quoted original when requested.
 */
export function composeReplyBody(
  newText: string | undefined,
  newHtml: string | undefined,
  originalEmail: EmailContent,
  includeQuotedOriginal: boolean
): { text: string; html: string | undefined } {
  const newContentText = newText ?? '';
  const newContentHtml = newHtml;

  if (!includeQuotedOriginal) {
    return {
      text: newContentText,
      html: newContentHtml
    };
  }

  // Get clean text for quoting
  // - For multipart messages with genuine text/plain: use textContent directly
  // - For HTML-only messages: derive clean text from textAsHtml to avoid synthesized artifacts
  // - Fallback to htmlContent (raw HTML) when textAsHtml is unavailable (e.g., multipart/mixed with text/html + attachment)
  const cleanTextAsHtml = originalEmail.textAsHtml ? cleanSafeLinks(originalEmail.textAsHtml) : undefined;
  const cleanHtmlContent = originalEmail.htmlContent ? cleanSafeLinks(originalEmail.htmlContent) : undefined;
  const cleanHtml = cleanTextAsHtml || cleanHtmlContent; // Reuse for HTML quoting
  const originalTextForQuoting = isHtmlOnlyMessage(originalEmail)
    ? (cleanTextAsHtml ? htmlToText(cleanTextAsHtml, { wordwrap: false })
       : (cleanHtmlContent ? htmlToText(cleanHtmlContent, { wordwrap: false })
          : ""))
    : (originalEmail.textContent || "");

  // Attribution with no artificial separator - use escaped values
  const escapedFrom = escapeHtmlText(originalEmail.from);
  const attributionLine = `\n\nOn ${originalEmail.date.toLocaleString()}, ${originalEmail.from} wrote:`;
  
  // Quote each line of original content with "> " prefix
  const quotedOriginalText = originalTextForQuoting
    .split('\n')
    .map(line => (line.trim() ? `> ${line}` : '>'))
    .join('\n');

  const fullText = newContentText + attributionLine + '\n' + quotedOriginalText;

  // Build HTML content if HTML was provided or if we have clean HTML to quote
  let fullHtml: string | undefined;

  if (newContentHtml) {
    // Attribution with no artificial separator - use escaped values
    const attributionHtml = `<p>On ${escapeHtmlText(originalEmail.date.toLocaleString())}, ${escapedFrom} wrote:</p>`;
    // Use cleanHtml (textAsHtml preferred, htmlContent as fallback)
    const quotedHtml = cleanHtml
      ? `<blockquote type="cite">${cleanHtml}</blockquote>`
      : (originalEmail.textContent
         ? `<blockquote type="cite">${escapeHtmlText(originalEmail.textContent).replace(/\n/g, '<br/>')}</blockquote>`
         : '');
    fullHtml = `${newContentHtml}${attributionHtml}${quotedHtml}`;
  } else if (newContentText) {
    // If no HTML provided, create basic HTML with paragraph preservation
    const attributionHtml = `<p>On ${escapeHtmlText(originalEmail.date.toLocaleString())}, ${escapedFrom} wrote:</p>`;
    // Use cleanHtml (textAsHtml preferred, htmlContent as fallback)
    const quotedHtml = cleanHtml
      ? `<blockquote type="cite">${cleanHtml}</blockquote>`
      : (originalEmail.textContent
         ? `<blockquote type="cite">${escapeHtmlText(originalEmail.textContent).replace(/\n/g, '<br/>')}</blockquote>`
         : '');
    // Preserve paragraphs from newContentText: double newlines -> separate <p>
    const paragraphs = newContentText
      .split('\n\n')
      .map(p => `<p>${escapeHtmlText(p).replace(/\n/g, '<br/>')}</p>`)
      .join('');
    fullHtml = `${paragraphs}${attributionHtml}${quotedHtml}`;
  }

  return {
    text: fullText,
    html: fullHtml
  };
}

/**
 * Compose forwarded message body with conventional header block.
 * New content appears first, followed by forwarded message header and original content.
 */
export function composeForwardBody(
  newText: string | undefined,
  newHtml: string | undefined,
  originalEmail: EmailContent,
  includeQuotedOriginal: boolean
): { text: string; html: string | undefined } {
  const newContentText = newText ?? '';
  const newContentHtml = newHtml;

  if (!includeQuotedOriginal) {
    return {
      text: newContentText,
      html: newContentHtml
    };
  }

  // Build forwarded message header for text
  const forwardHeaderText = `

---------- Forwarded message ----------
From: ${originalEmail.from}
Date: ${originalEmail.date.toLocaleString()}
Subject: ${originalEmail.subject}
To: ${originalEmail.to.join(',')}

`;

  // Get clean text for quoting
  // - For multipart messages with genuine text/plain: use textContent directly
  // - For HTML-only messages: derive clean text from textAsHtml to avoid synthesized artifacts
  // - Fallback to htmlContent (raw HTML) when textAsHtml is unavailable (e.g., multipart/mixed with text/html + attachment)
  const cleanTextAsHtml = originalEmail.textAsHtml ? cleanSafeLinks(originalEmail.textAsHtml) : undefined;
  const cleanHtmlContent = originalEmail.htmlContent ? cleanSafeLinks(originalEmail.htmlContent) : undefined;
  const cleanHtml = cleanTextAsHtml || cleanHtmlContent; // Reuse for HTML quoting
  const originalTextForQuoting = isHtmlOnlyMessage(originalEmail)
    ? (cleanTextAsHtml ? htmlToText(cleanTextAsHtml, { wordwrap: false })
       : (cleanHtmlContent ? htmlToText(cleanHtmlContent, { wordwrap: false })
          : ""))
    : (originalEmail.textContent || "");
  const fullText = newContentText + forwardHeaderText + originalTextForQuoting;

  // Build HTML if requested
  let fullHtml: string | undefined;

  // Also check cleanHtml (which may come from htmlContent fallback)
  if (newContentHtml || cleanHtml || originalEmail.textContent) {
    const forwardHeaderHtml = `
<div>---------- Forwarded message ----------</div>
<div><strong>From:</strong> ${escapeHtmlText(originalEmail.from)}</div>
<div><strong>Date:</strong> ${escapeHtmlText(originalEmail.date.toLocaleString())}</div>
<div><strong>Subject:</strong> ${escapeHtmlText(originalEmail.subject)}</div>
<div><strong>To:</strong> ${escapeHtmlText(originalEmail.to.join(','))}</div>
<br>
`;
    // Use cleanHtml (textAsHtml preferred, htmlContent as fallback)
    const quotedContent = cleanHtml
      ? cleanHtml
      : (originalEmail.textContent
         ? escapeHtmlText(originalEmail.textContent).replace(/\n/g, '<br/>')
         : '');
    fullHtml = (newContentHtml || '') + forwardHeaderHtml + (quotedContent ? `<blockquote type="cite">${quotedContent}</blockquote>` : '');
  }

  return {
    text: fullText,
    html: fullHtml
  };
}
