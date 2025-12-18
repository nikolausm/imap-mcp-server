// Known spam/disposable email domains
// This list can be extended or loaded from external sources
const KNOWN_SPAM_DOMAINS: Set<string> = new Set([
  // Disposable email services
  'tempmail.com',
  'temp-mail.org',
  'guerrillamail.com',
  'guerrillamail.org',
  'guerrillamail.net',
  'sharklasers.com',
  'mailinator.com',
  'maildrop.cc',
  'dispostable.com',
  'throwaway.email',
  'throwawaymail.com',
  'fakeinbox.com',
  'trashmail.com',
  'trashmail.net',
  'trashmail.org',
  '10minutemail.com',
  '10minutemail.net',
  'minutemail.com',
  'yopmail.com',
  'yopmail.fr',
  'yopmail.net',
  'mailnesia.com',
  'getnada.com',
  'nada.email',
  'tempail.com',
  'emailondeck.com',
  'mohmal.com',
  'tmpmail.org',
  'tmpmail.net',
  'tempr.email',
  'discard.email',
  'discardmail.com',
  'spamgourmet.com',
  'mailcatch.com',
  'mytrashmail.com',
  'jetable.org',
  'spambox.us',
  'spam4.me',
  'grr.la',
  'anonaddy.me',
  'simplelogin.co',
  'duck.com', // Note: DuckDuckGo's email protection - may be legitimate
  'relay.firefox.com',

  // Common spam domains
  'example.com',
  'test.com',
  'spam.com',
  'junk.com',

  // Known phishing domains (examples)
  'secure-login-verify.com',
  'account-verify-secure.com',
  'login-secure-verify.com',
]);

// Suspicious domain patterns
const SUSPICIOUS_PATTERNS: RegExp[] = [
  /^[a-z0-9]{20,}\.(com|net|org)$/i, // Very long random domains
  /\d{5,}/, // Domains with many consecutive numbers
  /(secure|verify|login|account|update|confirm|suspend).*\d+/i, // Phishing-like patterns
  /^(xn--)/i, // Punycode domains (internationalized, often used in phishing)
];

export interface SpamCheckResult {
  email: string;
  domain: string;
  isSpam: boolean;
  reason?: string;
  confidence: 'high' | 'medium' | 'low';
}

export interface DomainStats {
  domain: string;
  count: number;
  emails: Array<{ uid: number; from: string; subject: string }>;
}

export class SpamService {
  private customSpamDomains: Set<string> = new Set();
  private customWhitelistDomains: Set<string> = new Set();

  constructor() {
    // Load any custom domains from environment or config
    this.loadCustomDomains();
  }

  private loadCustomDomains(): void {
    // Load custom spam domains from environment
    const customSpam = process.env.IMAP_SPAM_DOMAINS;
    if (customSpam) {
      customSpam.split(',').forEach(d => this.customSpamDomains.add(d.trim().toLowerCase()));
    }

    // Load whitelist domains from environment
    const whitelist = process.env.IMAP_WHITELIST_DOMAINS;
    if (whitelist) {
      whitelist.split(',').forEach(d => this.customWhitelistDomains.add(d.trim().toLowerCase()));
    }
  }

  extractDomain(email: string): string | null {
    // Handle formats like "Name <email@domain.com>" and "email@domain.com"
    const match = email.match(/<([^>]+)>/) || email.match(/([^\s<>]+@[^\s<>]+)/);
    if (match) {
      const parts = match[1].split('@');
      if (parts.length === 2) {
        return parts[1].toLowerCase();
      }
    }
    return null;
  }

  checkEmail(email: string): SpamCheckResult {
    const domain = this.extractDomain(email);

    if (!domain) {
      return {
        email,
        domain: 'unknown',
        isSpam: false,
        reason: 'Could not extract domain',
        confidence: 'low',
      };
    }

    // Check whitelist first
    if (this.customWhitelistDomains.has(domain)) {
      return {
        email,
        domain,
        isSpam: false,
        reason: 'Domain is whitelisted',
        confidence: 'high',
      };
    }

    // Check known spam domains
    if (KNOWN_SPAM_DOMAINS.has(domain) || this.customSpamDomains.has(domain)) {
      return {
        email,
        domain,
        isSpam: true,
        reason: 'Known spam/disposable email domain',
        confidence: 'high',
      };
    }

    // Check suspicious patterns
    for (const pattern of SUSPICIOUS_PATTERNS) {
      if (pattern.test(domain)) {
        return {
          email,
          domain,
          isSpam: true,
          reason: `Domain matches suspicious pattern: ${pattern.source}`,
          confidence: 'medium',
        };
      }
    }

    return {
      email,
      domain,
      isSpam: false,
      confidence: 'low',
    };
  }

  checkEmails(emails: Array<{ from: string; uid: number; subject: string }>): {
    spam: SpamCheckResult[];
    clean: SpamCheckResult[];
    domainStats: DomainStats[];
  } {
    const results = emails.map(e => ({
      ...this.checkEmail(e.from),
      uid: e.uid,
      subject: e.subject,
    }));

    const spam = results.filter(r => r.isSpam);
    const clean = results.filter(r => !r.isSpam);

    // Calculate domain statistics
    const domainMap = new Map<string, DomainStats>();
    for (const email of emails) {
      const domain = this.extractDomain(email.from) || 'unknown';
      if (!domainMap.has(domain)) {
        domainMap.set(domain, { domain, count: 0, emails: [] });
      }
      const stats = domainMap.get(domain)!;
      stats.count++;
      stats.emails.push({ uid: email.uid, from: email.from, subject: email.subject });
    }

    const domainStats = Array.from(domainMap.values())
      .sort((a, b) => b.count - a.count);

    return { spam, clean, domainStats };
  }

  addSpamDomain(domain: string): void {
    this.customSpamDomains.add(domain.toLowerCase());
  }

  removeSpamDomain(domain: string): void {
    this.customSpamDomains.delete(domain.toLowerCase());
  }

  addWhitelistDomain(domain: string): void {
    this.customWhitelistDomains.add(domain.toLowerCase());
  }

  removeWhitelistDomain(domain: string): void {
    this.customWhitelistDomains.delete(domain.toLowerCase());
  }

  getKnownSpamDomains(): string[] {
    return [...KNOWN_SPAM_DOMAINS, ...this.customSpamDomains];
  }

  getWhitelistDomains(): string[] {
    return [...this.customWhitelistDomains];
  }

  // Check domain against IPQualityScore API (if configured)
  async checkDomainReputation(domain: string): Promise<{
    score?: number;
    suspicious?: boolean;
    disposable?: boolean;
    error?: string;
  }> {
    const apiKey = process.env.IPQUALITYSCORE_API_KEY;
    if (!apiKey) {
      return { error: 'IPQualityScore API key not configured' };
    }

    try {
      const response = await fetch(
        `https://www.ipqualityscore.com/api/json/email/${apiKey}/${encodeURIComponent(`test@${domain}`)}`
      );

      if (!response.ok) {
        return { error: `API request failed: ${response.status}` };
      }

      const data = await response.json() as any;

      return {
        score: data.fraud_score,
        suspicious: data.suspicious,
        disposable: data.disposable,
      };
    } catch (err) {
      return { error: err instanceof Error ? err.message : 'API request failed' };
    }
  }
}
