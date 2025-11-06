/**
 * CleanTalk Anti-SPAM Service
 *
 * Integrates with CleanTalk API for email spam detection
 * API Documentation: https://cleantalk.org/help/api-spam-check
 *
 * Author: Colin Bitterfield
 * Email: colin.bitterfield@templeofepiphany.com
 * Date: 2025-11-06
 * Version: 1.0.0
 */

import { DatabaseService } from './database-service.js';

export interface CleanTalkCheckResult {
  email: string;
  appears: number; // 0 = not listed, 1 = listed
  spam_rate: number; // 0-1 (1 = 100% spam)
  frequency: number; // Count of websites reporting spam (0-9999)
  submitted?: string; // First spam activity timestamp
  updated?: string; // Last status update timestamp
  network_type?: string; // 'hosting', 'public', 'paid_vpn', 'tor', 'unknown'
  exists?: number | null; // 0=invalid, 1=valid, null=unknown
  disposable_email?: number; // 0=not disposable, 1=disposable
  country?: string; // ISO 3166-1 alpha-2 country code
  sha256?: string; // SHA256 hash
  isSpam: boolean; // Computed spam determination
  spamReason?: string; // Reason for spam classification
}

export interface SpamCheckCriteria {
  minSpamRate?: number; // Default: 0.5
  maxDaysSinceUpdate?: number; // Default: 30
  minFrequency?: number; // Default: 5
  checkDisposable?: boolean; // Default: true
  checkExists?: boolean; // Default: true
}

export class CleanTalkService {
  private db: DatabaseService;
  private apiUrl = 'https://api.cleantalk.org';
  private rateLimit = 100; // Calls per 60 seconds
  private maxRecords = 1000; // Max records per request

  constructor(db: DatabaseService) {
    this.db = db;
  }

  /**
   * Get CleanTalk API key for a user
   */
  private async getApiKey(userId: string): Promise<string> {
    const stmt = this.db['db'].prepare(`
      SELECT api_key FROM cleantalk_keys
      WHERE user_id = ? AND is_active = 1
      LIMIT 1
    `);

    const result = stmt.get(userId) as { api_key: string } | undefined;

    if (!result) {
      throw new Error(`No active CleanTalk API key found for user ${userId}`);
    }

    return result.api_key;
  }

  /**
   * Update CleanTalk key usage
   */
  private async updateKeyUsage(userId: string, apiKey: string): Promise<void> {
    const now = new Date();
    const stmt = this.db['db'].prepare(`
      SELECT daily_usage, usage_reset_at FROM cleantalk_keys
      WHERE user_id = ? AND api_key = ?
    `);

    const keyData = stmt.get(userId, apiKey) as { daily_usage: number; usage_reset_at: string };

    if (!keyData) return;

    const resetDate = new Date(keyData.usage_reset_at);
    let newUsage = keyData.daily_usage + 1;

    // Reset usage if it's a new day
    if (now.getTime() - resetDate.getTime() > 24 * 60 * 60 * 1000) {
      newUsage = 1;
      this.db['db'].prepare(`
        UPDATE cleantalk_keys
        SET daily_usage = ?, usage_reset_at = ?, last_used = ?
        WHERE user_id = ? AND api_key = ?
      `).run(newUsage, now.toISOString(), now.toISOString(), userId, apiKey);
    } else {
      this.db['db'].prepare(`
        UPDATE cleantalk_keys
        SET daily_usage = ?, last_used = ?
        WHERE user_id = ? AND api_key = ?
      `).run(newUsage, now.toISOString(), userId, apiKey);
    }
  }

  /**
   * Check if spam based on CleanTalk response and criteria
   */
  private determineSpam(data: any, criteria: SpamCheckCriteria = {}): { isSpam: boolean; reason?: string } {
    const {
      minSpamRate = 0.5,
      maxDaysSinceUpdate = 30,
      minFrequency = 5,
      checkDisposable = true,
      checkExists = true
    } = criteria;

    // Currently blacklisted
    if (data.appears === 1) {
      return { isSpam: true, reason: 'Currently in CleanTalk blacklist' };
    }

    // High spam rate
    if (data.spam_rate > 0.7) {
      return { isSpam: true, reason: `High spam rate: ${(data.spam_rate * 100).toFixed(1)}%` };
    }

    // Medium spam rate with recent activity
    if (data.spam_rate > minSpamRate && data.updated) {
      const daysSinceUpdate = (Date.now() - new Date(data.updated).getTime()) / (1000 * 60 * 60 * 24);
      if (daysSinceUpdate < maxDaysSinceUpdate) {
        return { isSpam: true, reason: `Spam rate ${(data.spam_rate * 100).toFixed(1)}% with recent activity (${Math.floor(daysSinceUpdate)} days ago)` };
      }
    }

    // High frequency spam reports
    if (data.spam_rate === 1 && data.frequency >= minFrequency && data.updated) {
      const daysSinceUpdate = (Date.now() - new Date(data.updated).getTime()) / (1000 * 60 * 60 * 24);
      if (daysSinceUpdate < 30) {
        return { isSpam: true, reason: `100% spam rate with ${data.frequency} reports in last 30 days` };
      }
    }

    // Very high frequency
    if (data.frequency >= 200 && data.updated) {
      const daysSinceUpdate = (Date.now() - new Date(data.updated).getTime()) / (1000 * 60 * 60 * 24);
      if (daysSinceUpdate < 90) {
        return { isSpam: true, reason: `High report frequency: ${data.frequency} reports in last 90 days` };
      }
    }

    // Disposable email
    if (checkDisposable && data.disposable_email === 1) {
      return { isSpam: true, reason: 'Disposable email address' };
    }

    // Invalid email
    if (checkExists && data.exists === 0) {
      return { isSpam: true, reason: 'Invalid/non-existent email address' };
    }

    return { isSpam: false };
  }

  /**
   * Check a single email address against CleanTalk
   */
  async checkEmail(userId: string, email: string, criteria: SpamCheckCriteria = {}): Promise<CleanTalkCheckResult> {
    const apiKey = await this.getApiKey(userId);

    // Build API URL
    const params = new URLSearchParams({
      method_name: 'spam_check',
      auth_key: apiKey,
      email: email
    });

    const url = `${this.apiUrl}/?${params.toString()}`;

    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'User-Agent': 'IMAP-MCP-Pro/2.6.0'
        }
      });

      if (!response.ok) {
        throw new Error(`CleanTalk API error: ${response.status} ${response.statusText}`);
      }

      const jsonResponse = await response.json() as any;

      // Check for API errors
      if (jsonResponse.error_no) {
        throw new Error(`CleanTalk API error ${jsonResponse.error_no}: ${jsonResponse.error_message}`);
      }

      // Extract result from data object
      const data = jsonResponse.data?.[email];

      if (!data) {
        throw new Error(`No data returned for email: ${email}`);
      }

      // Update usage tracking
      await this.updateKeyUsage(userId, apiKey);

      // Determine if spam
      const { isSpam, reason } = this.determineSpam(data, criteria);

      return {
        email,
        appears: data.appears || 0,
        spam_rate: data.spam_rate || 0,
        frequency: data.frequency || 0,
        submitted: data.submitted,
        updated: data.updated,
        network_type: data.network_type,
        exists: data.exists,
        disposable_email: data.disposable_email,
        country: data.country,
        sha256: data.sha256,
        isSpam,
        spamReason: reason
      };
    } catch (error) {
      throw new Error(`CleanTalk check failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Check multiple email addresses (batch)
   * Note: Limited to 1000 emails per request
   */
  async checkEmailsBatch(userId: string, emails: string[], criteria: SpamCheckCriteria = {}): Promise<CleanTalkCheckResult[]> {
    if (emails.length === 0) {
      return [];
    }

    if (emails.length > this.maxRecords) {
      throw new Error(`Maximum ${this.maxRecords} emails per batch. Provided: ${emails.length}`);
    }

    const apiKey = await this.getApiKey(userId);

    // Build API URL with multiple emails
    const params = new URLSearchParams({
      method_name: 'spam_check',
      auth_key: apiKey
    });

    // Add each email as a separate parameter
    emails.forEach(email => {
      params.append('email[]', email);
    });

    const url = `${this.apiUrl}/?${params.toString()}`;

    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'User-Agent': 'IMAP-MCP-Pro/2.6.0'
        }
      });

      if (!response.ok) {
        throw new Error(`CleanTalk API error: ${response.status} ${response.statusText}`);
      }

      const jsonResponse = await response.json() as any;

      // Check for API errors
      if (jsonResponse.error_no) {
        throw new Error(`CleanTalk API error ${jsonResponse.error_no}: ${jsonResponse.error_message}`);
      }

      // Update usage tracking
      await this.updateKeyUsage(userId, apiKey);

      // Process results
      const results: CleanTalkCheckResult[] = [];

      for (const email of emails) {
        const data = jsonResponse.data?.[email];

        if (data) {
          const { isSpam, reason } = this.determineSpam(data, criteria);

          results.push({
            email,
            appears: data.appears || 0,
            spam_rate: data.spam_rate || 0,
            frequency: data.frequency || 0,
            submitted: data.submitted,
            updated: data.updated,
            network_type: data.network_type,
            exists: data.exists,
            disposable_email: data.disposable_email,
            country: data.country,
            sha256: data.sha256,
            isSpam,
            spamReason: reason
          });
        }
      }

      return results;
    } catch (error) {
      throw new Error(`CleanTalk batch check failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Cache spam check results in database
   */
  async cacheResult(email: string, result: CleanTalkCheckResult, cacheHours: number = 24): Promise<void> {
    const expiresAt = new Date(Date.now() + cacheHours * 60 * 60 * 1000);
    const emailHash = await this.hashEmail(email);

    this.db['db'].prepare(`
      INSERT OR REPLACE INTO spam_cache (
        email_hash, spam_score, is_spam, checked_at, expires_at,
        api_source, sender_email, subject
      ) VALUES (?, ?, ?, CURRENT_TIMESTAMP, ?, ?, ?, ?)
    `).run(
      emailHash,
      result.spam_rate,
      result.isSpam ? 1 : 0,
      expiresAt.toISOString(),
      'cleantalk',
      email,
      result.spamReason || ''
    );
  }

  /**
   * Get cached spam check result
   */
  async getCachedResult(email: string): Promise<CleanTalkCheckResult | null> {
    const emailHash = await this.hashEmail(email);

    const stmt = this.db['db'].prepare(`
      SELECT spam_score, is_spam, checked_at, expires_at, sender_email, subject
      FROM spam_cache
      WHERE email_hash = ? AND expires_at > datetime('now')
    `);

    const cached = stmt.get(emailHash) as any;

    if (!cached) return null;

    return {
      email,
      appears: 0,
      spam_rate: cached.spam_score,
      frequency: 0,
      isSpam: cached.is_spam === 1,
      spamReason: cached.subject
    };
  }

  /**
   * Hash email for caching
   */
  private async hashEmail(email: string): Promise<string> {
    const crypto = await import('crypto');
    return crypto.createHash('sha256').update(email.toLowerCase()).digest('hex');
  }
}
