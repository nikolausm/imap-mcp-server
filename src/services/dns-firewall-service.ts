/**
 * DNS Firewall Service - Quad9 Domain Validation
 *
 * Validates domains against Quad9 DNS firewall for threat detection.
 * Caches results to minimize DNS queries.
 *
 * Author: Colin Bitterfield
 * Email: colin@bitterfield.com
 * Version: 1.0.0
 */

import { DatabaseService } from './database-service.js';
import https from 'https';

export interface DomainValidationResult {
  domain: string;
  isSafe: boolean;
  isBlocked: boolean;
  provider: string;
  timestamp: Date;
  responseTime: number;
  cached: boolean;
}

export interface MessageScanResult {
  uid: number;
  isSafe: boolean;
  domains: string[];
  blockedDomains: string[];
  totalDomains: number;
  scanTime: number;
}

export class DnsFirewallService {
  private db: DatabaseService;
  private readonly CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
  private readonly DEFAULT_QUAD9_ENDPOINT = 'dns.quad9.net';
  private readonly DEFAULT_TIMEOUT_MS = 5000;

  constructor(db: DatabaseService) {
    this.db = db;
  }

  /**
   * Get configured provider (or fall back to hardcoded Quad9)
   */
  private getProvider(): {endpoint: string; timeout: number; providerId: string} {
    try {
      const provider = this.db.getDefaultDnsFirewallProvider();
      if (provider && provider.is_enabled && provider.provider_type === 'dns-over-https') {
        return {
          endpoint: provider.api_endpoint || this.DEFAULT_QUAD9_ENDPOINT,
          timeout: provider.timeout_ms || this.DEFAULT_TIMEOUT_MS,
          providerId: provider.provider_id
        };
      }
    } catch (error) {
      console.error('[DnsFirewall] Failed to get provider from DB, using fallback:', error);
    }

    // Fallback to hardcoded Quad9
    return {
      endpoint: this.DEFAULT_QUAD9_ENDPOINT,
      timeout: this.DEFAULT_TIMEOUT_MS,
      providerId: 'quad9'
    };
  }

  /**
   * Check single domain via DNS-over-HTTPS (configured provider or Quad9)
   */
  async checkDomain(domain: string): Promise<DomainValidationResult> {
    const startTime = Date.now();
    const provider = this.getProvider();

    // Check cache first
    const cached = this.getFromCache(domain);
    if (cached) {
      return {
        ...cached,
        responseTime: Date.now() - startTime,
        cached: true
      };
    }

    // Query DNS firewall provider
    const isSafe = await this.queryProvider(provider.endpoint, domain, provider.timeout);
    const responseTime = Date.now() - startTime;

    const result: DomainValidationResult = {
      domain,
      isSafe,
      isBlocked: !isSafe,
      provider: provider.providerId,
      timestamp: new Date(),
      responseTime,
      cached: false
    };

    // Cache result
    this.saveToCache(result);

    return result;
  }

  /**
   * Check multiple domains in bulk (with deduplication)
   */
  async checkDomains(domains: string[]): Promise<Map<string, DomainValidationResult>> {
    const results = new Map<string, DomainValidationResult>();
    const uniqueDomains = Array.from(new Set(domains));

    // Process domains in parallel (with reasonable concurrency limit)
    const BATCH_SIZE = 10;
    for (let i = 0; i < uniqueDomains.length; i += BATCH_SIZE) {
      const batch = uniqueDomains.slice(i, i + BATCH_SIZE);
      const batchPromises = batch.map(domain => this.checkDomain(domain));
      const batchResults = await Promise.all(batchPromises);

      batchResults.forEach(result => {
        results.set(result.domain, result);
      });
    }

    return results;
  }

  /**
   * Validate all domains in a message
   */
  async validateMessageDomains(uid: number, domains: string[]): Promise<MessageScanResult> {
    const startTime = Date.now();

    if (domains.length === 0) {
      return {
        uid,
        isSafe: true,
        domains: [],
        blockedDomains: [],
        totalDomains: 0,
        scanTime: Date.now() - startTime
      };
    }

    // Check all domains
    const validationResults = await this.checkDomains(domains);

    // Find blocked domains
    const blockedDomains: string[] = [];
    for (const [domain, result] of validationResults) {
      if (result.isBlocked) {
        blockedDomains.push(domain);
      }
    }

    // Message is safe only if ALL domains are safe
    const isSafe = blockedDomains.length === 0;

    return {
      uid,
      isSafe,
      domains,
      blockedDomains,
      totalDomains: domains.length,
      scanTime: Date.now() - startTime
    };
  }

  /**
   * Query DNS-over-HTTPS provider
   * Returns true if domain is safe, false if blocked
   */
  private async queryProvider(endpoint: string, domain: string, timeout: number): Promise<boolean> {
    return new Promise((resolve) => {
      const options = {
        hostname: endpoint,
        path: `/dns-query?name=${encodeURIComponent(domain)}&type=A`,
        method: 'GET',
        headers: {
          'Accept': 'application/dns-json'
        },
        timeout
      };

      const req = https.request(options, (res) => {
        let data = '';

        res.on('data', (chunk) => {
          data += chunk;
        });

        res.on('end', () => {
          try {
            const response = JSON.parse(data);

            // Quad9 blocks malicious domains by returning NXDOMAIN or empty answers
            // If we get a valid response with Answer section, domain is safe
            const isSafe = response.Status === 0 && response.Answer && response.Answer.length > 0;

            resolve(isSafe);
          } catch (error) {
            console.error(`[DnsFirewall] Failed to parse Quad9 response for ${domain}:`, error);
            // On error, assume safe (fail open to avoid false positives)
            resolve(true);
          }
        });
      });

      req.on('error', (error) => {
        console.error(`[DnsFirewall] Quad9 query failed for ${domain}:`, error.message);
        // On error, assume safe (fail open)
        resolve(true);
      });

      req.on('timeout', () => {
        console.error(`[DnsFirewall] Quad9 query timeout for ${domain}`);
        req.destroy();
        // On timeout, assume safe
        resolve(true);
      });

      req.end();
    });
  }

  /**
   * Get domain result from cache
   */
  private getFromCache(domain: string): DomainValidationResult | null {
    try {
      const stmt = this.db['db'].prepare(`
        SELECT * FROM dns_firewall_cache
        WHERE domain = ? AND expires_at > ?
      `);

      const now = Date.now();
      const row = stmt.get(domain, now) as any;

      if (!row) return null;

      return {
        domain: row.domain,
        isSafe: Boolean(row.is_safe),
        isBlocked: Boolean(row.is_blocked),
        provider: row.provider,
        timestamp: new Date(row.checked_at),
        responseTime: 0, // Will be overridden
        cached: true
      };
    } catch (error) {
      console.error('[DnsFirewall] Cache read error:', error);
      return null;
    }
  }

  /**
   * Save domain result to cache
   */
  private saveToCache(result: DomainValidationResult): void {
    try {
      const stmt = this.db['db'].prepare(`
        INSERT OR REPLACE INTO dns_firewall_cache
        (domain, is_safe, is_blocked, provider, checked_at, expires_at, metadata)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);

      const now = Date.now();
      const expiresAt = now + this.CACHE_TTL_MS;

      stmt.run(
        result.domain,
        result.isSafe ? 1 : 0,
        result.isBlocked ? 1 : 0,
        result.provider,
        now,
        expiresAt,
        null
      );
    } catch (error) {
      console.error('[DnsFirewall] Cache write error:', error);
      // Don't throw - caching is optional
    }
  }

  /**
   * Clean up expired cache entries
   */
  cleanupCache(): void {
    try {
      const stmt = this.db['db'].prepare('DELETE FROM dns_firewall_cache WHERE expires_at < ?');
      const result = stmt.run(Date.now());
      console.error(`[DnsFirewall] Cleaned up ${result.changes} expired cache entries`);
    } catch (error) {
      console.error('[DnsFirewall] Cache cleanup error:', error);
    }
  }
}
