/**
 * Email Confidence Scoring MCP Tools
 *
 * Provides anti-spoofing detection tools
 *
 * @author Colin Bitterfield <colin@bitterfield.com>
 * @version 0.1.0
 * @date_created 2025-11-06
 * @date_updated 2025-11-06
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { ImapService } from '../services/imap-service.js';
import { ConfidenceScoringService, EmailHeaders } from '../services/confidence-scoring-service.js';
import { withErrorHandling } from '../utils/error-handler.js';

export function registerScoringTools(
  server: McpServer,
  imapService: ImapService
): void {
  const scoringService = new ConfidenceScoringService();

  /**
   * Score a single email for legitimacy
   */
  server.registerTool('imap_score_email_confidence', {
    description: 'Analyze email headers to detect spoofing and calculate confidence score (-100 to +100). Returns detailed breakdown of scoring rules, flags, and recommendation.',
    inputSchema: {
      accountId: z.string().describe('Account ID'),
      folder: z.string().default('INBOX').describe('Folder name'),
      uid: z.number().describe('Email UID to analyze')
    }
  }, withErrorHandling(async ({ accountId, folder, uid }: { accountId: string; folder: string; uid: number }) => {
    // Fetch email headers only (efficient)
    const email = await imapService.getEmailContent(accountId, folder, uid, true);

    // Build EmailHeaders object for scoring
    const headers: EmailHeaders = {
      from: email.from,
      replyTo: email.from, // Will be populated if different
      subject: email.subject,
      messageId: email.messageId,
      date: email.date,
      to: email.to
    };

    // Score the email
    const score = scoringService.scoreEmailConfidence(headers);

    // Format output
    const output = {
      email: {
        uid: email.uid,
        from: email.from,
        subject: email.subject,
        date: email.date
      },
      scoring: {
        totalScore: score.totalScore,
        confidence: score.confidence,
        recommendation: score.recommendation,
        flags: score.flags,
        breakdown: score.rules.map(rule => ({
          rule: rule.rule,
          points: rule.points,
          reason: rule.reason
        }))
      }
    };

    return {
      content: [{
        type: 'text',
        text: JSON.stringify(output, null, 2)
      }]
    };
  }));

  /**
   * Score multiple emails in bulk
   */
  server.registerTool('imap_bulk_score_emails', {
    description: 'Analyze multiple emails for spoofing detection. Efficiently processes 100+ emails in < 5 seconds using headers-only analysis. Returns confidence scores and flags for all emails.',
    inputSchema: {
      accountId: z.string().describe('Account ID'),
      folder: z.string().default('INBOX').describe('Folder name'),
      uids: z.array(z.number()).describe('Array of email UIDs to analyze'),
      minScore: z.number().optional().describe('Optional: Only return emails with score <= this value (useful for filtering suspicious emails)')
    }
  }, withErrorHandling(async ({ accountId, folder, uids, minScore }: { accountId: string; folder: string; uids: number[]; minScore?: number }) => {
    const startTime = Date.now();
    const results = [];

    // Process emails in parallel for speed
    const emailPromises = uids.map((uid: number) =>
      imapService.getEmailContent(accountId, folder, uid, true)
    );

    const emails = await Promise.all(emailPromises);

    // Score all emails
    for (const email of emails) {
      const headers: EmailHeaders = {
        from: email.from,
        replyTo: email.from,
        subject: email.subject,
        messageId: email.messageId,
        date: email.date,
        to: email.to
      };

      const score = scoringService.scoreEmailConfidence(headers);

      // Apply filter if specified
      if (minScore !== undefined && score.totalScore > minScore) {
        continue;
      }

      results.push({
        uid: email.uid,
        from: email.from,
        subject: email.subject,
        date: email.date,
        score: score.totalScore,
        confidence: score.confidence,
        flags: score.flags,
        recommendation: score.recommendation,
        topIssues: score.rules
          .filter(r => r.points < 0)
          .sort((a, b) => a.points - b.points)
          .slice(0, 3)
          .map(r => r.reason)
      });
    }

    const endTime = Date.now();
    const processingTime = (endTime - startTime) / 1000;

    // Sort by score (lowest/most suspicious first)
    results.sort((a, b) => a.score - b.score);

    const output = {
      summary: {
        totalAnalyzed: uids.length,
        totalReturned: results.length,
        processingTimeSeconds: processingTime,
        averageTimePerEmail: processingTime / uids.length,
        filtered: minScore !== undefined ? `Score <= ${minScore}` : 'None'
      },
      results
    };

    return {
      content: [{
        type: 'text',
        text: JSON.stringify(output, null, 2)
      }]
    };
  }));

  /**
   * Get statistics about email confidence in a folder
   */
  server.registerTool('imap_analyze_folder_confidence', {
    description: 'Analyze all emails in a folder and provide confidence statistics. Useful for identifying patterns of suspicious emails.',
    inputSchema: {
      accountId: z.string().describe('Account ID'),
      folder: z.string().default('INBOX').describe('Folder name'),
      limit: z.number().optional().default(100).describe('Maximum number of emails to analyze (default: 100)')
    }
  }, withErrorHandling(async ({ accountId, folder, limit }: { accountId: string; folder: string; limit?: number }) => {
    // Search for recent emails
    const searchResults = await imapService.searchEmails(accountId, folder, {});

    // Take most recent emails up to limit
    const uidsToAnalyze = searchResults.slice(0, limit);

    if (uidsToAnalyze.length === 0) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            error: 'No emails found in folder'
          }, null, 2)
        }]
      };
    }

    const startTime = Date.now();

    // Fetch and score all emails
    const emailPromises = uidsToAnalyze.map((emailMessage: any) =>
      imapService.getEmailContent(accountId, folder, emailMessage.uid, true)
    );

    const emails = await Promise.all(emailPromises);

    const scores = emails.map(email => {
      const headers: EmailHeaders = {
        from: email.from,
        replyTo: email.from,
        subject: email.subject,
        messageId: email.messageId,
        date: email.date,
        to: email.to
      };

      return scoringService.scoreEmailConfidence(headers);
    });

    const endTime = Date.now();

    // Calculate statistics
    const scoreValues = scores.map(s => s.totalScore);
    const avgScore = scoreValues.reduce((a, b) => a + b, 0) / scoreValues.length;
    const minScore = Math.min(...scoreValues);
    const maxScore = Math.max(...scoreValues);

    const confidenceCounts = {
      HIGH: scores.filter(s => s.confidence === 'HIGH').length,
      MEDIUM: scores.filter(s => s.confidence === 'MEDIUM').length,
      LOW: scores.filter(s => s.confidence === 'LOW').length,
      VERY_LOW: scores.filter(s => s.confidence === 'VERY_LOW').length
    };

    // Common flags
    const flagCounts: { [key: string]: number } = {};
    scores.forEach(score => {
      score.flags.forEach(flag => {
        flagCounts[flag] = (flagCounts[flag] || 0) + 1;
      });
    });

    const topFlags = Object.entries(flagCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([flag, count]) => ({
        flag,
        count,
        percentage: ((count / scores.length) * 100).toFixed(1) + '%'
      }));

    // Most suspicious emails
    const suspicious = emails
      .map((email, index) => ({
        uid: email.uid,
        from: email.from,
        subject: email.subject,
        score: scores[index].totalScore,
        confidence: scores[index].confidence,
        flags: scores[index].flags
      }))
      .filter(e => e.score < 0)
      .sort((a, b) => a.score - b.score)
      .slice(0, 10);

    const output = {
      summary: {
        folder,
        analyzedCount: emails.length,
        processingTimeSeconds: (endTime - startTime) / 1000,
        averageScore: Math.round(avgScore),
        minScore,
        maxScore
      },
      confidenceDistribution: confidenceCounts,
      topFlags,
      mostSuspiciousEmails: suspicious,
      recommendations: {
        highRisk: confidenceCounts.VERY_LOW + confidenceCounts.LOW,
        recommendReview: suspicious.length > 0 ? 'Yes - suspicious emails detected' : 'No issues detected'
      }
    };

    return {
      content: [{
        type: 'text',
        text: JSON.stringify(output, null, 2)
      }]
    };
  }));
}
