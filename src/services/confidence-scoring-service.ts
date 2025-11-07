/**
 * Email Confidence Scoring Service
 *
 * Provides anti-spoofing detection through header analysis
 * Scoring scale: -100 (likely spoofed) to +100 (highly legitimate)
 *
 * @author Colin Bitterfield <colin@bitterfield.com>
 * @version 0.1.0
 * @date_created 2025-11-06
 * @date_updated 2025-11-06
 */

// Configuration Constants
const FREE_EMAIL_PROVIDERS = new Set([
  'gmail.com', 'yahoo.com', 'outlook.com', 'hotmail.com', 'aol.com',
  'icloud.com', 'protonmail.com', 'mail.com', 'zoho.com', 'yandex.com',
  'gmx.com', 'live.com', 'msn.com', 'me.com', 'mac.com'
]);

const SUSPICIOUS_TLDS = new Set([
  '.tk', '.ml', '.ga', '.cf', '.gq', '.xyz', '.top', '.work', '.click',
  '.link', '.pw', '.cc', '.info', '.biz', '.su', '.club'
]);

const FINANCIAL_KEYWORDS = [
  'bank', 'paypal', 'venmo', 'zelle', 'wire', 'transfer', 'account',
  'payment', 'invoice', 'urgent', 'verify', 'confirm', 'suspend',
  'security', 'alert', 'locked', 'unauthorized', 'fraud'
];

const COMPANY_KEYWORDS = [
  'ceo', 'cfo', 'president', 'director', 'executive', 'manager',
  'hr', 'payroll', 'admin', 'administrator'
];

const URGENCY_KEYWORDS = [
  'urgent', 'immediate', 'asap', 'today', 'now', 'quickly', 'rush',
  'emergency', 'critical', 'important', 'deadline', 'expires', 'expiring'
];

// Character substitution patterns for typosquatting detection
const SUBSTITUTION_PATTERNS: { [key: string]: string[] } = {
  'a': ['@', '4', 'α'],
  'e': ['3', 'є', 'ε'],
  'i': ['1', 'l', '!', 'í', 'ì'],
  'l': ['1', 'i', '|', 'ł'],
  'o': ['0', 'ο', 'σ'],
  's': ['5', '$', 'ş'],
  't': ['7', '+', 'τ'],
  'g': ['9', 'q'],
  'b': ['8', 'β'],
  'm': ['rn', 'nn'],
  'n': ['r'],
  'u': ['v', 'ü'],
  'v': ['u', 'ν'],
  'w': ['vv', 'ω']
};

// Common legitimate domains for comparison
const COMMON_LEGITIMATE_DOMAINS = new Set([
  'amazon.com', 'apple.com', 'microsoft.com', 'google.com', 'facebook.com',
  'paypal.com', 'ebay.com', 'netflix.com', 'linkedin.com', 'twitter.com',
  'instagram.com', 'adobe.com', 'dropbox.com', 'salesforce.com', 'oracle.com'
]);

// Types
export interface EmailHeaders {
  from: string;
  replyTo?: string;
  subject: string;
  messageId: string;
  receivedSpf?: string;
  dkimSignature?: string;
  dmarcResult?: string;
  returnPath?: string;
  date?: Date;
  to?: string[];
  cc?: string[];
}

export interface ParsedEmail {
  address: string;
  domain: string;
  name?: string;
}

export interface ScoreRule {
  rule: string;
  points: number;
  reason: string;
}

export interface ScoreBreakdown {
  totalScore: number;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW' | 'VERY_LOW';
  rules: ScoreRule[];
  flags: string[];
  recommendation: string;
}

export class ConfidenceScoringService {
  /**
   * Parse email address into components
   */
  private parseEmailAddress(email: string): ParsedEmail | null {
    if (!email) return null;

    // Handle format: "Name <email@domain.com>" or just "email@domain.com"
    const match = email.match(/<?([^<>@\s]+@[^<>\s]+)>?/);
    if (!match) return null;

    const address = match[1].toLowerCase();
    const parts = address.split('@');
    if (parts.length !== 2) return null;

    const domain = parts[1];
    const nameMatch = email.match(/^([^<]+)\s*</);
    const name = nameMatch ? nameMatch[1].trim() : undefined;

    return { address, domain, name };
  }

  /**
   * Check if domain is a free email provider
   */
  private isFreeEmailProvider(domain: string): boolean {
    return FREE_EMAIL_PROVIDERS.has(domain.toLowerCase());
  }

  /**
   * Check if domain has suspicious TLD
   */
  private hasSuspiciousTLD(domain: string): boolean {
    const lowerDomain = domain.toLowerCase();
    for (const tld of SUSPICIOUS_TLDS) {
      if (lowerDomain.endsWith(tld)) {
        return true;
      }
    }
    return false;
  }

  /**
   * Check if text contains financial keywords
   */
  private hasFinancialKeywords(text: string): boolean {
    const lowerText = text.toLowerCase();
    return FINANCIAL_KEYWORDS.some(keyword => lowerText.includes(keyword));
  }

  /**
   * Check if text contains company keywords
   */
  private hasCompanyKeywords(text: string): boolean {
    const lowerText = text.toLowerCase();
    return COMPANY_KEYWORDS.some(keyword => lowerText.includes(keyword));
  }

  /**
   * Check if text contains urgency keywords
   */
  private hasUrgencyKeywords(text: string): boolean {
    const lowerText = text.toLowerCase();
    return URGENCY_KEYWORDS.some(keyword => lowerText.includes(keyword));
  }

  /**
   * Detect typosquatting attempts
   */
  private detectTyposquatting(domain: string): { isTyposquatting: boolean; matchedDomain?: string } {
    const lowerDomain = domain.toLowerCase().replace(/^www\./, '');

    for (const legitimateDomain of COMMON_LEGITIMATE_DOMAINS) {
      // Check for exact match (not typosquatting)
      if (lowerDomain === legitimateDomain) {
        return { isTyposquatting: false };
      }

      // Check for character substitutions
      for (const [char, substitutes] of Object.entries(SUBSTITUTION_PATTERNS)) {
        for (const substitute of substitutes) {
          const typosquattedDomain = legitimateDomain.replace(new RegExp(char, 'g'), substitute);
          if (lowerDomain === typosquattedDomain) {
            return { isTyposquatting: true, matchedDomain: legitimateDomain };
          }
        }
      }

      // Check for missing/extra characters (edit distance of 1)
      if (this.calculateEditDistance(lowerDomain, legitimateDomain) === 1) {
        return { isTyposquatting: true, matchedDomain: legitimateDomain };
      }

      // Check for subdomain tricks (e.g., paypal.com.evil.com)
      if (lowerDomain.includes(legitimateDomain) && lowerDomain !== legitimateDomain) {
        return { isTyposquatting: true, matchedDomain: legitimateDomain };
      }
    }

    return { isTyposquatting: false };
  }

  /**
   * Calculate Levenshtein distance between two strings
   */
  private calculateEditDistance(str1: string, str2: string): number {
    const matrix: number[][] = [];

    for (let i = 0; i <= str2.length; i++) {
      matrix[i] = [i];
    }

    for (let j = 0; j <= str1.length; j++) {
      matrix[0][j] = j;
    }

    for (let i = 1; i <= str2.length; i++) {
      for (let j = 1; j <= str1.length; j++) {
        if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
          matrix[i][j] = matrix[i - 1][j - 1];
        } else {
          matrix[i][j] = Math.min(
            matrix[i - 1][j - 1] + 1,
            matrix[i][j - 1] + 1,
            matrix[i - 1][j] + 1
          );
        }
      }
    }

    return matrix[str2.length][str1.length];
  }

  /**
   * Parse authentication headers
   */
  private parseAuthenticationResults(headers: EmailHeaders): {
    spfPass: boolean;
    dkimPass: boolean;
    dmarcPass: boolean;
  } {
    const spfPass = headers.receivedSpf?.toLowerCase().includes('pass') || false;
    const dkimPass = headers.dkimSignature?.toLowerCase().includes('pass') || false;
    const dmarcPass = headers.dmarcResult?.toLowerCase().includes('pass') || false;

    return { spfPass, dkimPass, dmarcPass };
  }

  /**
   * Check if Message-ID matches sender domain
   */
  private isMessageIdValid(messageId: string, senderDomain: string): boolean {
    if (!messageId) return false;

    // Extract domain from Message-ID (format: <id@domain>)
    const match = messageId.match(/@([^>]+)>?$/);
    if (!match) return false;

    const messageIdDomain = match[1].toLowerCase();
    return messageIdDomain === senderDomain.toLowerCase();
  }

  /**
   * Main scoring function
   */
  public scoreEmailConfidence(headers: EmailHeaders): ScoreBreakdown {
    const rules: ScoreRule[] = [];
    const flags: string[] = [];
    let totalScore = 0;

    // Parse from and reply-to addresses
    const fromParsed = this.parseEmailAddress(headers.from);
    const replyToParsed = headers.replyTo ? this.parseEmailAddress(headers.replyTo) : null;

    if (!fromParsed) {
      return {
        totalScore: -100,
        confidence: 'VERY_LOW',
        rules: [{ rule: 'INVALID_FROM', points: -100, reason: 'Invalid From address' }],
        flags: ['INVALID_FROM'],
        recommendation: 'DELETE - Invalid sender address'
      };
    }

    // Rule 1: Free email + financial keywords (-40 points)
    if (this.isFreeEmailProvider(fromParsed.domain) && this.hasFinancialKeywords(headers.subject)) {
      totalScore -= 40;
      rules.push({
        rule: 'FREE_EMAIL_FINANCIAL',
        points: -40,
        reason: `Free email provider (${fromParsed.domain}) with financial keywords in subject`
      });
      flags.push('FREE_EMAIL_FINANCIAL');
    }

    // Rule 2: Suspicious TLD (-15 points)
    if (this.hasSuspiciousTLD(fromParsed.domain)) {
      totalScore -= 15;
      rules.push({
        rule: 'SUSPICIOUS_TLD',
        points: -15,
        reason: `Suspicious top-level domain: ${fromParsed.domain}`
      });
      flags.push('SUSPICIOUS_TLD');
    }

    // Rule 3: Reply-To mismatch (-20 points)
    if (replyToParsed && replyToParsed.domain !== fromParsed.domain) {
      totalScore -= 20;
      rules.push({
        rule: 'REPLY_TO_MISMATCH',
        points: -20,
        reason: `Reply-To domain (${replyToParsed.domain}) differs from From domain (${fromParsed.domain})`
      });
      flags.push('REPLY_TO_MISMATCH');
    }

    // Rule 4: Typosquatting detection (-30 points)
    const typosquatResult = this.detectTyposquatting(fromParsed.domain);
    if (typosquatResult.isTyposquatting) {
      totalScore -= 30;
      rules.push({
        rule: 'TYPOSQUATTING',
        points: -30,
        reason: `Domain ${fromParsed.domain} resembles ${typosquatResult.matchedDomain} (possible typosquatting)`
      });
      flags.push('TYPOSQUATTING');
    }

    // Rule 5: Display name spoofing (-25 points)
    if (fromParsed.name && this.hasCompanyKeywords(fromParsed.name) && this.isFreeEmailProvider(fromParsed.domain)) {
      totalScore -= 25;
      rules.push({
        rule: 'DISPLAY_NAME_SPOOFING',
        points: -25,
        reason: `Display name contains company keywords but uses free email provider`
      });
      flags.push('DISPLAY_NAME_SPOOFING');
    }

    // Rule 6: Subject urgency + financial (-20 points)
    if (this.hasUrgencyKeywords(headers.subject) && this.hasFinancialKeywords(headers.subject)) {
      totalScore -= 20;
      rules.push({
        rule: 'URGENT_FINANCIAL',
        points: -20,
        reason: 'Subject contains both urgency and financial keywords'
      });
      flags.push('URGENT_FINANCIAL');
    }

    // Rule 7: Missing Message-ID (-10 points)
    if (!headers.messageId) {
      totalScore -= 10;
      rules.push({
        rule: 'MISSING_MESSAGE_ID',
        points: -10,
        reason: 'Email missing Message-ID header'
      });
      flags.push('MISSING_MESSAGE_ID');
    }

    // Rule 8: Invalid Message-ID domain (-15 points)
    if (headers.messageId && !this.isMessageIdValid(headers.messageId, fromParsed.domain)) {
      totalScore -= 15;
      rules.push({
        rule: 'INVALID_MESSAGE_ID',
        points: -15,
        reason: 'Message-ID domain does not match sender domain'
      });
      flags.push('INVALID_MESSAGE_ID');
    }

    // Rule 9: Return-Path mismatch (-15 points)
    if (headers.returnPath) {
      const returnPathParsed = this.parseEmailAddress(headers.returnPath);
      if (returnPathParsed && returnPathParsed.domain !== fromParsed.domain) {
        totalScore -= 15;
        rules.push({
          rule: 'RETURN_PATH_MISMATCH',
          points: -15,
          reason: `Return-Path domain (${returnPathParsed.domain}) differs from From domain`
        });
        flags.push('RETURN_PATH_MISMATCH');
      }
    }

    // Authentication headers (positive scores)
    const auth = this.parseAuthenticationResults(headers);

    // Rule 10: SPF pass (+15 points)
    if (auth.spfPass) {
      totalScore += 15;
      rules.push({
        rule: 'SPF_PASS',
        points: 15,
        reason: 'SPF authentication passed'
      });
    } else if (headers.receivedSpf) {
      // SPF present but failed (-20 points)
      totalScore -= 20;
      rules.push({
        rule: 'SPF_FAIL',
        points: -20,
        reason: 'SPF authentication failed'
      });
      flags.push('SPF_FAIL');
    }

    // Rule 11: DKIM pass (+20 points)
    if (auth.dkimPass) {
      totalScore += 20;
      rules.push({
        rule: 'DKIM_PASS',
        points: 20,
        reason: 'DKIM signature verified'
      });
    } else if (headers.dkimSignature) {
      // DKIM present but failed (-25 points)
      totalScore -= 25;
      rules.push({
        rule: 'DKIM_FAIL',
        points: -25,
        reason: 'DKIM signature verification failed'
      });
      flags.push('DKIM_FAIL');
    }

    // Rule 12: DMARC pass (+25 points)
    if (auth.dmarcPass) {
      totalScore += 25;
      rules.push({
        rule: 'DMARC_PASS',
        points: 25,
        reason: 'DMARC policy passed'
      });
    } else if (headers.dmarcResult) {
      // DMARC present but failed (-30 points)
      totalScore -= 30;
      rules.push({
        rule: 'DMARC_FAIL',
        points: -30,
        reason: 'DMARC policy failed'
      });
      flags.push('DMARC_FAIL');
    }

    // Rule 13: All three auth methods pass (+10 bonus)
    if (auth.spfPass && auth.dkimPass && auth.dmarcPass) {
      totalScore += 10;
      rules.push({
        rule: 'FULL_AUTH_SUITE',
        points: 10,
        reason: 'All authentication methods (SPF, DKIM, DMARC) passed'
      });
    }

    // Rule 14: Corporate domain (not free email) (+10 points)
    if (!this.isFreeEmailProvider(fromParsed.domain) && !this.hasSuspiciousTLD(fromParsed.domain)) {
      totalScore += 10;
      rules.push({
        rule: 'CORPORATE_DOMAIN',
        points: 10,
        reason: 'Using corporate domain (not free email provider)'
      });
    }

    // Rule 15: Legitimate well-known domain (+20 points)
    if (COMMON_LEGITIMATE_DOMAINS.has(fromParsed.domain)) {
      totalScore += 20;
      rules.push({
        rule: 'KNOWN_LEGITIMATE_DOMAIN',
        points: 20,
        reason: `Well-known legitimate domain: ${fromParsed.domain}`
      });
    }

    // Clamp score to -100 to +100
    totalScore = Math.max(-100, Math.min(100, totalScore));

    // Determine confidence level
    let confidence: 'HIGH' | 'MEDIUM' | 'LOW' | 'VERY_LOW';
    let recommendation: string;

    if (totalScore >= 50) {
      confidence = 'HIGH';
      recommendation = 'Email appears legitimate';
    } else if (totalScore >= 0) {
      confidence = 'MEDIUM';
      recommendation = 'Exercise caution - verify sender if unexpected';
    } else if (totalScore >= -50) {
      confidence = 'LOW';
      recommendation = 'Likely spoofed - verify through alternate channel before acting';
    } else {
      confidence = 'VERY_LOW';
      recommendation = 'DANGER - High probability of spoofing, recommend deletion';
    }

    return {
      totalScore,
      confidence,
      rules,
      flags,
      recommendation
    };
  }

  /**
   * Bulk score multiple emails
   */
  public bulkScoreEmails(emailHeaders: EmailHeaders[]): ScoreBreakdown[] {
    return emailHeaders.map(headers => this.scoreEmailConfidence(headers));
  }
}
