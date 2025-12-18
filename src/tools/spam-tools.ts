import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ImapService } from '../services/imap-service.js';
import { SpamService } from '../services/spam-service.js';
import { z } from 'zod';

export function spamTools(
  server: McpServer,
  imapService: ImapService,
  spamService: SpamService
): void {
  // Check emails for spam
  server.registerTool('imap_check_spam', {
    description: 'Check emails in a folder for spam/disposable email domains. Returns spam analysis and domain statistics.',
    inputSchema: {
      accountId: z.string().describe('Account ID'),
      folder: z.string().default('INBOX').describe('Folder name'),
      limit: z.number().default(100).describe('Maximum number of emails to check'),
      from: z.string().optional().describe('Filter by sender (optional)'),
      since: z.string().optional().describe('Check emails since date (YYYY-MM-DD)'),
    }
  }, async ({ accountId, folder, limit, from, since }) => {
    const criteria: any = {};
    if (from) criteria.from = from;
    if (since) criteria.since = new Date(since);

    const messages = await imapService.searchEmails(accountId, folder, criteria);
    const limitedMessages = messages.slice(0, limit);

    const emailData = limitedMessages.map(m => ({
      uid: m.uid,
      from: m.from,
      subject: m.subject,
    }));

    const result = spamService.checkEmails(emailData);

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          totalChecked: limitedMessages.length,
          spamCount: result.spam.length,
          cleanCount: result.clean.length,
          spamEmails: result.spam.map(s => ({
            uid: (s as any).uid,
            from: s.email,
            subject: (s as any).subject,
            domain: s.domain,
            reason: s.reason,
            confidence: s.confidence,
          })),
          topDomains: result.domainStats.slice(0, 20),
          message: `Found ${result.spam.length} potential spam emails out of ${limitedMessages.length} checked`,
        }, null, 2)
      }]
    };
  });

  // Delete spam emails
  server.registerTool('imap_delete_spam', {
    description: 'Find and delete emails from known spam/disposable email domains.',
    inputSchema: {
      accountId: z.string().describe('Account ID'),
      folder: z.string().default('INBOX').describe('Folder name'),
      limit: z.number().default(500).describe('Maximum number of emails to check'),
      minConfidence: z.enum(['high', 'medium', 'low']).default('high').describe('Minimum confidence level for spam detection'),
      dryRun: z.boolean().default(true).describe('If true, only report what would be deleted without deleting'),
    }
  }, async ({ accountId, folder, limit, minConfidence, dryRun }) => {
    const messages = await imapService.searchEmails(accountId, folder, {});
    const limitedMessages = messages.slice(0, limit);

    const emailData = limitedMessages.map(m => ({
      uid: m.uid,
      from: m.from,
      subject: m.subject,
    }));

    const result = spamService.checkEmails(emailData);

    // Filter by confidence
    const confidenceLevels = ['high', 'medium', 'low'];
    const minIndex = confidenceLevels.indexOf(minConfidence);
    const toDelete = result.spam.filter(s => {
      const idx = confidenceLevels.indexOf(s.confidence);
      return idx <= minIndex;
    });

    if (toDelete.length === 0) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: true,
            found: 0,
            deleted: 0,
            message: 'No spam emails found matching the criteria',
          }, null, 2)
        }]
      };
    }

    if (dryRun) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: true,
            dryRun: true,
            found: toDelete.length,
            wouldDelete: toDelete.length,
            samples: toDelete.slice(0, 20).map(s => ({
              uid: (s as any).uid,
              from: s.email,
              subject: (s as any).subject,
              domain: s.domain,
              reason: s.reason,
              confidence: s.confidence,
            })),
            message: `Would delete ${toDelete.length} spam emails (dry run). Set dryRun=false to actually delete.`,
          }, null, 2)
        }]
      };
    }

    // Actually delete
    const uids = toDelete.map(s => (s as any).uid);
    const deleteResult = await imapService.bulkDelete(accountId, folder, uids);

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: deleteResult.failed === 0,
          found: toDelete.length,
          deleted: deleteResult.deleted,
          failed: deleteResult.failed,
          errors: deleteResult.errors.length > 0 ? deleteResult.errors : undefined,
          message: deleteResult.failed === 0
            ? `Successfully deleted ${deleteResult.deleted} spam emails`
            : `Deleted ${deleteResult.deleted} spam emails, ${deleteResult.failed} failed`,
        }, null, 2)
      }]
    };
  });

  // Get domain statistics
  server.registerTool('imap_domain_stats', {
    description: 'Get statistics about sender domains in a folder. Useful for identifying bulk senders or spam patterns.',
    inputSchema: {
      accountId: z.string().describe('Account ID'),
      folder: z.string().default('INBOX').describe('Folder name'),
      limit: z.number().default(500).describe('Maximum number of emails to analyze'),
      minCount: z.number().default(2).describe('Minimum email count per domain to include'),
    }
  }, async ({ accountId, folder, limit, minCount }) => {
    const messages = await imapService.searchEmails(accountId, folder, {});
    const limitedMessages = messages.slice(0, limit);

    const emailData = limitedMessages.map(m => ({
      uid: m.uid,
      from: m.from,
      subject: m.subject,
    }));

    const result = spamService.checkEmails(emailData);

    const filteredStats = result.domainStats
      .filter(d => d.count >= minCount)
      .map(d => ({
        domain: d.domain,
        count: d.count,
        isKnownSpam: spamService.checkEmail(`test@${d.domain}`).isSpam,
        samples: d.emails.slice(0, 3).map(e => ({
          from: e.from,
          subject: e.subject,
        })),
      }));

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          totalEmails: limitedMessages.length,
          uniqueDomains: result.domainStats.length,
          domainsWithMultiple: filteredStats.length,
          domains: filteredStats,
        }, null, 2)
      }]
    };
  });

  // Add custom spam domain
  server.registerTool('imap_add_spam_domain', {
    description: 'Add a domain to the custom spam list. Emails from this domain will be flagged as spam.',
    inputSchema: {
      domain: z.string().describe('Domain to add to spam list (e.g., "spammer.com")'),
    }
  }, async ({ domain }) => {
    spamService.addSpamDomain(domain);

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: true,
          message: `Domain "${domain}" added to spam list`,
        }, null, 2)
      }]
    };
  });

  // Remove custom spam domain
  server.registerTool('imap_remove_spam_domain', {
    description: 'Remove a domain from the custom spam list.',
    inputSchema: {
      domain: z.string().describe('Domain to remove from spam list'),
    }
  }, async ({ domain }) => {
    spamService.removeSpamDomain(domain);

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: true,
          message: `Domain "${domain}" removed from spam list`,
        }, null, 2)
      }]
    };
  });

  // Add whitelist domain
  server.registerTool('imap_add_whitelist_domain', {
    description: 'Add a domain to the whitelist. Emails from whitelisted domains will never be flagged as spam.',
    inputSchema: {
      domain: z.string().describe('Domain to whitelist (e.g., "trusted.com")'),
    }
  }, async ({ domain }) => {
    spamService.addWhitelistDomain(domain);

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: true,
          message: `Domain "${domain}" added to whitelist`,
        }, null, 2)
      }]
    };
  });

  // List known spam domains
  server.registerTool('imap_list_spam_domains', {
    description: 'List all known spam domains (built-in and custom).',
    inputSchema: {}
  }, async () => {
    const spamDomains = spamService.getKnownSpamDomains();
    const whitelistDomains = spamService.getWhitelistDomains();

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          spamDomainsCount: spamDomains.length,
          spamDomains: spamDomains.slice(0, 100),
          whitelistDomainsCount: whitelistDomains.length,
          whitelistDomains,
          note: spamDomains.length > 100 ? `Showing first 100 of ${spamDomains.length} domains` : undefined,
        }, null, 2)
      }]
    };
  });

  // Delete emails by domain
  server.registerTool('imap_delete_by_domain', {
    description: 'Delete all emails from a specific domain. Useful for cleaning up unwanted newsletters or spam.',
    inputSchema: {
      accountId: z.string().describe('Account ID'),
      folder: z.string().default('INBOX').describe('Folder name'),
      domain: z.string().describe('Domain to delete emails from (e.g., "spammer.com")'),
      dryRun: z.boolean().default(true).describe('If true, only report what would be deleted'),
    }
  }, async ({ accountId, folder, domain, dryRun }) => {
    // Search for emails from the domain
    const messages = await imapService.searchEmails(accountId, folder, {
      from: `@${domain}`,
    });

    if (messages.length === 0) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: true,
            found: 0,
            deleted: 0,
            message: `No emails found from domain "${domain}"`,
          }, null, 2)
        }]
      };
    }

    if (dryRun) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: true,
            dryRun: true,
            domain,
            found: messages.length,
            wouldDelete: messages.length,
            samples: messages.slice(0, 10).map(m => ({
              uid: m.uid,
              from: m.from,
              subject: m.subject,
              date: m.date,
            })),
            message: `Would delete ${messages.length} emails from "${domain}" (dry run). Set dryRun=false to actually delete.`,
          }, null, 2)
        }]
      };
    }

    const uids = messages.map(m => m.uid);
    const result = await imapService.bulkDelete(accountId, folder, uids);

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: result.failed === 0,
          domain,
          found: messages.length,
          deleted: result.deleted,
          failed: result.failed,
          errors: result.errors.length > 0 ? result.errors : undefined,
          message: result.failed === 0
            ? `Successfully deleted ${result.deleted} emails from "${domain}"`
            : `Deleted ${result.deleted} emails from "${domain}", ${result.failed} failed`,
        }, null, 2)
      }]
    };
  });
}
