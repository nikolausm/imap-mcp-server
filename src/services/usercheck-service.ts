/**
 * UserCheck Email Validation Service
 *
 * Integrates with UserCheck API for email validation and spam detection
 * API Documentation: https://www.usercheck.com/docs/api/introduction
 *
 * Author: Colin Bitterfield
 * Email: colin.bitterfield@templeofepiphany.com
 * Date: 2025-11-06
 * Version: 1.0.0
 */

import { DatabaseService } from './database-service.js';

export interface UserCheckResult {
  email: string;
  normalized_email: string;
  domain: string;
  domain_age_in_days: number | null;
  mx: boolean;
  mx_records: string[];
  disposable: boolean;
  public_domain: boolean;
  relay_domain: boolean;
  alias: boolean;
  role_account: boolean;
  did_you_mean: string | null;
  blocklisted: boolean;
  spam: boolean;
  // Computed fields
  isSpam: boolean;
  spamReason?: string;
  spamScore: number; // 0-1 (0 = not spam, 1 = definitely spam)
}

export interface UserCheckDomainResult {
  domain: string;
  domain_age_in_days: number | null;
  mx: boolean;
  mx_records: string[];
  disposable: boolean;
  public_domain: boolean;
  relay_domain: boolean;
  did_you_mean: string | null;
  blocklisted: boolean;
  spam: boolean;
  // Computed fields
  isSpam: boolean;
  spamReason?: string;
  spamScore: number; // 0-1 (0 = not spam, 1 = definitely spam)
}

export interface SpamCheckCriteria {
  checkDisposable?: boolean; // Default: true
  checkBlocklisted?: boolean; // Default: true
  checkRoleAccount?: boolean; // Default: true
  checkMx?: boolean; // Default: true
  allowPublicDomains?: boolean; // Default: true
}

export class UserCheckService {
  private db: DatabaseService;
  private apiUrl = 'https://api.usercheck.com';

  constructor(db: DatabaseService) {
    this.db = db;
  }

  /**
   * Get UserCheck API key for a user
   */
  private async getApiKey(userId: string): Promise<string> {
    const stmt = this.db['db'].prepare(`
      SELECT api_key FROM usercheck_keys
      WHERE user_id = ? AND is_active = 1
      LIMIT 1
    `);

    const result = stmt.get(userId) as { api_key: string } | undefined;

    if (!result) {
      throw new Error(`No active UserCheck API key found for user ${userId}`);
    }

    return result.api_key;
  }

  /**
   * Update UserCheck key usage
   */
  private async updateKeyUsage(userId: string, apiKey: string): Promise<void> {
    const now = new Date();
    const stmt = this.db['db'].prepare(`
      SELECT daily_usage, usage_reset_at FROM usercheck_keys
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
        UPDATE usercheck_keys
        SET daily_usage = ?, usage_reset_at = ?, last_used = ?
        WHERE user_id = ? AND api_key = ?
      `).run(newUsage, now.toISOString(), now.toISOString(), userId, apiKey);
    } else {
      this.db['db'].prepare(`
        UPDATE usercheck_keys
        SET daily_usage = ?, last_used = ?
        WHERE user_id = ? AND api_key = ?
      `).run(newUsage, now.toISOString(), userId, apiKey);
    }
  }

  /**
   * Calculate spam score and determine if spam based on UserCheck response
   */
  private determineSpam(data: Partial<UserCheckResult>, criteria: SpamCheckCriteria = {}): { isSpam: boolean; reason?: string; score: number } {
    const {
      checkDisposable = true,
      checkBlocklisted = true,
      checkRoleAccount = true,
      checkMx = true,
      allowPublicDomains = true
    } = criteria;

    let score = 0;
    const reasons: string[] = [];

    // Blocklisted (highest priority)
    if (checkBlocklisted && data.blocklisted) {
      score += 1.0;
      reasons.push('Email is blocklisted');
    }

    // Marked as spam by UserCheck
    if (data.spam) {
      score += 1.0;
      reasons.push('Marked as spam');
    }

    // Disposable email
    if (checkDisposable && data.disposable) {
      score += 0.8;
      reasons.push('Disposable email address');
    }

    // No MX records (can't receive email)
    if (checkMx && data.mx === false) {
      score += 0.7;
      reasons.push('No MX records (invalid domain)');
    }

    // Role account
    if (checkRoleAccount && data.role_account) {
      score += 0.3;
      reasons.push('Role/generic account (e.g. admin@, info@)');
    }

    // Public domain (sometimes undesirable)
    if (!allowPublicDomains && data.public_domain) {
      score += 0.2;
      reasons.push('Public domain (Gmail, Yahoo, etc.)');
    }

    // Relay domain
    if (data.relay_domain) {
      score += 0.4;
      reasons.push('Relay domain');
    }

    // Young domain (potential spam indicator)
    if (data.domain_age_in_days !== null && data.domain_age_in_days !== undefined && data.domain_age_in_days < 30) {
      score += 0.3;
      reasons.push(`Domain is very new (${data.domain_age_in_days} days old)`);
    }

    // Normalize score to 0-1
    const normalizedScore = Math.min(score, 1.0);

    // Determine if spam (threshold: 0.5)
    const isSpam = normalizedScore >= 0.5;

    return {
      isSpam,
      reason: reasons.length > 0 ? reasons.join('; ') : undefined,
      score: normalizedScore
    };
  }

  /**
   * Check a single email address against UserCheck
   */
  async checkEmail(userId: string, email: string, criteria: SpamCheckCriteria = {}): Promise<UserCheckResult> {
    const apiKey = await this.getApiKey(userId);

    // Build API URL
    const url = `${this.apiUrl}/email/${encodeURIComponent(email)}`;

    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'User-Agent': 'IMAP-MCP-Pro/2.8.1'
        }
      });

      if (!response.ok) {
        if (response.status === 400) {
          const errorData = await response.json() as any;
          throw new Error(`Invalid email: ${errorData.error || 'Bad request'}`);
        }
        throw new Error(`UserCheck API error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json() as any;

      // Update usage tracking
      await this.updateKeyUsage(userId, apiKey);

      // Determine if spam
      const { isSpam, reason, score } = this.determineSpam(data, criteria);

      return {
        email: data.email || email,
        normalized_email: data.normalized_email || email,
        domain: data.domain || '',
        domain_age_in_days: data.domain_age_in_days,
        mx: data.mx || false,
        mx_records: data.mx_records || [],
        disposable: data.disposable || false,
        public_domain: data.public_domain || false,
        relay_domain: data.relay_domain || false,
        alias: data.alias || false,
        role_account: data.role_account || false,
        did_you_mean: data.did_you_mean,
        blocklisted: data.blocklisted || false,
        spam: data.spam || false,
        isSpam,
        spamReason: reason,
        spamScore: score
      };
    } catch (error) {
      throw new Error(`UserCheck validation failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Check multiple email addresses (sequential to avoid rate limits)
   * Note: UserCheck doesn't have a batch endpoint, so we check one at a time
   */
  async checkEmailsBatch(userId: string, emails: string[], criteria: SpamCheckCriteria = {}): Promise<UserCheckResult[]> {
    if (emails.length === 0) {
      return [];
    }

    const results: UserCheckResult[] = [];

    for (const email of emails) {
      try {
        const result = await this.checkEmail(userId, email, criteria);
        results.push(result);

        // Small delay to avoid rate limits (adjust as needed)
        await new Promise(resolve => setTimeout(resolve, 100));
      } catch (error) {
        // Continue with other emails even if one fails
        console.error(`Failed to check ${email}:`, error);
      }
    }

    return results;
  }

  /**
   * Check a domain against UserCheck
   */
  async checkDomain(userId: string, domain: string, criteria: SpamCheckCriteria = {}): Promise<UserCheckDomainResult> {
    const apiKey = await this.getApiKey(userId);

    // Build API URL
    const url = `${this.apiUrl}/domain/${encodeURIComponent(domain)}`;

    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'User-Agent': 'IMAP-MCP-Pro/2.8.1'
        }
      });

      if (!response.ok) {
        if (response.status === 400) {
          const errorData = await response.json() as any;
          throw new Error(`Invalid domain: ${errorData.error || 'Bad request'}`);
        }
        throw new Error(`UserCheck API error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json() as any;

      // Update usage tracking
      await this.updateKeyUsage(userId, apiKey);

      // Determine if spam using domain-specific logic
      const { isSpam, reason, score } = this.determineDomainSpam(data, criteria);

      return {
        domain: data.domain || domain,
        domain_age_in_days: data.domain_age_in_days,
        mx: data.mx || false,
        mx_records: data.mx_records || [],
        disposable: data.disposable || false,
        public_domain: data.public_domain || false,
        relay_domain: data.relay_domain || false,
        did_you_mean: data.did_you_mean,
        blocklisted: data.blocklisted || false,
        spam: data.spam || false,
        isSpam,
        spamReason: reason,
        spamScore: score
      };
    } catch (error) {
      throw new Error(`UserCheck domain validation failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Calculate spam score for domain validation
   */
  private determineDomainSpam(data: Partial<UserCheckDomainResult>, criteria: SpamCheckCriteria = {}): { isSpam: boolean; reason?: string; score: number } {
    const {
      checkDisposable = true,
      checkBlocklisted = true,
      checkMx = true,
      allowPublicDomains = true
    } = criteria;

    let score = 0;
    const reasons: string[] = [];

    // Blocklisted (highest priority)
    if (checkBlocklisted && data.blocklisted) {
      score += 1.0;
      reasons.push('Domain is blocklisted');
    }

    // Marked as spam by UserCheck
    if (data.spam) {
      score += 1.0;
      reasons.push('Domain marked as spam');
    }

    // Disposable domain
    if (checkDisposable && data.disposable) {
      score += 0.9;
      reasons.push('Disposable/temporary domain');
    }

    // No MX records (can't receive email)
    if (checkMx && data.mx === false) {
      score += 0.8;
      reasons.push('No MX records (cannot receive email)');
    }

    // Public domain (sometimes undesirable)
    if (!allowPublicDomains && data.public_domain) {
      score += 0.2;
      reasons.push('Public domain (Gmail, Yahoo, etc.)');
    }

    // Relay domain
    if (data.relay_domain) {
      score += 0.5;
      reasons.push('Relay domain');
    }

    // Young domain (potential spam indicator)
    if (data.domain_age_in_days !== null && data.domain_age_in_days !== undefined && data.domain_age_in_days < 30) {
      score += 0.4;
      reasons.push(`Domain is very new (${data.domain_age_in_days} days old)`);
    }

    // Normalize score to 0-1
    const normalizedScore = Math.min(score, 1.0);

    // Determine if spam (threshold: 0.5)
    const isSpam = normalizedScore >= 0.5;

    return {
      isSpam,
      reason: reasons.length > 0 ? reasons.join('; ') : undefined,
      score: normalizedScore
    };
  }

  /**
   * Cache spam check results in database
   */
  async cacheResult(email: string, result: UserCheckResult, cacheHours: number = 24): Promise<void> {
    const expiresAt = new Date(Date.now() + cacheHours * 60 * 60 * 1000);
    const emailHash = await this.hashEmail(email);

    this.db['db'].prepare(`
      INSERT OR REPLACE INTO spam_cache (
        email_hash, spam_score, is_spam, checked_at, expires_at,
        api_source, sender_email, subject
      ) VALUES (?, ?, ?, CURRENT_TIMESTAMP, ?, ?, ?, ?)
    `).run(
      emailHash,
      result.spamScore,
      result.isSpam ? 1 : 0,
      expiresAt.toISOString(),
      'usercheck',
      email,
      result.spamReason || ''
    );
  }

  /**
   * Get cached spam check result
   */
  async getCachedResult(email: string): Promise<UserCheckResult | null> {
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
      normalized_email: cached.sender_email,
      domain: email.split('@')[1] || '',
      domain_age_in_days: null,
      mx: true,
      mx_records: [],
      disposable: false,
      public_domain: false,
      relay_domain: false,
      alias: false,
      role_account: false,
      did_you_mean: null,
      blocklisted: false,
      spam: cached.is_spam === 1,
      isSpam: cached.is_spam === 1,
      spamReason: cached.subject,
      spamScore: cached.spam_score
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
