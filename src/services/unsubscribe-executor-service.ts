/**
 * IMAP MCP Pro - Unsubscribe Executor Service
 *
 * Author: Colin Bitterfield
 * Email: colin@bitterfield.com
 * Date Created: 2025-11-07
 * Date Updated: 2025-11-07
 * Version: 0.1
 *
 * This service handles the execution of unsubscribe requests from extracted
 * unsubscribe links. Supports both HTTP/HTTPS (GET/POST) and mailto methods.
 *
 * Related Issues: #47, #45 Phase 4, #15
 */

import { SmtpService } from './smtp-service.js';
import type { Account } from '../types/database-types.js';

/**
 * Result of an unsubscribe execution attempt
 */
export interface UnsubscribeResult {
  success: boolean;
  method: 'http-get' | 'http-post' | 'mailto';
  statusCode?: number;
  error?: string;
  details?: string;
}

/**
 * Parsed mailto link components
 */
export interface ParsedMailtoLink {
  to: string;
  subject?: string;
  body?: string;
  cc?: string;
  bcc?: string;
}

/**
 * Service for executing unsubscribe requests
 */
export class UnsubscribeExecutorService {
  private smtpService: SmtpService;

  // Security: Blacklist of known malicious domains
  private readonly DOMAIN_BLACKLIST = [
    'malware.com',
    'phishing.com',
    'scam.com',
    // Add more as needed
  ];

  // Rate limiting: Track requests per minute
  private requestTimestamps: number[] = [];
  private readonly MAX_REQUESTS_PER_MINUTE = 10;

  constructor(smtpService: SmtpService) {
    this.smtpService = smtpService;
  }

  /**
   * Execute an HTTP/HTTPS unsubscribe request (GET method)
   * @param link The unsubscribe URL
   * @param timeout Request timeout in milliseconds (default: 30000)
   * @returns Result of the unsubscribe attempt
   */
  async executeHttpUnsubscribe(
    link: string,
    timeout: number = 30000
  ): Promise<UnsubscribeResult> {
    try {
      // Validate URL
      const validationError = this.validateUrl(link);
      if (validationError) {
        return {
          success: false,
          method: 'http-get',
          error: validationError
        };
      }

      // Check rate limiting
      if (!this.checkRateLimit()) {
        return {
          success: false,
          method: 'http-get',
          error: 'Rate limit exceeded. Please wait before making more unsubscribe requests.'
        };
      }

      // Execute GET request with timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);

      try {
        const response = await fetch(link, {
          method: 'GET',
          headers: {
            'User-Agent': 'Mozilla/5.0 (compatible; IMAP-MCP-Pro/2.11.0; +https://github.com/Temple-of-Epiphany/imap-mcp-pro)',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.5',
          },
          redirect: 'follow',
          signal: controller.signal
        });

        clearTimeout(timeoutId);

        const isValid = this.validateUnsubscribeResponse(response);

        return {
          success: isValid,
          method: 'http-get',
          statusCode: response.status,
          details: isValid
            ? `Successfully unsubscribed (HTTP ${response.status})`
            : `Unexpected response (HTTP ${response.status})`
        };
      } catch (fetchError: any) {
        clearTimeout(timeoutId);

        if (fetchError.name === 'AbortError') {
          return {
            success: false,
            method: 'http-get',
            error: `Request timed out after ${timeout}ms`
          };
        }

        throw fetchError;
      }
    } catch (error: any) {
      return {
        success: false,
        method: 'http-get',
        error: error.message || 'Unknown error during HTTP GET request'
      };
    }
  }

  /**
   * Execute an HTTP/HTTPS POST unsubscribe request (RFC 8058 One-Click)
   * @param link The unsubscribe URL
   * @param postData Optional POST data (default: "List-Unsubscribe=One-Click")
   * @param timeout Request timeout in milliseconds (default: 30000)
   * @returns Result of the unsubscribe attempt
   */
  async executeHttpPostUnsubscribe(
    link: string,
    postData: string = 'List-Unsubscribe=One-Click',
    timeout: number = 30000
  ): Promise<UnsubscribeResult> {
    try {
      // Validate URL
      const validationError = this.validateUrl(link);
      if (validationError) {
        return {
          success: false,
          method: 'http-post',
          error: validationError
        };
      }

      // Check rate limiting
      if (!this.checkRateLimit()) {
        return {
          success: false,
          method: 'http-post',
          error: 'Rate limit exceeded. Please wait before making more unsubscribe requests.'
        };
      }

      // Execute POST request with timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);

      try {
        const response = await fetch(link, {
          method: 'POST',
          headers: {
            'User-Agent': 'Mozilla/5.0 (compatible; IMAP-MCP-Pro/2.11.0; +https://github.com/Temple-of-Epiphany/imap-mcp-pro)',
            'Content-Type': 'application/x-www-form-urlencoded',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          },
          body: postData,
          redirect: 'follow',
          signal: controller.signal
        });

        clearTimeout(timeoutId);

        const isValid = this.validateUnsubscribeResponse(response);

        return {
          success: isValid,
          method: 'http-post',
          statusCode: response.status,
          details: isValid
            ? `Successfully unsubscribed (HTTP ${response.status})`
            : `Unexpected response (HTTP ${response.status})`
        };
      } catch (fetchError: any) {
        clearTimeout(timeoutId);

        if (fetchError.name === 'AbortError') {
          return {
            success: false,
            method: 'http-post',
            error: `Request timed out after ${timeout}ms`
          };
        }

        throw fetchError;
      }
    } catch (error: any) {
      return {
        success: false,
        method: 'http-post',
        error: error.message || 'Unknown error during HTTP POST request'
      };
    }
  }

  /**
   * Execute a mailto unsubscribe request
   * @param link The mailto: link
   * @param fromAccount The email account to send from (ImapAccount format)
   * @returns Result of the unsubscribe attempt
   */
  async executeMailtoUnsubscribe(
    link: string,
    fromAccount: any  // ImapAccount format with id, name, host, port, user, password, tls, smtp
  ): Promise<UnsubscribeResult> {
    try {
      // Parse mailto link
      const parsed = this.parseMailtoLink(link);
      if (!parsed.to) {
        return {
          success: false,
          method: 'mailto',
          error: 'Invalid mailto link: no recipient address found'
        };
      }

      // Check rate limiting
      if (!this.checkRateLimit()) {
        return {
          success: false,
          method: 'mailto',
          error: 'Rate limit exceeded. Please wait before making more unsubscribe requests.'
        };
      }

      // Send unsubscribe email via SMTP
      await this.smtpService.sendEmail(fromAccount.id, fromAccount, {
        from: fromAccount.user,
        to: parsed.to,
        subject: parsed.subject || 'Unsubscribe Request',
        text: parsed.body || 'Please remove me from your mailing list.',
        cc: parsed.cc,
        bcc: parsed.bcc,
      });

      return {
        success: true,
        method: 'mailto',
        details: `Unsubscribe email sent to ${parsed.to}`
      };
    } catch (error: any) {
      return {
        success: false,
        method: 'mailto',
        error: error.message || 'Failed to send unsubscribe email'
      };
    }
  }

  /**
   * Parse a mailto: link into its components
   * @param link The mailto: link to parse
   * @returns Parsed components
   */
  parseMailtoLink(link: string): ParsedMailtoLink {
    const result: ParsedMailtoLink = { to: '' };

    try {
      // Remove mailto: prefix
      const mailtoPrefix = /^mailto:/i;
      let url = link.replace(mailtoPrefix, '');

      // Split into recipient and query parameters
      const [recipient, queryString] = url.split('?');
      result.to = decodeURIComponent(recipient);

      // Parse query parameters
      if (queryString) {
        const params = new URLSearchParams(queryString);

        if (params.has('subject')) {
          result.subject = params.get('subject') || undefined;
        }
        if (params.has('body')) {
          result.body = params.get('body') || undefined;
        }
        if (params.has('cc')) {
          result.cc = params.get('cc') || undefined;
        }
        if (params.has('bcc')) {
          result.bcc = params.get('bcc') || undefined;
        }
      }
    } catch (error) {
      // Return empty result on parsing error
      console.error('Error parsing mailto link:', error);
    }

    return result;
  }

  /**
   * Validate an unsubscribe URL
   * @param url The URL to validate
   * @returns Error message if invalid, null if valid
   */
  private validateUrl(url: string): string | null {
    try {
      const parsed = new URL(url);

      // Check protocol
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        return 'Invalid protocol: only HTTP and HTTPS are supported';
      }

      // Warn about HTTP (insecure)
      if (parsed.protocol === 'http:') {
        console.warn(`Warning: Insecure HTTP protocol used for ${url}`);
      }

      // Check domain blacklist
      const domain = parsed.hostname.toLowerCase();
      for (const blacklisted of this.DOMAIN_BLACKLIST) {
        if (domain.includes(blacklisted)) {
          return `Blocked domain: ${domain} is on the security blacklist`;
        }
      }

      return null;
    } catch (error) {
      return 'Invalid URL format';
    }
  }

  /**
   * Validate the response from an unsubscribe request
   * @param response The fetch Response object
   * @returns True if response indicates success
   */
  private validateUnsubscribeResponse(response: Response): boolean {
    // Consider 2xx status codes as successful
    if (response.status >= 200 && response.status < 300) {
      return true;
    }

    // Some services use 3xx redirects for successful unsubscribe
    if (response.status >= 300 && response.status < 400) {
      return true;
    }

    return false;
  }

  /**
   * Check if we're within rate limits
   * @returns True if request can proceed, false if rate limited
   */
  private checkRateLimit(): boolean {
    const now = Date.now();
    const oneMinuteAgo = now - 60000;

    // Remove timestamps older than 1 minute
    this.requestTimestamps = this.requestTimestamps.filter(
      timestamp => timestamp > oneMinuteAgo
    );

    // Check if we've exceeded the limit
    if (this.requestTimestamps.length >= this.MAX_REQUESTS_PER_MINUTE) {
      return false;
    }

    // Add current timestamp
    this.requestTimestamps.push(now);
    return true;
  }

  /**
   * Reset rate limiting (useful for testing)
   */
  resetRateLimit(): void {
    this.requestTimestamps = [];
  }
}
