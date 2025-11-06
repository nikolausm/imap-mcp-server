/**
 * CleanTalk Anti-SPAM MCP Tools
 *
 * MCP tools for SPAM detection using CleanTalk API
 * Supports single and bulk email checking with custom criteria
 *
 * Author: Colin Bitterfield
 * Email: colin.bitterfield@templeofepiphany.com
 * Date: 2025-11-06
 * Version: 1.0.0
 *
 * Related Issues: #3, #17, #18, #32
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { withErrorHandling } from '../utils/error-handler.js';
import { CleanTalkService, SpamCheckCriteria } from '../services/cleantalk-service.js';
import { DatabaseService } from '../services/database-service.js';
import { ImapService } from '../services/imap-service.js';

export function cleanTalkTools(server: McpServer, db: DatabaseService, imapService: ImapService): void {
  const cleanTalk = new CleanTalkService(db);

  // ===== CleanTalk API Key Management Tools =====

  server.registerTool('imap_add_cleantalk_key', {
    description: 'Add a CleanTalk API key for a user (admin or own user only)',
    inputSchema: {
      userId: z.string().describe('User ID to add the key for'),
      apiKey: z.string().describe('CleanTalk API key from https://cleantalk.org/register?platform=api'),
      dailyLimit: z.number().optional().default(1000).describe('Daily API call limit (default: 1000)'),
      notes: z.string().optional().describe('Optional notes about this API key')
    }
  }, withErrorHandling(async ({ userId, apiKey, dailyLimit, notes }) => {
    db['db'].prepare(`
      INSERT INTO cleantalk_keys (user_id, api_key, daily_limit, notes, is_active)
      VALUES (?, ?, ?, ?, 1)
    `).run(userId, apiKey, dailyLimit, notes || null);

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: true,
          message: `CleanTalk API key added for user ${userId}`,
          dailyLimit
        }, null, 2)
      }]
    };
  }));

  server.registerTool('imap_get_cleantalk_key', {
    description: 'Get CleanTalk API key information for a user',
    inputSchema: {
      userId: z.string().describe('User ID')
    }
  }, withErrorHandling(async ({ userId }) => {
    const stmt = db['db'].prepare(`
      SELECT id, api_key, is_active, daily_limit, daily_usage,
             usage_reset_at, last_used, created_at, notes
      FROM cleantalk_keys
      WHERE user_id = ?
      ORDER BY created_at DESC
    `);

    const keys = stmt.all(userId);

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: true,
          userId,
          keys: keys.map((k: any) => ({
            id: k.id,
            apiKey: k.api_key.substring(0, 8) + '...' + k.api_key.substring(k.api_key.length - 4), // Masked
            isActive: k.is_active === 1,
            dailyLimit: k.daily_limit,
            dailyUsage: k.daily_usage,
            usageResetAt: k.usage_reset_at,
            lastUsed: k.last_used,
            createdAt: k.created_at,
            notes: k.notes
          }))
        }, null, 2)
      }]
    };
  }));

  server.registerTool('imap_delete_cleantalk_key', {
    description: 'Delete a CleanTalk API key',
    inputSchema: {
      keyId: z.number().describe('CleanTalk key ID to delete')
    }
  }, withErrorHandling(async ({ keyId }) => {
    db['db'].prepare('DELETE FROM cleantalk_keys WHERE id = ?').run(keyId);

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: true,
          message: `CleanTalk API key ${keyId} deleted`
        }, null, 2)
      }]
    };
  }));

  // ===== SPAM Detection Tools =====

  server.registerTool('imap_check_email_spam', {
    description: 'Check a single email address against CleanTalk for spam',
    inputSchema: {
      userId: z.string().describe('User ID (must have active CleanTalk API key)'),
      email: z.string().email().describe('Email address to check'),
      minSpamRate: z.number().optional().default(0.5).describe('Minimum spam rate to flag as spam (0-1)'),
      maxDaysSinceUpdate: z.number().optional().default(30).describe('Max days since last update for flagging'),
      minFrequency: z.number().optional().default(5).describe('Minimum report frequency for spam flag'),
      checkDisposable: z.boolean().optional().default(true).describe('Flag disposable email addresses'),
      checkExists: z.boolean().optional().default(true).describe('Flag non-existent email addresses'),
      useCache: z.boolean().optional().default(true).describe('Use cached results if available')
    }
  }, withErrorHandling(async ({ userId, email, minSpamRate, maxDaysSinceUpdate, minFrequency, checkDisposable, checkExists, useCache }) => {
    const criteria: SpamCheckCriteria = {
      minSpamRate,
      maxDaysSinceUpdate,
      minFrequency,
      checkDisposable,
      checkExists
    };

    // Check cache first if enabled
    if (useCache) {
      const cached = await cleanTalk.getCachedResult(email);
      if (cached) {
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: true,
              cached: true,
              result: cached
            }, null, 2)
          }]
        };
      }
    }

    // Check with CleanTalk API
    const result = await cleanTalk.checkEmail(userId, email, criteria);

    // Cache the result
    await cleanTalk.cacheResult(email, result);

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: true,
          cached: false,
          result
        }, null, 2)
      }]
    };
  }));

  server.registerTool('imap_check_emails_spam_bulk', {
    description: 'Check multiple email addresses against CleanTalk for spam (max 1000)',
    inputSchema: {
      userId: z.string().describe('User ID (must have active CleanTalk API key)'),
      emails: z.array(z.string().email()).max(1000).describe('Array of email addresses to check'),
      minSpamRate: z.number().optional().default(0.5),
      maxDaysSinceUpdate: z.number().optional().default(30),
      minFrequency: z.number().optional().default(5),
      checkDisposable: z.boolean().optional().default(true),
      checkExists: z.boolean().optional().default(true),
      useCache: z.boolean().optional().default(true)
    }
  }, withErrorHandling(async ({ userId, emails, minSpamRate, maxDaysSinceUpdate, minFrequency, checkDisposable, checkExists, useCache }) => {
    const criteria: SpamCheckCriteria = {
      minSpamRate,
      maxDaysSinceUpdate,
      minFrequency,
      checkDisposable,
      checkExists
    };

    const results = [];
    const emailsToCheck = [];

    // Check cache first if enabled
    if (useCache) {
      for (const email of emails) {
        const cached = await cleanTalk.getCachedResult(email);
        if (cached) {
          results.push({ ...cached, cached: true });
        } else {
          emailsToCheck.push(email);
        }
      }
    } else {
      emailsToCheck.push(...emails);
    }

    // Check remaining emails with CleanTalk API
    if (emailsToCheck.length > 0) {
      const apiResults = await cleanTalk.checkEmailsBatch(userId, emailsToCheck, criteria);

      // Cache all results
      for (const result of apiResults) {
        await cleanTalk.cacheResult(result.email, result);
        results.push({ ...result, cached: false });
      }
    }

    // Separate spam from legitimate
    const spam = results.filter(r => r.isSpam);
    const legitimate = results.filter(r => !r.isSpam);

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: true,
          summary: {
            total: results.length,
            spam: spam.length,
            legitimate: legitimate.length,
            cached: results.filter(r => r.cached).length
          },
          spam,
          legitimate
        }, null, 2)
      }]
    };
  }));

  server.registerTool('imap_check_folder_spam', {
    description: 'Check all emails in a folder against CleanTalk and return spam messages',
    inputSchema: {
      userId: z.string().describe('User ID (must have active CleanTalk API key)'),
      accountId: z.string().describe('IMAP account ID'),
      folder: z.string().default('INBOX').describe('Folder to check'),
      limit: z.number().optional().default(100).describe('Maximum emails to check'),
      minSpamRate: z.number().optional().default(0.5),
      maxDaysSinceUpdate: z.number().optional().default(30),
      minFrequency: z.number().optional().default(5),
      checkDisposable: z.boolean().optional().default(true),
      checkExists: z.boolean().optional().default(true),
      useCache: z.boolean().optional().default(true)
    }
  }, withErrorHandling(async ({ userId, accountId, folder, limit, minSpamRate, maxDaysSinceUpdate, minFrequency, checkDisposable, checkExists, useCache }) => {
    const criteria: SpamCheckCriteria = {
      minSpamRate,
      maxDaysSinceUpdate,
      minFrequency,
      checkDisposable,
      checkExists
    };

    // Search for emails in folder (get all emails, then limit)
    const allEmails = await imapService.searchEmails(accountId, folder, {});
    const emails = allEmails.slice(0, limit);

    // Extract unique sender emails
    const senderEmails = [...new Set(emails.map(e => e.from))];

    // Batch check sender emails
    const spamChecks = await cleanTalk.checkEmailsBatch(userId, senderEmails.slice(0, 1000), criteria);

    // Create map of email -> spam status
    const spamMap = new Map(spamChecks.map(r => [r.email, r]));

    // Filter emails from spam senders
    const spamMessages = emails.filter(e => {
      const check = spamMap.get(e.from);
      return check && check.isSpam;
    });

    // Cache results
    for (const result of spamChecks) {
      if (useCache) {
        await cleanTalk.cacheResult(result.email, result);
      }
    }

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: true,
          folder,
          summary: {
            totalMessages: emails.length,
            uniqueSenders: senderEmails.length,
            spamSenders: spamChecks.filter(r => r.isSpam).length,
            spamMessages: spamMessages.length
          },
          spamMessages: spamMessages.map(e => ({
            uid: e.uid,
            from: e.from,
            subject: e.subject,
            date: e.date,
            spamInfo: spamMap.get(e.from)
          }))
        }, null, 2)
      }]
    };
  }));

  server.registerTool('imap_scan_account_spam', {
    description: 'Scan entire IMAP account for spam using CleanTalk, checking all folders',
    inputSchema: {
      userId: z.string().describe('User ID (must have active CleanTalk API key)'),
      accountId: z.string().describe('IMAP account ID'),
      maxEmailsPerFolder: z.number().optional().default(100).describe('Max emails to check per folder'),
      minSpamRate: z.number().optional().default(0.5),
      checkDisposable: z.boolean().optional().default(true),
      checkExists: z.boolean().optional().default(true)
    }
  }, withErrorHandling(async ({ userId, accountId, maxEmailsPerFolder, minSpamRate, checkDisposable, checkExists }) => {
    const criteria: SpamCheckCriteria = {
      minSpamRate,
      checkDisposable,
      checkExists
    };

    // Get all folders
    const folders = await imapService.listFolders(accountId);

    const folderResults = [];
    let totalSpamMessages = 0;
    const allSpamSenders = new Set<string>();

    for (const folder of folders) {
      try {
        // Search for emails in folder (get all emails, then limit)
        const allEmails = await imapService.searchEmails(accountId, folder.name, {});
        const emails = allEmails.slice(0, maxEmailsPerFolder);

        if (emails.length === 0) continue;

        // Extract unique sender emails
        const senderEmails = [...new Set(emails.map(e => e.from))];

        // Batch check sender emails
        const spamChecks = await cleanTalk.checkEmailsBatch(userId, senderEmails.slice(0, 1000), criteria);

        // Create map of email -> spam status
        const spamMap = new Map(spamChecks.map(r => [r.email, r]));

        // Filter emails from spam senders
        const spamMessages = emails.filter(e => {
          const check = spamMap.get(e.from);
          return check && check.isSpam;
        });

        const spamSenders = spamChecks.filter(r => r.isSpam);
        spamSenders.forEach(s => allSpamSenders.add(s.email));

        totalSpamMessages += spamMessages.length;

        folderResults.push({
          folder: folder.name,
          totalMessages: emails.length,
          spamMessages: spamMessages.length,
          spamSenders: spamSenders.length,
          topSpamSenders: spamSenders.slice(0, 5).map(s => ({
            email: s.email,
            spamRate: s.spam_rate,
            frequency: s.frequency,
            reason: s.spamReason
          }))
        });

        // Cache results
        for (const result of spamChecks) {
          await cleanTalk.cacheResult(result.email, result);
        }
      } catch (error) {
        folderResults.push({
          folder: folder.name,
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    }

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: true,
          accountId,
          summary: {
            foldersScanned: folders.length,
            totalSpamMessages,
            uniqueSpamSenders: allSpamSenders.size
          },
          folderResults
        }, null, 2)
      }]
    };
  }));
}
