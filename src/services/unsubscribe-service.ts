/**
 * Unsubscribe Service for IMAP MCP Pro
 *
 * Extracts and manages unsubscribe links from emails.
 * Implements Issue #45 Phase 4: Subscription Management
 *
 * Author: Colin Bitterfield
 * Email: colin.bitterfield@templeofepiphany.com
 * Version: 0.1.0
 * Date: 2025-11-07
 */

import { simpleParser, ParsedMail, AddressObject } from 'mailparser';
import { DatabaseService } from './database-service.js';
import { UnsubscribeLink, SubscriptionSummary } from '../types/database-types.js';

export interface ExtractedUnsubscribeInfo {
  unsubscribe_link?: string;
  list_unsubscribe_header?: string;
  unsubscribe_method?: 'http' | 'mailto' | 'both';
}

export interface EmailUnsubscribeData {
  user_id: string;
  account_id: string;
  folder: string;
  uid: number;
  sender_email: string;
  sender_name?: string;
  subject?: string;
  message_date?: Date;
  unsubscribe_info: ExtractedUnsubscribeInfo;
}

export class UnsubscribeService {
  private db: DatabaseService;

  constructor(db: DatabaseService) {
    this.db = db;
  }

  /**
   * Extract unsubscribe information from email raw content
   */
  async extractFromEmail(emailSource: string | Buffer): Promise<ExtractedUnsubscribeInfo> {
    try {
      const parsed = await simpleParser(emailSource);
      return this.extractFromParsedEmail(parsed);
    } catch (error) {
      console.error('[UnsubscribeService] Error parsing email:', error);
      return {};
    }
  }

  /**
   * Extract unsubscribe information from parsed email
   */
  extractFromParsedEmail(parsed: ParsedMail): ExtractedUnsubscribeInfo {
    const result: ExtractedUnsubscribeInfo = {};

    // 1. Check List-Unsubscribe header (RFC 2369)
    const listUnsubHeader = parsed.headers.get('list-unsubscribe');
    if (listUnsubHeader) {
      result.list_unsubscribe_header = String(listUnsubHeader);

      // Parse the header to extract links
      const headerStr = String(listUnsubHeader);
      const httpMatch = headerStr.match(/<(https?:\/\/[^>]+)>/);
      const mailtoMatch = headerStr.match(/<(mailto:[^>]+)>/);

      if (httpMatch && mailtoMatch) {
        result.unsubscribe_method = 'both';
        result.unsubscribe_link = httpMatch[1];
      } else if (httpMatch) {
        result.unsubscribe_method = 'http';
        result.unsubscribe_link = httpMatch[1];
      } else if (mailtoMatch) {
        result.unsubscribe_method = 'mailto';
        result.unsubscribe_link = mailtoMatch[1];
      }
    }

    // 2. Check List-Unsubscribe-Post header (RFC 8058 - One-Click Unsubscribe)
    const listUnsubPost = parsed.headers.get('list-unsubscribe-post');
    if (listUnsubPost && !result.unsubscribe_link) {
      // This header indicates one-click unsubscribe support
      // The List-Unsubscribe header contains the URL
      const headerStr = String(listUnsubHeader || '');
      const httpMatch = headerStr.match(/<(https?:\/\/[^>]+)>/);
      if (httpMatch) {
        result.unsubscribe_link = httpMatch[1];
        result.unsubscribe_method = 'http';
      }
    }

    // 3. Extract from HTML body if no header found
    if (!result.unsubscribe_link && parsed.html) {
      const htmlLink = this.extractFromHtml(parsed.html);
      if (htmlLink) {
        result.unsubscribe_link = htmlLink;
        result.unsubscribe_method = result.unsubscribe_method || 'http';
      }
    }

    // 4. Extract from text body as fallback
    if (!result.unsubscribe_link && parsed.text) {
      const textLink = this.extractFromText(parsed.text);
      if (textLink) {
        result.unsubscribe_link = textLink;
        result.unsubscribe_method = result.unsubscribe_method || 'http';
      }
    }

    return result;
  }

  /**
   * Extract unsubscribe link from HTML content
   */
  private extractFromHtml(html: string): string | undefined {
    // Common patterns for unsubscribe links in HTML
    const patterns = [
      // Look for links with "unsubscribe" text
      /<a[^>]*href=["']([^"']+)["'][^>]*>.*?unsubscribe.*?<\/a>/gi,
      // Look for links with "opt-out" text
      /<a[^>]*href=["']([^"']+)["'][^>]*>.*?opt[\s-]?out.*?<\/a>/gi,
      // Look for unsubscribe in href attribute
      /<a[^>]*href=["']([^"']*unsubscribe[^"']*)["']/gi,
      // Look for preference center links
      /<a[^>]*href=["']([^"']*preference.*center[^"']*)["']/gi,
    ];

    for (const pattern of patterns) {
      const matches = html.matchAll(pattern);
      for (const match of matches) {
        if (match[1]) {
          // Decode HTML entities and clean up
          const link = this.cleanUrl(match[1]);
          if (this.isValidUrl(link)) {
            return link;
          }
        }
      }
    }

    return undefined;
  }

  /**
   * Extract unsubscribe link from text content
   */
  private extractFromText(text: string): string | undefined {
    // Common patterns for unsubscribe links in plain text
    const patterns = [
      // Direct URLs with unsubscribe keyword
      /https?:\/\/[^\s]*unsubscribe[^\s]*/gi,
      // Unsubscribe followed by URL on same or next line
      /unsubscribe.*?(https?:\/\/[^\s]+)/gi,
      // Opt-out followed by URL
      /opt[\s-]?out.*?(https?:\/\/[^\s]+)/gi,
    ];

    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match) {
        // Extract just the URL part
        const urlMatch = match[0].match(/https?:\/\/[^\s]+/);
        if (urlMatch) {
          const link = this.cleanUrl(urlMatch[0]);
          if (this.isValidUrl(link)) {
            return link;
          }
        }
      }
    }

    return undefined;
  }

  /**
   * Clean and normalize URL
   */
  private cleanUrl(url: string): string {
    // Remove HTML entities
    url = url.replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"');

    // Remove trailing punctuation that's not part of URL
    url = url.replace(/[.,;!?]+$/, '');

    // Remove angle brackets
    url = url.replace(/^<|>$/g, '');

    return url.trim();
  }

  /**
   * Validate URL format
   */
  private isValidUrl(url: string): boolean {
    try {
      const parsed = new URL(url);
      return parsed.protocol === 'http:' || parsed.protocol === 'https:' || parsed.protocol === 'mailto:';
    } catch {
      return false;
    }
  }

  /**
   * Store unsubscribe link data in database
   */
  storeUnsubscribeLink(data: EmailUnsubscribeData): void {
    try {
      // Store in unsubscribe_links table
      this.db.insertUnsubscribeLink({
        user_id: data.user_id,
        account_id: data.account_id,
        folder: data.folder,
        uid: data.uid,
        sender_email: data.sender_email,
        subject: data.subject,
        unsubscribe_link: data.unsubscribe_info.unsubscribe_link,
        list_unsubscribe_header: data.unsubscribe_info.list_unsubscribe_header,
        message_date: data.message_date?.toISOString(),
      });

      // Update subscription_summary table
      this.updateSubscriptionSummary(data);

      console.error(`[UnsubscribeService] Stored unsubscribe link for ${data.sender_email}`);
    } catch (error) {
      console.error('[UnsubscribeService] Error storing unsubscribe link:', error);
      throw error;
    }
  }

  /**
   * Update subscription summary (aggregated view)
   */
  private updateSubscriptionSummary(data: EmailUnsubscribeData): void {
    // Extract domain from email
    const domain = data.sender_email.split('@')[1] || data.sender_email;

    // Categorize email type based on common patterns
    const category = this.categorizeEmail(data.sender_email, data.subject);

    this.db.upsertSubscriptionSummary({
      user_id: data.user_id,
      sender_email: data.sender_email,
      sender_domain: domain,
      sender_name: data.sender_name,
      unsubscribe_link: data.unsubscribe_info.unsubscribe_link,
      unsubscribe_method: data.unsubscribe_info.unsubscribe_method,
      category,
    });
  }

  /**
   * Categorize email type based on sender and subject
   */
  private categorizeEmail(sender: string, subject?: string): 'marketing' | 'newsletter' | 'promotional' | 'transactional' | 'other' {
    const senderLower = sender.toLowerCase();
    const subjectLower = subject?.toLowerCase() || '';

    // Newsletter indicators
    if (
      senderLower.includes('newsletter') ||
      senderLower.includes('digest') ||
      subjectLower.includes('newsletter') ||
      subjectLower.includes('digest')
    ) {
      return 'newsletter';
    }

    // Marketing indicators
    if (
      senderLower.includes('marketing') ||
      senderLower.includes('promo') ||
      subjectLower.includes('sale') ||
      subjectLower.includes('offer') ||
      subjectLower.includes('discount')
    ) {
      return 'marketing';
    }

    // Promotional indicators
    if (
      senderLower.includes('deals') ||
      subjectLower.includes('deal') ||
      subjectLower.includes('limited time') ||
      subjectLower.includes('exclusive')
    ) {
      return 'promotional';
    }

    // Transactional indicators
    if (
      senderLower.includes('noreply') ||
      senderLower.includes('no-reply') ||
      senderLower.includes('receipt') ||
      senderLower.includes('invoice') ||
      subjectLower.includes('order') ||
      subjectLower.includes('receipt') ||
      subjectLower.includes('invoice') ||
      subjectLower.includes('payment')
    ) {
      return 'transactional';
    }

    return 'other';
  }

  /**
   * Get subscription summary for a user
   */
  getSubscriptionSummary(userId: string, filters?: {
    category?: string;
    unsubscribed?: boolean;
  }): SubscriptionSummary[] {
    return this.db.getSubscriptionSummary(userId, filters);
  }

  /**
   * Mark a subscription as unsubscribed
   */
  markAsUnsubscribed(userId: string, senderEmail: string): void {
    this.db.markSubscriptionAsUnsubscribed(userId, senderEmail);
    console.error(`[UnsubscribeService] Marked ${senderEmail} as unsubscribed for user ${userId}`);
  }

  /**
   * Get all unsubscribe links for a user
   */
  getUnsubscribeLinks(userId: string, filters?: {
    account_id?: string;
    sender_email?: string;
  }): UnsubscribeLink[] {
    return this.db.getUnsubscribeLinks(userId, filters);
  }
}
