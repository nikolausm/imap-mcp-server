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

// Substrings that identify bulk-mail / mass-mailer software in X-Mailer or
// User-Agent headers. Matched case-insensitively as plain substrings — no
// external lookups. These tools are legal and sometimes used legitimately, so
// a hit is a low/medium-confidence indicator, never a definitive verdict.
const BULK_MAILER_SIGNATURES: string[] = [
  'sendy',
  'phpmailer',
  'phplist',
  'powermta',
  'acelle',
  'sendblaster',
  'mumara',
  'gammadyne',
  'advanced mass sender',
  'atomic mail sender',
  'turbo-mailer',
  'mass mailer',
  'bulk mailer',
  'x-bulkmailer',
  'easymail',
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

/**
 * A single header-based spam indicator. `header` is the offending header name,
 * `value` the (possibly normalized) offending value, `reason` a short
 * human/LLM-readable explanation, and `severity` how strong the signal is.
 * These are heuristic indicators, not a definitive spam verdict.
 */
export interface HeaderRedFlag {
  header: string;
  value: string;
  reason: string;
  severity: 'high' | 'medium' | 'low';
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

  /**
   * Run deterministic, dependency-free checks over an email's raw headers and
   * return any spam indicators found. Pure string/regex matching — no external
   * lookups, no DNS, no message body needed.
   *
   * @param headers    Header map with **lowercased** header names as keys and
   *                   the raw header value as string (multi-valued headers may
   *                   be joined with newlines).
   * @param fromAddress The message's From value (e.g. "Name <a@b.com>"), used
   *                   for the domain-mismatch checks.
   */
  checkHeaders(headers: Record<string, string>, fromAddress: string): HeaderRedFlag[] {
    const flags: HeaderRedFlag[] = [];
    const get = (name: string): string | undefined => {
      const v = headers[name.toLowerCase()];
      return typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined;
    };

    // 1) X-Mailer / User-Agent — known bulk/mass mailer software.
    const mailerHeader = get('x-mailer') ? 'X-Mailer' : get('user-agent') ? 'User-Agent' : undefined;
    const mailer = get('x-mailer') || get('user-agent');
    if (mailer && mailerHeader) {
      const lower = mailer.toLowerCase();
      const hit = BULK_MAILER_SIGNATURES.find(sig => lower.includes(sig));
      if (hit) {
        flags.push({
          header: mailerHeader,
          value: mailer,
          reason: `Known bulk/mass-mail tool (${hit})`,
          severity: 'medium',
        });
      }
    }

    // 2) Precedence: bulk/junk marker, or list without mailing-list headers.
    const precedence = get('precedence');
    if (precedence) {
      const p = precedence.toLowerCase();
      if (p === 'bulk' || p === 'junk') {
        flags.push({
          header: 'Precedence',
          value: precedence,
          reason: 'Mass-mail marker',
          severity: 'low',
        });
      } else if (p === 'list' && !get('list-id') && !get('list-unsubscribe')) {
        flags.push({
          header: 'Precedence',
          value: precedence,
          reason: 'List precedence without mailing-list headers',
          severity: 'low',
        });
      }
    }

    // 3) Authentication-Results — DMARC/SPF/DKIM failures.
    const auth = get('authentication-results');
    if (auth) {
      const a = auth.toLowerCase();
      const dmarc = a.match(/dmarc=(none|fail|permerror|temperror)/);
      if (dmarc) {
        const fail = dmarc[1] !== 'none';
        flags.push({
          header: 'Authentication-Results',
          value: `dmarc=${dmarc[1]}`,
          reason: fail ? 'DMARC did not pass' : 'No/absent DMARC alignment',
          severity: fail ? 'high' : 'medium',
        });
      }
      const spf = a.match(/spf=(fail|softfail)/);
      if (spf) {
        flags.push({
          header: 'Authentication-Results',
          value: `spf=${spf[1]}`,
          reason: spf[1] === 'fail' ? 'SPF failed' : 'SPF softfail',
          severity: spf[1] === 'fail' ? 'high' : 'medium',
        });
      }
      if (/dkim=fail/.test(a)) {
        flags.push({
          header: 'Authentication-Results',
          value: 'dkim=fail',
          reason: 'DKIM signature failed',
          severity: 'medium',
        });
      }
    }

    const fromDomain = fromAddress ? this.extractDomain(fromAddress) : null;

    // 4) List-Unsubscribe — unsubscribe host unrelated to the sender domain.
    const listUnsub = get('list-unsubscribe');
    if (listUnsub && fromDomain) {
      const hosts = this.extractHeaderHosts(listUnsub);
      if (hosts.length > 0 && !hosts.some(h => this.domainsRelated(h, fromDomain))) {
        flags.push({
          header: 'List-Unsubscribe',
          value: listUnsub.length > 200 ? `${listUnsub.slice(0, 200)}…` : listUnsub,
          reason: `Unsubscribe host (${hosts.join(', ')}) unrelated to sender domain (${fromDomain})`,
          severity: 'low',
        });
      }
    }

    // 5) Reply-To — domain differs from the From domain.
    const replyTo = get('reply-to');
    if (replyTo && fromDomain) {
      const replyDomain = this.extractDomain(replyTo);
      if (replyDomain && !this.domainsRelated(replyDomain, fromDomain)) {
        flags.push({
          header: 'Reply-To',
          value: replyTo,
          reason: `Reply-To domain (${replyDomain}) differs from From domain (${fromDomain})`,
          severity: 'low',
        });
      }
    }

    return flags;
  }

  /**
   * Two hostnames are considered "related" when they are equal or one is a
   * subdomain of the other (e.g. `mail.firma.de` vs `firma.de`). Deterministic
   * suffix comparison — deliberately simpler than a full public-suffix lookup,
   * which keeps it dependency-free while catching the common ESP-vs-sender case.
   */
  private domainsRelated(a: string, b: string): boolean {
    a = a.toLowerCase();
    b = b.toLowerCase();
    return a === b || a.endsWith(`.${b}`) || b.endsWith(`.${a}`);
  }

  /**
   * Extract hostnames from a header value containing http(s) URLs and/or
   * `mailto:` addresses (e.g. a List-Unsubscribe header). Ports and paths are
   * stripped; results are lowercased.
   */
  private extractHeaderHosts(value: string): string[] {
    const hosts: string[] = [];
    const urlRe = /https?:\/\/([^/>\s,]+)/gi;
    let m: RegExpExecArray | null;
    while ((m = urlRe.exec(value)) !== null) {
      hosts.push(m[1].toLowerCase().replace(/:\d+$/, ''));
    }
    const mailRe = /mailto:[^@>\s]+@([^>\s,?]+)/gi;
    while ((m = mailRe.exec(value)) !== null) {
      hosts.push(m[1].toLowerCase());
    }
    return hosts;
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
