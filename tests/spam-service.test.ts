import { describe, it, expect, beforeEach } from 'vitest';
import { SpamService } from '../src/services/spam-service.js';

describe('SpamService', () => {
  let spamService: SpamService;

  beforeEach(() => {
    spamService = new SpamService();
  });

  describe('extractDomain', () => {
    it('should extract domain from simple email', () => {
      expect(spamService.extractDomain('test@example.com')).toBe('example.com');
    });

    it('should extract domain from email with name', () => {
      expect(spamService.extractDomain('John Doe <john@example.com>')).toBe('example.com');
    });

    it('should extract domain from email with angle brackets only', () => {
      expect(spamService.extractDomain('<user@domain.org>')).toBe('domain.org');
    });

    it('should return null for invalid email', () => {
      expect(spamService.extractDomain('not-an-email')).toBeNull();
    });

    it('should handle email with multiple @ symbols in name', () => {
      expect(spamService.extractDomain('"user@work" <user@personal.com>')).toBe('personal.com');
    });

    it('should lowercase the domain', () => {
      expect(spamService.extractDomain('test@EXAMPLE.COM')).toBe('example.com');
    });
  });

  describe('checkEmail', () => {
    it('should detect known spam domain', () => {
      const result = spamService.checkEmail('test@tempmail.com');
      expect(result.isSpam).toBe(true);
      expect(result.confidence).toBe('high');
      expect(result.domain).toBe('tempmail.com');
    });

    it('should detect guerrillamail as spam', () => {
      const result = spamService.checkEmail('user@guerrillamail.com');
      expect(result.isSpam).toBe(true);
      expect(result.confidence).toBe('high');
    });

    it('should detect mailinator as spam', () => {
      const result = spamService.checkEmail('test@mailinator.com');
      expect(result.isSpam).toBe(true);
    });

    it('should detect 10minutemail as spam', () => {
      const result = spamService.checkEmail('test@10minutemail.com');
      expect(result.isSpam).toBe(true);
    });

    it('should not flag legitimate domain as spam', () => {
      const result = spamService.checkEmail('user@gmail.com');
      expect(result.isSpam).toBe(false);
    });

    it('should not flag corporate domain as spam', () => {
      const result = spamService.checkEmail('employee@microsoft.com');
      expect(result.isSpam).toBe(false);
    });

    it('should handle unknown domain extraction', () => {
      const result = spamService.checkEmail('invalid');
      expect(result.domain).toBe('unknown');
      expect(result.isSpam).toBe(false);
    });
  });

  describe('custom spam domains', () => {
    it('should add custom spam domain', () => {
      spamService.addSpamDomain('custom-spam.com');
      const result = spamService.checkEmail('test@custom-spam.com');
      expect(result.isSpam).toBe(true);
      expect(result.confidence).toBe('high');
    });

    it('should remove custom spam domain', () => {
      spamService.addSpamDomain('removable.com');
      spamService.removeSpamDomain('removable.com');
      const result = spamService.checkEmail('test@removable.com');
      expect(result.isSpam).toBe(false);
    });

    it('should handle case-insensitive domain matching', () => {
      spamService.addSpamDomain('UPPERCASE.COM');
      const result = spamService.checkEmail('test@uppercase.com');
      expect(result.isSpam).toBe(true);
    });
  });

  describe('whitelist domains', () => {
    it('should whitelist domain', () => {
      // First add it to spam list
      spamService.addSpamDomain('trusted.com');
      // Then whitelist it
      spamService.addWhitelistDomain('trusted.com');
      const result = spamService.checkEmail('test@trusted.com');
      expect(result.isSpam).toBe(false);
      expect(result.reason).toBe('Domain is whitelisted');
    });

    it('should return whitelisted domains', () => {
      spamService.addWhitelistDomain('safe1.com');
      spamService.addWhitelistDomain('safe2.com');
      const whitelist = spamService.getWhitelistDomains();
      expect(whitelist).toContain('safe1.com');
      expect(whitelist).toContain('safe2.com');
    });

    it('should remove whitelist domain', () => {
      spamService.addWhitelistDomain('temp-whitelist.com');
      spamService.removeWhitelistDomain('temp-whitelist.com');
      const whitelist = spamService.getWhitelistDomains();
      expect(whitelist).not.toContain('temp-whitelist.com');
    });
  });

  describe('checkEmails (batch)', () => {
    it('should check multiple emails and categorize them', () => {
      const emails = [
        { uid: 1, from: 'spam@tempmail.com', subject: 'Spam 1' },
        { uid: 2, from: 'legit@gmail.com', subject: 'Legit 1' },
        { uid: 3, from: 'spam@mailinator.com', subject: 'Spam 2' },
        { uid: 4, from: 'work@company.com', subject: 'Work' },
      ];

      const result = spamService.checkEmails(emails);

      expect(result.spam.length).toBe(2);
      expect(result.clean.length).toBe(2);
    });

    it('should calculate domain statistics', () => {
      const emails = [
        { uid: 1, from: 'user1@domain.com', subject: 'Email 1' },
        { uid: 2, from: 'user2@domain.com', subject: 'Email 2' },
        { uid: 3, from: 'user3@domain.com', subject: 'Email 3' },
        { uid: 4, from: 'other@different.com', subject: 'Email 4' },
      ];

      const result = spamService.checkEmails(emails);

      expect(result.domainStats.length).toBe(2);
      expect(result.domainStats[0].domain).toBe('domain.com');
      expect(result.domainStats[0].count).toBe(3);
    });

    it('should sort domain stats by count descending', () => {
      const emails = [
        { uid: 1, from: 'a@small.com', subject: '1' },
        { uid: 2, from: 'b@large.com', subject: '2' },
        { uid: 3, from: 'c@large.com', subject: '3' },
        { uid: 4, from: 'd@large.com', subject: '4' },
        { uid: 5, from: 'e@medium.com', subject: '5' },
        { uid: 6, from: 'f@medium.com', subject: '6' },
      ];

      const result = spamService.checkEmails(emails);

      expect(result.domainStats[0].domain).toBe('large.com');
      expect(result.domainStats[0].count).toBe(3);
      expect(result.domainStats[1].domain).toBe('medium.com');
      expect(result.domainStats[1].count).toBe(2);
    });
  });

  describe('checkHeaders', () => {
    const FROM = 'Info <info@example.de>';

    it('returns no flags for clean, authenticated headers', () => {
      const flags = spamService.checkHeaders(
        {
          'authentication-results': 'mx.example.de; dmarc=pass; spf=pass; dkim=pass',
          'x-mailer': 'Apple Mail (2.3696.120.41.1.1)',
        },
        FROM,
      );
      expect(flags).toEqual([]);
    });

    it('flags a known bulk mailer in X-Mailer', () => {
      const flags = spamService.checkHeaders({ 'x-mailer': 'Sendy (https://sendy.co)' }, FROM);
      expect(flags).toHaveLength(1);
      expect(flags[0].header).toBe('X-Mailer');
      expect(flags[0].reason).toContain('sendy');
    });

    it('flags PHPMailer in X-Mailer (case-insensitive)', () => {
      const flags = spamService.checkHeaders({ 'x-mailer': 'PHPMailer 6.8.0' }, FROM);
      expect(flags.some(f => f.header === 'X-Mailer')).toBe(true);
    });

    it('does not flag a legitimate mail client User-Agent', () => {
      const flags = spamService.checkHeaders({ 'user-agent': 'Mozilla Thunderbird' }, FROM);
      expect(flags).toEqual([]);
    });

    it('flags Precedence: bulk', () => {
      const flags = spamService.checkHeaders({ precedence: 'bulk' }, FROM);
      expect(flags).toHaveLength(1);
      expect(flags[0].header).toBe('Precedence');
    });

    it('flags Precedence: list only when mailing-list headers are absent', () => {
      expect(spamService.checkHeaders({ precedence: 'list' }, FROM)).toHaveLength(1);
      expect(
        spamService.checkHeaders(
          { precedence: 'list', 'list-unsubscribe': '<https://example.de/unsub>' },
          FROM,
        ),
      ).toEqual([]);
    });

    it('flags DMARC none as medium and DMARC fail as high', () => {
      const none = spamService.checkHeaders({ 'authentication-results': 'x; dmarc=none' }, FROM);
      expect(none[0]).toMatchObject({ value: 'dmarc=none', severity: 'medium' });

      const fail = spamService.checkHeaders({ 'authentication-results': 'x; dmarc=fail' }, FROM);
      expect(fail[0]).toMatchObject({ value: 'dmarc=fail', severity: 'high' });
    });

    it('flags SPF fail (high) and softfail (medium)', () => {
      const fail = spamService.checkHeaders({ 'authentication-results': 'x; spf=fail' }, FROM);
      expect(fail.some(f => f.value === 'spf=fail' && f.severity === 'high')).toBe(true);

      const soft = spamService.checkHeaders({ 'authentication-results': 'x; spf=softfail' }, FROM);
      expect(soft.some(f => f.value === 'spf=softfail' && f.severity === 'medium')).toBe(true);
    });

    it('flags a List-Unsubscribe host unrelated to the sender domain', () => {
      const flags = spamService.checkHeaders(
        { 'list-unsubscribe': '<https://track.spammer-cdn.com/u/abc>, <mailto:off@spammer-cdn.com>' },
        FROM,
      );
      expect(flags.some(f => f.header === 'List-Unsubscribe')).toBe(true);
    });

    it('does not flag a List-Unsubscribe host on a sender subdomain', () => {
      const flags = spamService.checkHeaders(
        { 'list-unsubscribe': '<https://mail.example.de/unsubscribe?id=1>' },
        FROM,
      );
      expect(flags).toEqual([]);
    });

    it('flags a Reply-To domain that differs from the From domain', () => {
      const flags = spamService.checkHeaders({ 'reply-to': 'noreply@totally-different.ru' }, FROM);
      expect(flags).toHaveLength(1);
      expect(flags[0].header).toBe('Reply-To');
    });

    it('does not flag a Reply-To on the same or a subdomain of the sender', () => {
      expect(spamService.checkHeaders({ 'reply-to': 'support@example.de' }, FROM)).toEqual([]);
      expect(spamService.checkHeaders({ 'reply-to': 'support@help.example.de' }, FROM)).toEqual([]);
    });

    it('surfaces multiple red flags for a scam mail that passes the domain check (issue #115)', () => {
      // Fresh, unlisted sender domain — checkEmail would return isSpam=false.
      expect(spamService.checkEmail('info@fresh-unlisted-domain.de').isSpam).toBe(false);

      const flags = spamService.checkHeaders(
        {
          'x-mailer': 'Sendy',
          precedence: 'Bulk',
          'authentication-results': 'mx.provider.de; dmarc=none; spf=softfail',
          'list-unsubscribe': '<https://unsub.thirdparty-tracker.com/x>',
        },
        'Info <info@fresh-unlisted-domain.de>',
      );

      const headers = flags.map(f => f.header);
      expect(headers).toContain('X-Mailer');
      expect(headers).toContain('Precedence');
      expect(headers).toContain('Authentication-Results');
      expect(headers).toContain('List-Unsubscribe');
      expect(flags.length).toBeGreaterThanOrEqual(4);
    });

    it('ignores mismatch checks when the From address has no extractable domain', () => {
      const flags = spamService.checkHeaders({ 'reply-to': 'x@other.com' }, 'not-an-email');
      expect(flags).toEqual([]);
    });
  });

  describe('getKnownSpamDomains', () => {
    it('should return known spam domains', () => {
      const domains = spamService.getKnownSpamDomains();
      expect(domains.length).toBeGreaterThan(40);
      expect(domains).toContain('tempmail.com');
      expect(domains).toContain('mailinator.com');
      expect(domains).toContain('guerrillamail.com');
    });

    it('should include custom domains in list', () => {
      spamService.addSpamDomain('my-custom-spam.com');
      const domains = spamService.getKnownSpamDomains();
      expect(domains).toContain('my-custom-spam.com');
    });
  });
});
