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
