import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ImapService } from '../services/imap-service.js';
import { DatabaseService } from '../services/database-service.js';
import { DnsFirewallService } from '../services/dns-firewall-service.js';
import { DomainExtractionService } from '../services/domain-extraction-service.js';
import { z } from 'zod';
import { withErrorHandling } from '../utils/error-handler.js';

export function dnsFirewallTools(
  server: McpServer,
  imapService: ImapService,
  db: DatabaseService
): void {
  const dnsFirewall = new DnsFirewallService(db);
  const domainExtractor = new DomainExtractionService();

  // Check single domain
  server.registerTool('imap_check_domain_dns_firewall', {
    description: 'Check if a domain is blocked by DNS firewall (Quad9 threat intelligence)',
    inputSchema: {
      domain: z.string().describe('Domain to check (e.g., example.com)'),
    }
  }, withErrorHandling(async ({ domain }) => {
    const result = await dnsFirewall.checkDomain(domain);

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          domain: result.domain,
          isSafe: result.isSafe,
          isBlocked: result.isBlocked,
          provider: result.provider,
          responseTime: `${result.responseTime}ms`,
          cached: result.cached,
          timestamp: result.timestamp.toISOString(),
        }, null, 2)
      }]
    };
  }));

  // Check multiple domains
  server.registerTool('imap_bulk_check_domains', {
    description: 'Check multiple domains against DNS firewall in bulk',
    inputSchema: {
      domains: z.array(z.string()).describe('Array of domains to check'),
    }
  }, withErrorHandling(async ({ domains }) => {
    const results = await dnsFirewall.checkDomains(domains);

    const summary = {
      totalDomains: domains.length,
      uniqueDomains: results.size,
      safeDomains: 0,
      blockedDomains: 0,
      results: [] as any[]
    };

    for (const [domain, result] of results) {
      if (result.isSafe) {
        summary.safeDomains++;
      } else {
        summary.blockedDomains++;
      }

      summary.results.push({
        domain: result.domain,
        isSafe: result.isSafe,
        isBlocked: result.isBlocked,
        cached: result.cached
      });
    }

    return {
      content: [{
        type: 'text',
        text: JSON.stringify(summary, null, 2)
      }]
    };
  }));

  // Scan single message for malicious domains
  server.registerTool('imap_scan_message_domains', {
    description: 'Extract and validate all domains from an email message against DNS firewall',
    inputSchema: {
      accountId: z.string().describe('Account ID'),
      folderName: z.string().describe('Folder name'),
      uid: z.number().describe('Message UID'),
      autoMarkSpam: z.boolean().optional().describe('Automatically mark as spam if malicious domains found (default: false)'),
    }
  }, withErrorHandling(async ({ accountId, folderName, uid, autoMarkSpam }) => {
    // Fetch message content
    const message = await imapService.getEmailContent(accountId, folderName, uid);

    // Extract all domains
    const domains = domainExtractor.extractAllDomains(message);

    // Validate domains
    const scanResult = await dnsFirewall.validateMessageDomains(uid, domains);

    // Auto-mark as spam if requested and malicious domains found
    if (autoMarkSpam && !scanResult.isSafe) {
      try {
        await imapService.bulkMarkEmails(accountId, folderName, [uid], 'deleted');
        console.error(`[DnsFirewall] Marked message ${uid} as spam (blocked domains: ${scanResult.blockedDomains.join(', ')})`);
      } catch (error) {
        console.error(`[DnsFirewall] Failed to mark message ${uid} as spam:`, error);
      }
    }

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          uid: scanResult.uid,
          isSafe: scanResult.isSafe,
          totalDomains: scanResult.totalDomains,
          blockedDomains: scanResult.blockedDomains,
          allDomains: scanResult.domains,
          scanTime: `${scanResult.scanTime}ms`,
          markedAsSpam: autoMarkSpam && !scanResult.isSafe,
        }, null, 2)
      }]
    };
  }));

  // Scan multiple messages in bulk
  server.registerTool('imap_bulk_scan_messages', {
    description: 'Scan multiple messages for malicious domains and optionally auto-mark as spam',
    inputSchema: {
      accountId: z.string().describe('Account ID'),
      folderName: z.string().describe('Folder name'),
      uids: z.array(z.number()).describe('Array of message UIDs to scan'),
      autoMarkSpam: z.boolean().optional().describe('Automatically mark as spam if malicious domains found (default: false)'),
    }
  }, withErrorHandling(async ({ accountId, folderName, uids, autoMarkSpam }) => {
    const results = [];
    const spamUIDs: number[] = [];

    for (const uid of uids) {
      try {
        // Fetch message content
        const message = await imapService.getEmailContent(accountId, folderName, uid);

        // Extract domains
        const domains = domainExtractor.extractAllDomains(message);

        // Validate domains
        const scanResult = await dnsFirewall.validateMessageDomains(uid, domains);

        results.push({
          uid: scanResult.uid,
          isSafe: scanResult.isSafe,
          totalDomains: scanResult.totalDomains,
          blockedDomains: scanResult.blockedDomains,
        });

        if (!scanResult.isSafe) {
          spamUIDs.push(uid);
        }
      } catch (error) {
        console.error(`[DnsFirewall] Failed to scan message ${uid}:`, error);
        results.push({
          uid,
          isSafe: true, // Assume safe on error
          totalDomains: 0,
          blockedDomains: [],
          error: (error as Error).message
        });
      }
    }

    // Auto-mark spam messages if requested
    let markedCount = 0;
    if (autoMarkSpam && spamUIDs.length > 0) {
      try {
        await imapService.bulkMarkEmails(accountId, folderName, spamUIDs, 'deleted');
        markedCount = spamUIDs.length;
        console.error(`[DnsFirewall] Marked ${markedCount} messages as spam`);
      } catch (error) {
        console.error(`[DnsFirewall] Failed to mark messages as spam:`, error);
      }
    }

    const summary = {
      totalScanned: uids.length,
      safeMessages: results.filter(r => r.isSafe).length,
      spamMessages: spamUIDs.length,
      markedAsSpam: markedCount,
      results
    };

    return {
      content: [{
        type: 'text',
        text: JSON.stringify(summary, null, 2)
      }]
    };
  }));
}
