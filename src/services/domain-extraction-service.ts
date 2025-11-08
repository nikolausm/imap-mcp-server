/**
 * Domain Extraction Service for DNS Firewall Validation
 *
 * Extracts all domains from email messages for threat detection.
 * Uses regex patterns to extract domains from headers and body content.
 *
 * Author: Colin Bitterfield
 * Email: colin@bitterfield.com
 * Version: 1.0.0
 */

import { EmailContent } from '../types/index.js';

export interface DomainExtractionResult {
  uid: number;
  domains: string[];
}

export class DomainExtractionService {
  // Regex patterns for domain extraction
  private static readonly URL_PATTERN = /https?:\/\/([^\/\s<>"']+)/gi;
  private static readonly EMAIL_PATTERN = /[a-zA-Z0-9._%+-]+@([a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/gi;
  private static readonly DOMAIN_PATTERN = /(?:^|[\s<>"'])([a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}(?=$|[\s<>"'])/gi;

  /**
   * Extract domains from email headers
   */
  extractFromHeaders(from: string, to?: string[], replyTo?: string): Set<string> {
    const domains = new Set<string>();

    // Extract from 'From' header
    if (from) {
      const fromDomains = this.extractDomainsFromText(from);
      fromDomains.forEach(d => domains.add(d));
    }

    // Extract from 'To' headers
    if (to) {
      to.forEach(addr => {
        const toDomains = this.extractDomainsFromText(addr);
        toDomains.forEach(d => domains.add(d));
      });
    }

    // Extract from 'Reply-To' header
    if (replyTo) {
      const replyDomains = this.extractDomainsFromText(replyTo);
      replyDomains.forEach(d => domains.add(d));
    }

    return domains;
  }

  /**
   * Extract domains from email body content
   */
  extractFromBody(textContent?: string, htmlContent?: string): Set<string> {
    const domains = new Set<string>();

    // Extract from plain text body
    if (textContent) {
      const textDomains = this.extractDomainsFromText(textContent);
      textDomains.forEach(d => domains.add(d));
    }

    // Extract from HTML body (strip tags and extract)
    if (htmlContent) {
      const htmlDomains = this.extractDomainsFromText(htmlContent);
      htmlDomains.forEach(d => domains.add(d));
    }

    return domains;
  }

  /**
   * Extract all domains from a single email message
   */
  extractAllDomains(message: EmailContent): string[] {
    const allDomains = new Set<string>();

    // Extract from headers
    const headerDomains = this.extractFromHeaders(
      message.from,
      message.to,
      message.inReplyTo
    );
    headerDomains.forEach(d => allDomains.add(d));

    // Extract from body
    const bodyDomains = this.extractFromBody(
      message.textContent,
      message.htmlContent
    );
    bodyDomains.forEach(d => allDomains.add(d));

    return Array.from(allDomains);
  }

  /**
   * Extract domains from multiple messages
   * Returns Map of UID -> domains[]
   */
  extractFromMessages(messages: EmailContent[]): Map<number, string[]> {
    const results = new Map<number, string[]>();

    for (const message of messages) {
      const domains = this.extractAllDomains(message);
      results.set(message.uid, domains);
    }

    return results;
  }

  /**
   * Get all unique domains across multiple messages
   */
  getUniqueDomains(messages: EmailContent[]): string[] {
    const allDomains = new Set<string>();

    for (const message of messages) {
      const domains = this.extractAllDomains(message);
      domains.forEach(d => allDomains.add(d));
    }

    return Array.from(allDomains);
  }

  /**
   * Core regex-based domain extraction from any text
   */
  private extractDomainsFromText(text: string): Set<string> {
    const domains = new Set<string>();

    // Extract from URLs
    let match: RegExpExecArray | null;
    const urlRegex = new RegExp(DomainExtractionService.URL_PATTERN);
    while ((match = urlRegex.exec(text)) !== null) {
      const domain = this.normalizeDomain(match[1]);
      if (domain) domains.add(domain);
    }

    // Extract from email addresses
    const emailRegex = new RegExp(DomainExtractionService.EMAIL_PATTERN);
    while ((match = emailRegex.exec(text)) !== null) {
      const domain = this.normalizeDomain(match[1]);
      if (domain) domains.add(domain);
    }

    return domains;
  }

  /**
   * Normalize domain (lowercase, remove trailing dots, etc.)
   */
  private normalizeDomain(domain: string): string | null {
    if (!domain) return null;

    // Convert to lowercase
    let normalized = domain.toLowerCase();

    // Remove trailing dot
    normalized = normalized.replace(/\.$/, '');

    // Remove port if present
    normalized = normalized.replace(/:\d+$/, '');

    // Remove www. prefix (optional - helps with deduplication)
    // normalized = normalized.replace(/^www\./, '');

    // Basic validation - must have at least one dot and valid TLD
    if (!normalized.includes('.')) return null;
    if (normalized.length < 4) return null; // e.g., "a.co"
    if (normalized.startsWith('.') || normalized.endsWith('.')) return null;

    return normalized;
  }

  /**
   * Filter out common safe domains (optional optimization)
   */
  filterSafeDomains(domains: string[]): string[] {
    const commonSafeDomains = new Set([
      'gmail.com',
      'google.com',
      'yahoo.com',
      'outlook.com',
      'hotmail.com',
      'icloud.com',
      'apple.com',
      'microsoft.com',
    ]);

    return domains.filter(d => !commonSafeDomains.has(d));
  }
}
