/**
 * Subscription Management MCP Tools
 *
 * Provides unsubscribe link extraction and subscription management tools
 * Implements Issue #45 Phase 4
 *
 * @author Colin Bitterfield <colin@bitterfield.com>
 * @version 0.1.0
 * @date_created 2025-11-07
 * @date_updated 2025-11-07
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { ImapService } from '../services/imap-service.js';
import { DatabaseService } from '../services/database-service.js';
import { SmtpService } from '../services/smtp-service.js';
import { UnsubscribeService } from '../services/unsubscribe-service.js';
import { UnsubscribeExecutorService } from '../services/unsubscribe-executor-service.js';
import { withErrorHandling } from '../utils/error-handler.js';

export function registerSubscriptionTools(
  server: McpServer,
  imapService: ImapService,
  db: DatabaseService,
  smtpService: SmtpService
): void {
  const unsubscribeService = new UnsubscribeService(db);
  const executorService = new UnsubscribeExecutorService(smtpService);

  /**
   * Extract unsubscribe links from emails in a folder
   */
  server.registerTool('imap_extract_unsubscribe_links', {
    description: 'Scan folder for unsubscribe links in emails. Extracts List-Unsubscribe headers and body links. Stores to database for subscription management. Processes 100+ emails efficiently.',
    inputSchema: {
      userId: z.string().describe('User ID'),
      accountId: z.string().describe('Account ID'),
      folder: z.string().default('INBOX').describe('Folder name'),
      limit: z.number().optional().default(100).describe('Max emails to process (default: 100)'),
      olderThan: z.number().optional().describe('Optional: Only process emails older than N days')
    }
  }, withErrorHandling(async ({ userId, accountId, folder, limit, olderThan }: {
    userId: string; accountId: string; folder: string; limit?: number; olderThan?: number
  }) => {
    const startTime = Date.now();

    // Build search criteria
    const searchCriteria: any = {};
    if (olderThan) {
      const date = new Date();
      date.setDate(date.getDate() - olderThan);
      searchCriteria.before = date;
    }

    // Search for emails
    const emails = await imapService.searchEmails(accountId, folder, searchCriteria);

    // Limit results if specified
    const limitedEmails = limit ? emails.slice(0, limit) : emails;

    const results = {
      processed: 0,
      linksFound: 0,
      linksStored: 0,
      errors: 0,
      emails: [] as any[]
    };

    // Process each email
    for (const email of limitedEmails) {
      try {
        results.processed++;

        // Get full email content (includes body for parsing)
        const emailContent = await imapService.getEmailContent(accountId, folder, email.uid, false);

        // Build email source from parts for parsing
        const emailSource = [
          emailContent.textContent || '',
          emailContent.htmlContent || ''
        ].join('\n\n');

        // Extract unsubscribe info from the email body/headers
        const unsubscribeInfo = await unsubscribeService.extractFromEmail(emailSource);

        if (unsubscribeInfo.unsubscribe_link || unsubscribeInfo.list_unsubscribe_header) {
          results.linksFound++;

          // Store to database
          unsubscribeService.storeUnsubscribeLink({
            user_id: userId,
            account_id: accountId,
            folder,
            uid: email.uid,
            sender_email: email.from,
            sender_name: email.from.split('<')[0].trim(),
            subject: email.subject,
            message_date: email.date ? new Date(email.date) : undefined,
            unsubscribe_info: unsubscribeInfo
          });

          results.linksStored++;

          results.emails.push({
            uid: email.uid,
            from: email.from,
            subject: email.subject,
            date: email.date,
            unsubscribe_link: unsubscribeInfo.unsubscribe_link,
            unsubscribe_method: unsubscribeInfo.unsubscribe_method,
            has_list_unsubscribe_header: !!unsubscribeInfo.list_unsubscribe_header
          });
        }
      } catch (error) {
        results.errors++;
        console.error(`[SubscriptionTools] Error processing email ${email.uid}:`, error);
      }
    }

    const elapsed = Date.now() - startTime;

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          summary: {
            processed: results.processed,
            linksFound: results.linksFound,
            linksStored: results.linksStored,
            errors: results.errors,
            elapsed_ms: elapsed
          },
          emails: results.emails
        }, null, 2)
      }]
    };
  }));

  /**
   * Get subscription summary for a user
   */
  server.registerTool('imap_get_subscription_summary', {
    description: 'Get aggregated subscription summary. Shows all senders with unsubscribe links, email counts, categories, and unsubscribe status. Filter by category or unsubscribed status.',
    inputSchema: {
      userId: z.string().describe('User ID'),
      category: z.enum(['marketing', 'newsletter', 'promotional', 'transactional', 'other']).optional().describe('Filter by category'),
      unsubscribed: z.boolean().optional().describe('Filter by unsubscribe status'),
      sortBy: z.enum(['last_seen', 'total_emails', 'sender_email']).optional().default('last_seen').describe('Sort by field')
    }
  }, withErrorHandling(async ({ userId, category, unsubscribed, sortBy }: {
    userId: string; category?: string; unsubscribed?: boolean; sortBy?: string
  }) => {
    let subscriptions = unsubscribeService.getSubscriptionSummary(userId, { category, unsubscribed });

    // Sort results
    if (sortBy === 'total_emails') {
      subscriptions.sort((a, b) => b.total_emails - a.total_emails);
    } else if (sortBy === 'sender_email') {
      subscriptions.sort((a, b) => a.sender_email.localeCompare(b.sender_email));
    }
    // last_seen is default from query

    const summary = {
      total: subscriptions.length,
      by_category: {} as Record<string, number>,
      unsubscribed_count: subscriptions.filter(s => s.unsubscribed).length,
      active_count: subscriptions.filter(s => !s.unsubscribed).length
    };

    // Count by category
    for (const sub of subscriptions) {
      summary.by_category[sub.category] = (summary.by_category[sub.category] || 0) + 1;
    }

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          summary,
          subscriptions: subscriptions.map(s => ({
            sender_email: s.sender_email,
            sender_name: s.sender_name,
            sender_domain: s.sender_domain,
            total_emails: s.total_emails,
            first_seen: s.first_seen,
            last_seen: s.last_seen,
            category: s.category,
            unsubscribed: s.unsubscribed,
            unsubscribed_at: s.unsubscribed_at,
            unsubscribe_link: s.unsubscribe_link,
            unsubscribe_method: s.unsubscribe_method,
            notes: s.notes
          }))
        }, null, 2)
      }]
    };
  }));

  /**
   * Mark subscription as unsubscribed
   */
  server.registerTool('imap_mark_subscription_unsubscribed', {
    description: 'Mark a sender as unsubscribed in the database. Records timestamp. Useful for tracking which lists you have already unsubscribed from.',
    inputSchema: {
      userId: z.string().describe('User ID'),
      senderEmail: z.string().describe('Sender email address to mark as unsubscribed')
    }
  }, withErrorHandling(async ({ userId, senderEmail }: { userId: string; senderEmail: string }) => {
    unsubscribeService.markAsUnsubscribed(userId, senderEmail);

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          status: 'success',
          message: `Marked ${senderEmail} as unsubscribed`,
          sender_email: senderEmail,
          user_id: userId
        }, null, 2)
      }]
    };
  }));

  /**
   * Update subscription category
   */
  server.registerTool('imap_update_subscription_category', {
    description: 'Update the category of a subscription (marketing, newsletter, promotional, transactional, other). Helps organize subscriptions.',
    inputSchema: {
      userId: z.string().describe('User ID'),
      senderEmail: z.string().describe('Sender email address'),
      category: z.enum(['marketing', 'newsletter', 'promotional', 'transactional', 'other']).describe('New category')
    }
  }, withErrorHandling(async ({ userId, senderEmail, category }: {
    userId: string; senderEmail: string; category: 'marketing' | 'newsletter' | 'promotional' | 'transactional' | 'other'
  }) => {
    db.updateSubscriptionCategory(userId, senderEmail, category);

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          status: 'success',
          message: `Updated ${senderEmail} category to ${category}`,
          sender_email: senderEmail,
          category,
          user_id: userId
        }, null, 2)
      }]
    };
  }));

  /**
   * Update subscription notes
   */
  server.registerTool('imap_update_subscription_notes', {
    description: 'Add or update notes for a subscription. Useful for tracking why you subscribed, unsubscribe difficulty, etc.',
    inputSchema: {
      userId: z.string().describe('User ID'),
      senderEmail: z.string().describe('Sender email address'),
      notes: z.string().describe('Notes text')
    }
  }, withErrorHandling(async ({ userId, senderEmail, notes }: {
    userId: string; senderEmail: string; notes: string
  }) => {
    db.updateSubscriptionNotes(userId, senderEmail, notes);

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          status: 'success',
          message: `Updated notes for ${senderEmail}`,
          sender_email: senderEmail,
          user_id: userId
        }, null, 2)
      }]
    };
  }));

  /**
   * Get all unsubscribe links for a specific sender
   */
  server.registerTool('imap_get_unsubscribe_links', {
    description: 'Get all extracted unsubscribe links from emails. Filter by account or sender. Shows individual email details with unsubscribe links.',
    inputSchema: {
      userId: z.string().describe('User ID'),
      accountId: z.string().optional().describe('Filter by account ID'),
      senderEmail: z.string().optional().describe('Filter by sender email')
    }
  }, withErrorHandling(async ({ userId, accountId, senderEmail }: {
    userId: string; accountId?: string; senderEmail?: string
  }) => {
    const links = unsubscribeService.getUnsubscribeLinks(userId, { account_id: accountId, sender_email: senderEmail });

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          total: links.length,
          links: links.map(link => ({
            id: link.id,
            account_id: link.account_id,
            folder: link.folder,
            uid: link.uid,
            sender_email: link.sender_email,
            subject: link.subject,
            message_date: link.message_date,
            unsubscribe_link: link.unsubscribe_link,
            list_unsubscribe_header: link.list_unsubscribe_header,
            extracted_at: link.extracted_at
          }))
        }, null, 2)
      }]
    };
  }));

  /**
   * List unsubscribe candidates with detailed information
   * Issue #47
   */
  server.registerTool('imap_list_unsubscribe_candidates', {
    description: 'List all subscriptions with unsubscribe links. Shows sender, subject, link, method, and email count. Filter by category or unsubscribed status. Perfect for reviewing before executing unsubscribes.',
    inputSchema: {
      userId: z.string().describe('User ID'),
      category: z.enum(['marketing', 'newsletter', 'promotional', 'transactional', 'other']).optional().describe('Filter by category'),
      unsubscribed: z.boolean().optional().describe('Filter by unsubscribe status (default: show all)'),
      sortBy: z.enum(['last_seen', 'total_emails', 'sender_email']).optional().default('total_emails').describe('Sort by field')
    }
  }, withErrorHandling(async ({ userId, category, unsubscribed, sortBy }: {
    userId: string; category?: string; unsubscribed?: boolean; sortBy?: string
  }) => {
    let subscriptions = unsubscribeService.getSubscriptionSummary(userId, { category, unsubscribed });

    // Only show subscriptions with unsubscribe links
    subscriptions = subscriptions.filter(s => s.unsubscribe_link);

    // Sort results
    if (sortBy === 'total_emails') {
      subscriptions.sort((a, b) => b.total_emails - a.total_emails);
    } else if (sortBy === 'sender_email') {
      subscriptions.sort((a, b) => a.sender_email.localeCompare(b.sender_email));
    } else if (sortBy === 'last_seen') {
      subscriptions.sort((a, b) => new Date(b.last_seen).getTime() - new Date(a.last_seen).getTime());
    }

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          total: subscriptions.length,
          candidates: subscriptions.map(s => ({
            sender_email: s.sender_email,
            sender_name: s.sender_name,
            sender_domain: s.sender_domain,
            subject_from_latest: `(${s.total_emails} emails)`,
            unsubscribe_link: s.unsubscribe_link,
            unsubscribe_method: s.unsubscribe_method,
            total_emails: s.total_emails,
            category: s.category,
            first_seen: s.first_seen,
            last_seen: s.last_seen,
            unsubscribed: s.unsubscribed,
            unsubscribed_at: s.unsubscribed_at,
            notes: s.notes
          }))
        }, null, 2)
      }]
    };
  }));

  /**
   * Execute unsubscribe requests
   * Issue #47
   */
  server.registerTool('imap_execute_unsubscribe', {
    description: 'Execute unsubscribe request for one or more senders. Supports HTTP GET/POST and mailto methods. Optional dry-run mode for testing. Updates database with execution results.',
    inputSchema: {
      userId: z.string().describe('User ID'),
      senderEmails: z.array(z.string()).describe('Array of sender email addresses to unsubscribe from'),
      accountId: z.string().optional().describe('Account ID (required for mailto unsubscribe)'),
      dryRun: z.boolean().optional().default(false).describe('Dry run mode - validate but do not execute'),
      method: z.enum(['auto', 'http-get', 'http-post', 'mailto']).optional().default('auto').describe('Unsubscribe method (auto detects from link)')
    }
  }, withErrorHandling(async ({ userId, senderEmails, accountId, dryRun, method }: {
    userId: string;
    senderEmails: string[];
    accountId?: string;
    dryRun?: boolean;
    method?: 'auto' | 'http-get' | 'http-post' | 'mailto'
  }) => {
    const results: any[] = [];

    for (const senderEmail of senderEmails) {
      try {
        // Get subscription info
        const subscriptions = unsubscribeService.getSubscriptionSummary(userId, {});
        const subscription = subscriptions.find(s => s.sender_email === senderEmail);

        if (!subscription) {
          results.push({
            sender_email: senderEmail,
            status: 'error',
            error: 'No subscription found for this sender'
          });
          continue;
        }

        if (!subscription.unsubscribe_link) {
          results.push({
            sender_email: senderEmail,
            status: 'error',
            error: 'No unsubscribe link found for this sender'
          });
          continue;
        }

        if (subscription.unsubscribed) {
          results.push({
            sender_email: senderEmail,
            status: 'skipped',
            message: 'Already marked as unsubscribed',
            unsubscribed_at: subscription.unsubscribed_at
          });
          continue;
        }

        // Dry run mode
        if (dryRun) {
          results.push({
            sender_email: senderEmail,
            status: 'dry-run',
            unsubscribe_link: subscription.unsubscribe_link,
            unsubscribe_method: subscription.unsubscribe_method,
            message: 'Would execute unsubscribe (dry run)'
          });
          continue;
        }

        // Execute unsubscribe based on method
        let result;
        const link = subscription.unsubscribe_link;

        // Auto-detect method if not specified
        let executeMethod = method || 'auto';
        if (executeMethod === 'auto') {
          if (link.startsWith('mailto:')) {
            executeMethod = 'mailto';
          } else if (subscription.unsubscribe_method === 'http') {
            executeMethod = 'http-get';
          } else {
            executeMethod = 'http-get'; // Default fallback
          }
        }

        // Execute based on method
        if (executeMethod === 'mailto') {
          if (!accountId) {
            results.push({
              sender_email: senderEmail,
              status: 'error',
              error: 'accountId required for mailto unsubscribe'
            });
            continue;
          }

          const dbAccount = db.getDecryptedAccount(accountId);
          if (!dbAccount) {
            results.push({
              sender_email: senderEmail,
              status: 'error',
              error: 'Account not found'
            });
            continue;
          }

          // Convert to ImapAccount format
          const account = {
            id: dbAccount.account_id,
            name: dbAccount.name,
            host: dbAccount.host,
            port: dbAccount.port,
            user: dbAccount.username,
            password: dbAccount.password,
            tls: dbAccount.tls,
            smtp: dbAccount.smtp_host ? {
              host: dbAccount.smtp_host,
              port: dbAccount.smtp_port!,
              secure: dbAccount.smtp_secure || false,
              user: dbAccount.smtp_username,
              password: dbAccount.smtp_password
            } : undefined
          };

          result = await executorService.executeMailtoUnsubscribe(link, account as any);
        } else if (executeMethod === 'http-post') {
          result = await executorService.executeHttpPostUnsubscribe(link);
        } else {
          // http-get
          result = await executorService.executeHttpUnsubscribe(link);
        }

        // Update database with result
        if (result.success) {
          db.updateSubscriptionUnsubscribeResult(
            userId,
            senderEmail,
            'success',
            result.details || 'Unsubscribe executed successfully',
            true
          );
        } else {
          db.updateSubscriptionUnsubscribeResult(
            userId,
            senderEmail,
            'failed',
            result.error || 'Unsubscribe failed',
            false
          );
        }

        results.push({
          sender_email: senderEmail,
          status: result.success ? 'success' : 'failed',
          method: result.method,
          statusCode: result.statusCode,
          details: result.details,
          error: result.error
        });
      } catch (error: any) {
        results.push({
          sender_email: senderEmail,
          status: 'error',
          error: error.message || 'Unknown error'
        });

        // Record error in database
        db.updateSubscriptionUnsubscribeResult(
          userId,
          senderEmail,
          'error',
          error.message || 'Unknown error',
          false
        );
      }
    }

    const summary = {
      total: results.length,
      succeeded: results.filter(r => r.status === 'success').length,
      failed: results.filter(r => r.status === 'failed').length,
      errors: results.filter(r => r.status === 'error').length,
      skipped: results.filter(r => r.status === 'skipped').length,
      dry_run: dryRun || false
    };

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          summary,
          results
        }, null, 2)
      }]
    };
  }));
}
