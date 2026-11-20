import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ImapService } from '../services/imap-service.js';
import { AccountManager } from '../services/account-manager.js';
import { parseSerializedArray } from '../utils/array-input.js';
import { extractDmarcXml, parseDmarcXml, type DmarcRecord, type DmarcReport } from '../utils/dmarc.js';
import { promises as dns } from 'dns';
import { z } from 'zod';

const accountSelector = {
  accountId: z.string().optional().describe('Account ID (from imap_list_accounts). Optional if accountName is given or only one account is configured.'),
  accountName: z.string().optional().describe('Account name instead of accountId. Optional if accountId is given or only one account is configured.'),
};

const uidList = (description: string) =>
  z.preprocess(
    value => parseSerializedArray(value, 'uid'),
    z.union([z.coerce.number(), z.array(z.coerce.number())])
  ).describe(description);

/**
 * Reverse-DNS one IP; never throws. Tries the DNS protocol resolver first, then
 * the operating system resolver (getnameinfo), which is what works on Windows
 * machines where c-ares can't find the configured DNS servers.
 */
async function reverseLookup(ip: string, timeoutMs = 3000): Promise<string | undefined> {
  const withTimeout = <T>(p: Promise<T>) =>
    Promise.race([p, new Promise<T>((_, reject) => setTimeout(() => reject(new Error('timeout')), timeoutMs))]);
  try {
    const names = await withTimeout(dns.reverse(ip));
    if (names[0]) return names[0];
  } catch {
    // fall through to the OS resolver
  }
  try {
    const { hostname } = await withTimeout(dns.lookupService(ip, 0));
    return hostname && hostname !== ip ? hostname : undefined;
  } catch {
    return undefined;
  }
}

const isIssue = (r: DmarcRecord) => r.dmarc === 'fail' || r.dkim !== 'pass' || r.spf !== 'pass';

export function dmarcTools(
  server: McpServer,
  imapService: ImapService,
  accountManager: AccountManager
): void {
  server.registerTool('imap_get_dmarc_report', {
    description: 'Decode DMARC aggregate (RUA) report emails — the ones from noreply-dmarc-support@google.com, dmarcreport@microsoft.com, Yahoo and others, with a .zip/.xml.gz/.xml attachment — and return a pass/fail summary instead of raw XML. Pass one uid or an array of uids from the same folder. For each report: reporting org, date range, published policy, message totals (DMARC pass/fail, aligned DKIM and SPF failures) and, by default, only the records that need attention (any failure). The top-level `issues` list groups every failing source IP across all reports. Use this before filing or deleting DMARC reports to check for failures or unknown senders. Read-only: nothing in the mailbox is changed.',
    inputSchema: {
      ...accountSelector,
      folder: z.string().default('INBOX').describe('Folder holding the report emails'),
      uid: uidList('Single email UID or array of UIDs of DMARC report emails (all in `folder`).').nonoptional(),
      detail: z.enum(['issues', 'full']).default('issues').describe('"issues" (default): per report, return totals plus only records with a DKIM, SPF or DMARC failure. "full": return every record.'),
      resolveHostnames: z.boolean().default(false).describe('If true, reverse-DNS each source IP that appears in the returned records (e.g. mail56.out.titan.email) so unknown senders are easier to identify. Off by default: it sends DNS queries through the system resolver.'),
    }
  }, async ({ accountId: rawAccountId, accountName, folder, uid, detail, resolveHostnames }) => {
    const accountId = accountManager.resolveAccountId(rawAccountId, accountName);
    const uids: number[] = Array.isArray(uid) ? (uid as number[]) : [uid as number];

    const reports: Array<{ uid: number; attachment: string; report: Omit<DmarcReport, 'records'> & { records: DmarcRecord[] } }> = [];
    const errors: Array<{ uid: number; attachment?: string; error: string }> = [];

    for (const u of uids) {
      let attachments: Array<{ content: Buffer; contentType: string; filename: string }>;
      try {
        attachments = await imapService.getAllAttachments(accountId, folder, u);
      } catch (err) {
        errors.push({ uid: u, error: err instanceof Error ? err.message : String(err) });
        continue;
      }
      let found = 0;
      for (const att of attachments) {
        let docs: Array<{ name: string; xml: string }>;
        try {
          docs = extractDmarcXml(att.content, att.filename);
        } catch (err) {
          errors.push({ uid: u, attachment: att.filename, error: err instanceof Error ? err.message : String(err) });
          continue;
        }
        for (const doc of docs) {
          try {
            const report = parseDmarcXml(doc.xml);
            reports.push({ uid: u, attachment: att.filename, report });
            found++;
          } catch (err) {
            errors.push({ uid: u, attachment: att.filename, error: err instanceof Error ? err.message : String(err) });
          }
        }
      }
      if (found === 0 && !errors.some(e => e.uid === u)) {
        errors.push({ uid: u, error: 'No DMARC report attachment (.zip, .gz or .xml) found in this email' });
      }
    }

    // Pick the records to return, then (optionally) resolve their hostnames once per IP.
    const shown = reports.map(r => ({
      ...r,
      report: { ...r.report, records: detail === 'full' ? r.report.records : r.report.records.filter(isIssue) },
    }));
    if (resolveHostnames) {
      const ips = [...new Set(shown.flatMap(r => r.report.records.map(rec => rec.sourceIp)).filter(Boolean))];
      const names = new Map<string, string | undefined>();
      await Promise.all(ips.map(async ip => names.set(ip, await reverseLookup(ip))));
      for (const r of shown) for (const rec of r.report.records) rec.hostname = names.get(rec.sourceIp);
    }

    // Cross-report view of failing sources, so one glance answers "anything wrong?".
    const issueMap = new Map<string, { sourceIp: string; hostname?: string; headerFrom?: string; messages: number; dkimFail: number; spfFail: number; dmarcFail: number; reporters: Set<string> }>();
    for (const r of reports) {
      for (const rec of r.report.records.filter(isIssue)) {
        const key = `${rec.sourceIp}|${rec.headerFrom ?? ''}`;
        const entry = issueMap.get(key) ?? { sourceIp: rec.sourceIp, headerFrom: rec.headerFrom, messages: 0, dkimFail: 0, spfFail: 0, dmarcFail: 0, reporters: new Set<string>() };
        entry.messages += rec.count;
        if (rec.dkim !== 'pass') entry.dkimFail += rec.count;
        if (rec.spf !== 'pass') entry.spfFail += rec.count;
        if (rec.dmarc === 'fail') entry.dmarcFail += rec.count;
        if (r.report.orgName) entry.reporters.add(r.report.orgName);
        issueMap.set(key, entry);
      }
    }
    const hostnameByIp = new Map(shown.flatMap(r => r.report.records.map(rec => [rec.sourceIp, rec.hostname] as const)));
    const issues = [...issueMap.values()].map(e => ({
      sourceIp: e.sourceIp,
      ...(hostnameByIp.get(e.sourceIp) ? { hostname: hostnameByIp.get(e.sourceIp) } : {}),
      headerFrom: e.headerFrom,
      messages: e.messages,
      dmarcFail: e.dmarcFail,
      dkimFail: e.dkimFail,
      spfFail: e.spfFail,
      reporters: [...e.reporters],
    }));

    const totals = reports.reduce(
      (t, r) => ({
        messages: t.messages + r.report.totals.messages,
        dmarcPass: t.dmarcPass + r.report.totals.dmarcPass,
        dmarcFail: t.dmarcFail + r.report.totals.dmarcFail,
        dkimFail: t.dkimFail + r.report.totals.dkimFail,
        spfFail: t.spfFail + r.report.totals.spfFail,
      }),
      { messages: 0, dmarcPass: 0, dmarcFail: 0, dkimFail: 0, spfFail: 0 }
    );

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: errors.length === 0,
          reportCount: reports.length,
          allPass: reports.length > 0 && issues.length === 0,
          totals,
          issues,
          reports: shown.map(r => ({ uid: r.uid, attachment: r.attachment, ...r.report })),
          ...(errors.length > 0 ? { errors } : {}),
        }, null, 2)
      }]
    };
  });
}
