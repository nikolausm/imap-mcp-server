import type { EmailContent, ImapAccount } from '../types/index.js';
import { extractMessageIds } from './client-side-search.js';
import { mergeBcc } from './default-bcc.js';
import { parseSerializedArray } from './array-input.js';
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

      const originalUrl = url.searchParams.get('url');
      if (!originalUrl) {
        return match;
      }

      const decodedUrl = decodeURIComponent(originalUrl);
      try {
        new URL(decodedUrl);
      } catch {
        return match;
      }

      // If visible text is the SafeLink URL itself (allowing &amp; vs &), replace with original
      const unescapedText = textContent.replace(/&amp;/g, '&');
      const cleanText = unescapedText.trim() === href ? decodedUrl : textContent;
      return `<a href="${decodedUrl}"${beforeHref}${afterHref}>${cleanText}</a>`;
    } catch {
      return match;
    }
  });
}

/**
 * Normalize a Message-ID for comparison: strip angle brackets, trim, lowercase.
 * Used only for detecting duplicates, not for serialization.
 */
function normalizeMessageIdForComparison(messageId: string | undefined): string {
  if (!messageId) return '';
  return messageId.replace(/^<+|>+$/g, '').trim().toLowerCase();
}

/**
 * Format a Message-ID in canonical RFC 5322 form: <...>.
 * If already in angle brackets, preserve as-is.
 */
function canonicalMessageId(messageId: string): string {
  if (!messageId) return '';
  const trimmed = messageId.trim();
  if (trimmed.startsWith('<') && trimmed.endsWith('>')) {
    return trimmed;
  }
  return `<${trimmed.replace(/^<+|>+$/g, '').trim()}>`;
}

/**
 * Extract the bare email address from a potentially formatted address.
 * Handles: 'Alice <alice@example.com>' -> 'alice@example.com'
 * Returns lowercase for case-insensitive comparison.
 */
export function extractEmail(addr: string): string {
  const match = addr.match(/<([^>]+)>/);
  return (match ? match[1] : addr).trim().toLowerCase();
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
 * Extract reply recipients based on original email and replyAll flag.
 * Respects Reply-To header over From per RFC 5322.
 * Excludes the user's own email address to avoid self-delivery.
 * Returns separate to and cc arrays to preserve semantic distinction.
 */
export function extractReplyRecipients(
  originalEmail: EmailContent,
  accountEmail: string,
  replyAll: boolean
): { to: string[], cc: string[] } {
  const normalizedAccountEmail = extractEmail(accountEmail);
  
  // Respect Reply-To header over From per RFC 5322
  const headers = originalEmail.headers || {};
  const replyToHeader = headers['reply-to'] || headers['Reply-To'];
  const replyToAddresses = Array.isArray(replyToHeader) ? replyToHeader : replyToHeader ? [replyToHeader] : [];
  const primaryRecipient = replyToAddresses.length > 0 ? replyToAddresses[0] : originalEmail.from;

  // For normal reply, just use the primary recipient
  if (!replyAll) {
    return {
      to: [primaryRecipient],
      cc: []
    };
  }

  // For reply-all, preserve To and Cc semantics
  const to: string[] = [];
  const cc: string[] = [];
  const seen = new Set<string>([normalizedAccountEmail]);
  
  // Add primary recipient to To
  const primaryNormalized = extractEmail(primaryRecipient);
  if (!seen.has(primaryNormalized)) {
    to.push(primaryRecipient);
    seen.add(primaryNormalized);
  }

  // Add original To recipients to To (excluding self)
  for (const addr of originalEmail.to) {
    const normalized = extractEmail(addr);
    if (!seen.has(normalized)) {
      to.push(addr);
      seen.add(normalized);
    }
  }

  // Add original Cc recipients to Cc (excluding self)
  // Check if original email has Cc in headers
  const ccHeader = headers['cc'] || headers['Cc'];
  const ccAddresses = Array.isArray(ccHeader) ? ccHeader : ccHeader ? [ccHeader] : [];
  
  for (const addr of ccAddresses) {
    const normalized = extractEmail(addr);
    if (!seen.has(normalized)) {
      cc.push(addr);
      seen.add(normalized);
    }
  }

  return { to, cc };
}

/**
 * Build proper threading headers for a reply.
 * Preserves existing References chain and appends the original message's Message-ID.
 * Uses canonical RFC 5322 formatting and avoids rewriting existing tokens.
 */
export function buildReplyThreadingHeaders(originalEmail: EmailContent): {
  inReplyTo: string;
  references: string;
} {
  const originalMessageId = originalEmail.messageId;
  const rawReferences = (originalEmail.headers['references'] as string) ?? '';

  // Detect duplicate using normalized comparison
  const normalizedOriginal = normalizeMessageIdForComparison(originalMessageId);
  const existingNormalized = extractMessageIds(rawReferences);
  const hasDuplicate = existingNormalized.some(id => id === normalizedOriginal);

  // Preserve original formatting of existing References
  const references = hasDuplicate
    ? rawReferences.trim()
    : `${rawReferences.trim()}${rawReferences.trim() ? ' ' : ''}${canonicalMessageId(originalMessageId)}`;

  return {
    inReplyTo: canonicalMessageId(originalMessageId),
    references: references || canonicalMessageId(originalMessageId)
  };
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
  const cleanTextAsHtml = originalEmail.textAsHtml ? cleanSafeLinks(originalEmail.textAsHtml) : undefined;
  const originalTextForQuoting = isHtmlOnlyMessage(originalEmail)
    ? (cleanTextAsHtml ? htmlToText(cleanTextAsHtml, { wordwrap: false }) : "")
    : (originalEmail.textContent || "");

  // Attribution with no artificial separator
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
    // Attribution with no artificial separator
    const attributionHtml = `<p>On ${originalEmail.date.toLocaleString()}, ${originalEmail.from} wrote:</p>`;
    // Use textAsHtml for clean quoting (no Outlook markup)
    // Clean SafeLinks before quoting
    const cleanHtml = originalEmail.textAsHtml ? cleanSafeLinks(originalEmail.textAsHtml) : undefined;
    // Fallback: textContent -> simple escaped HTML, omit if neither available
    const quotedHtml = cleanHtml
      ? `<blockquote type="cite">${cleanHtml}</blockquote>`
      : (originalEmail.textContent
         ? `<blockquote type="cite">${originalEmail.textContent.replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br/>')}</blockquote>`
         : '');
    fullHtml = `${newContentHtml}${attributionHtml}${quotedHtml}`;
  } else if (newContentText) {
    // If no HTML provided, create basic HTML with paragraph preservation
    const attributionHtml = `<p>On ${originalEmail.date.toLocaleString()}, ${originalEmail.from} wrote:</p>`;
    // Use textAsHtml for clean quoting (no Outlook markup)
    // Clean SafeLinks before quoting
    const cleanHtml = originalEmail.textAsHtml ? cleanSafeLinks(originalEmail.textAsHtml) : undefined;
    // Fallback: textContent -> simple escaped HTML, omit if neither available
    const quotedHtml = cleanHtml
      ? `<blockquote type="cite">${cleanHtml}</blockquote>`
      : (originalEmail.textContent
         ? `<blockquote type="cite">${originalEmail.textContent.replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br/>')}</blockquote>`
         : '');
    // Preserve paragraphs from newContentText: double newlines -> separate <p>
    const paragraphs = newContentText
      .split('\n\n')
      .map(p => `<p>${p.replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br/>')}</p>`)
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
  const cleanTextAsHtml = originalEmail.textAsHtml ? cleanSafeLinks(originalEmail.textAsHtml) : undefined;
  const originalTextForQuoting = isHtmlOnlyMessage(originalEmail)
    ? (cleanTextAsHtml ? htmlToText(cleanTextAsHtml, { wordwrap: false }) : "")
    : (originalEmail.textContent || "");
  const fullText = newContentText + forwardHeaderText + originalTextForQuoting;

  // Build HTML if requested
  let fullHtml: string | undefined;

  if (newContentHtml || originalEmail.textAsHtml || originalEmail.textContent) {
    const forwardHeaderHtml = `
<div>---------- Forwarded message ----------</div>
<div><strong>From:</strong> ${originalEmail.from}</div>
<div><strong>Date:</strong> ${originalEmail.date.toLocaleString()}</div>
<div><strong>Subject:</strong> ${originalEmail.subject}</div>
<div><strong>To:</strong> ${originalEmail.to.join(',')}</div>
<br>
`;
    // Use textAsHtml for clean quoting (no Outlook markup)
    // Clean SafeLinks before quoting
    const cleanHtml = originalEmail.textAsHtml ? cleanSafeLinks(originalEmail.textAsHtml) : undefined;
    // Fallback: textContent -> simple escaped HTML, omit if neither available
    const quotedContent = cleanHtml
      ? cleanHtml
      : (originalEmail.textContent
         ? originalEmail.textContent.replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br/>')
         : '');
    fullHtml = (newContentHtml || '') + forwardHeaderHtml + (quotedContent ? `<blockquote type="cite">${quotedContent}</blockquote>` : '');
  }

  return {
    text: fullText,
    html: fullHtml
  };
}

/**
 * Resolve BCC merging account defaultBcc with explicit BCC.
 * Reuses the same logic as existing tools.
 */
export function resolveReplyForwardBcc(
  account: ImapAccount,
  explicitBcc?: string | string[]
): string | string[] | undefined {
  return mergeBcc(account.defaultBcc, explicitBcc);
}

/**
 * Normalize addresses for array input, same as existing tools.
 * Handles stringified arrays from MCP clients.
 */
export function normalizeAddresses(
  value: string | string[] | undefined,
  field: string
): string | string[] | undefined {
  return parseSerializedArray(value, field) as string | string[] | undefined;
}