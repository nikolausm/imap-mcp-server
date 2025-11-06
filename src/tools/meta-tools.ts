import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { withErrorHandling } from '../utils/error-handler.js';

/**
 * Meta tools for service discovery and information
 * These tools allow Claude to query the service itself for capabilities and version info
 */
export function metaTools(server: McpServer): void {
  // About tool - returns comprehensive service information
  server.registerTool('imap_about', {
    description: 'Get comprehensive information about the IMAP MCP Pro service including version, features, and capabilities',
    inputSchema: {}
  }, withErrorHandling(async () => {
    const about = {
      service: {
        name: 'IMAP MCP Pro',
        description: 'Enterprise-grade IMAP MCP server with Level 1-3 reliability features, circuit breaker, metrics, bulk operations, and SQLite3 database with AES-256-GCM encryption for commercial and large-scale deployments',
        version: '2.6.0',
        packageName: '@temple-of-epiphany/imap-mcp-pro'
      },
      license: {
        model: 'Dual-License',
        nonCommercial: 'FREE for personal, educational, and non-profit use',
        commercial: 'PAID license required for business use',
        contact: 'colin.bitterfield@templeofepiphany.com'
      },
      repository: {
        url: 'https://github.com/Temple-of-Epiphany/imap-mcp-pro',
        issues: 'https://github.com/Temple-of-Epiphany/imap-mcp-pro/issues',
        documentation: 'https://github.com/Temple-of-Epiphany/imap-mcp-pro#readme'
      },
      features: {
        reliability: [
          'Level 1: Enhanced keepalive (RFC 2177 compliant)',
          'Level 2: Automatic reconnection with exponential backoff',
          'Level 2: Retry logic with configurable attempts',
          'Level 2: Periodic health checks (NOOP every 29 minutes)',
          'Level 3: Circuit breaker pattern for failure prevention',
          'Level 3: Operation queue for outage recovery',
          'Level 3: Graceful degradation with read-only mode'
        ],
        operations: [
          'Single and bulk email operations',
          'Email search with multiple criteria',
          'Email content retrieval (headers, body, full)',
          'Mark emails (read/unread/flagged/unflagged)',
          'Copy and move emails between folders',
          'Delete emails (with optional expunge)',
          'SMTP email sending',
          'Folder management (list, status, unread counts, create, delete, rename)'
        ],
        monitoring: [
          'Per-connection metrics (operations, success rate, latency, uptime)',
          'Per-operation metrics (count, latency stats, success rate)',
          'Circuit breaker state tracking',
          'Connection state machine monitoring'
        ],
        security: [
          'SQLite3 database with AES-256-GCM encryption at rest',
          'Unique IV per encrypted field with integrity protection',
          'Secure encryption key storage with 0o600 permissions',
          'Multi-tenant user management with role-based access control',
          'Account sharing with granular permissions (MSP support)',
          'TLS/SSL support for IMAP and SMTP'
        ],
        database: [
          'SQLite3 with better-sqlite3 for robust persistence',
          'Encrypted account credentials (IMAP and SMTP)',
          'Multi-tenant architecture for MSP deployments',
          'User management with organizations and roles',
          'Account sharing across users',
          'Transactional integrity for multi-row operations'
        ]
      },
      capabilities: {
        totalTools: 41,
        toolCategories: [
          'User Management (9 tools) - NEW in v2.6.0',
          'Account Management (5 tools)',
          'Email Operations (18 tools)',
          'Folder Operations (6 tools)',
          'Meta/Discovery (3 tools)'
        ],
        bulkOperations: true,
        circuitBreaker: true,
        metrics: true,
        smtp: true
      },
      attribution: {
        organization: 'Temple of Epiphany',
        maintainer: 'Colin Bitterfield (colin.bitterfield@templeofepiphany.com)',
        contributors: [
          'Colin Bitterfield',
          'Michael Nikolaus (original author)'
        ],
        basedOn: 'Original IMAP MCP Server by Michael Nikolaus (MIT License)'
      }
    };

    return {
      content: [{
        type: 'text',
        text: JSON.stringify(about, null, 2)
      }]
    };
  }));

  // List tools - returns detailed manifest of all available tools
  server.registerTool('imap_list_tools', {
    description: 'List all available MCP tools with descriptions and parameters',
    inputSchema: {
      category: z.enum(['all', 'user', 'account', 'email', 'bulk', 'folder', 'sending', 'metrics', 'meta'])
        .optional()
        .default('all')
        .describe('Filter tools by category (default: all)')
    }
  }, withErrorHandling(async ({ category }) => {
    const allTools = [
      // User Management Tools (9) - NEW in v2.6.0
      {
        category: 'user',
        name: 'imap_create_user',
        description: 'Create a new user in the database',
        parameters: ['username', 'email', 'organization', 'role']
      },
      {
        category: 'user',
        name: 'imap_list_users',
        description: 'List all users in the database',
        parameters: []
      },
      {
        category: 'user',
        name: 'imap_get_user',
        description: 'Get user details by username',
        parameters: ['username']
      },
      {
        category: 'user',
        name: 'imap_db_add_account',
        description: 'Add IMAP account to database with encryption',
        parameters: ['userId', 'name', 'host', 'port', 'username', 'password', 'tls', 'smtpHost', 'smtpPort']
      },
      {
        category: 'user',
        name: 'imap_db_list_accounts',
        description: 'List accounts for a user from database',
        parameters: ['userId']
      },
      {
        category: 'user',
        name: 'imap_db_get_account',
        description: 'Get decrypted account details from database',
        parameters: ['accountId']
      },
      {
        category: 'user',
        name: 'imap_db_remove_account',
        description: 'Remove account from database',
        parameters: ['accountId']
      },
      {
        category: 'user',
        name: 'imap_share_account',
        description: 'Share account with another user (MSP feature)',
        parameters: ['accountId', 'targetUserId', 'role']
      },
      {
        category: 'user',
        name: 'imap_unshare_account',
        description: 'Revoke account access from user',
        parameters: ['accountId', 'targetUserId']
      },

      // Account Management Tools (5)
      {
        category: 'account',
        name: 'imap_add_account',
        description: 'Add a new IMAP account configuration',
        parameters: ['name', 'host', 'port', 'user', 'password', 'tls']
      },
      {
        category: 'account',
        name: 'imap_remove_account',
        description: 'Remove an IMAP account by ID',
        parameters: ['accountId']
      },
      {
        category: 'account',
        name: 'imap_list_accounts',
        description: 'List all configured IMAP accounts',
        parameters: []
      },
      {
        category: 'account',
        name: 'imap_connect',
        description: 'Connect to an IMAP account',
        parameters: ['accountId']
      },
      {
        category: 'account',
        name: 'imap_disconnect',
        description: 'Disconnect from an IMAP account',
        parameters: ['accountId']
      },

      // Email Operations (9)
      {
        category: 'email',
        name: 'imap_search_emails',
        description: 'Search for emails in a folder with multiple criteria',
        parameters: ['accountId', 'folder', 'from', 'to', 'subject', 'body', 'since', 'before', 'seen', 'flagged', 'limit']
      },
      {
        category: 'email',
        name: 'imap_get_email',
        description: 'Get the full content of an email',
        parameters: ['accountId', 'folder', 'uid']
      },
      {
        category: 'email',
        name: 'imap_mark_as_read',
        description: 'Mark an email as read',
        parameters: ['accountId', 'folder', 'uid']
      },
      {
        category: 'email',
        name: 'imap_mark_as_unread',
        description: 'Mark an email as unread',
        parameters: ['accountId', 'folder', 'uid']
      },
      {
        category: 'email',
        name: 'imap_delete_email',
        description: 'Delete an email (mark as deleted and optionally expunge)',
        parameters: ['accountId', 'folder', 'uid']
      },
      {
        category: 'email',
        name: 'imap_copy_email',
        description: 'Copy an email to another folder',
        parameters: ['accountId', 'sourceFolder', 'uid', 'targetFolder']
      },
      {
        category: 'email',
        name: 'imap_move_email',
        description: 'Move an email to another folder (copy + mark deleted)',
        parameters: ['accountId', 'sourceFolder', 'uid', 'targetFolder']
      },
      {
        category: 'email',
        name: 'imap_flag_email',
        description: 'Flag an email as important',
        parameters: ['accountId', 'folder', 'uid']
      },
      {
        category: 'email',
        name: 'imap_unflag_email',
        description: 'Remove flag from an email',
        parameters: ['accountId', 'folder', 'uid']
      },

      // Bulk Operations (4)
      {
        category: 'bulk',
        name: 'imap_bulk_delete_emails',
        description: 'Delete multiple emails efficiently',
        parameters: ['accountId', 'folder', 'uids', 'expunge']
      },
      {
        category: 'bulk',
        name: 'imap_bulk_get_emails',
        description: 'Fetch multiple emails (headers/body/full modes)',
        parameters: ['accountId', 'folder', 'uids', 'mode']
      },
      {
        category: 'bulk',
        name: 'imap_bulk_mark_emails',
        description: 'Mark multiple emails as read/unread/flagged/unflagged',
        parameters: ['accountId', 'folder', 'uids', 'action']
      },
      {
        category: 'bulk',
        name: 'imap_bulk_copy_emails',
        description: 'Copy multiple emails to another folder',
        parameters: ['accountId', 'sourceFolder', 'uids', 'targetFolder']
      },
      {
        category: 'bulk',
        name: 'imap_bulk_move_emails',
        description: 'Move multiple emails to another folder',
        parameters: ['accountId', 'sourceFolder', 'uids', 'targetFolder']
      },

      // Folder Operations (6)
      {
        category: 'folder',
        name: 'imap_list_folders',
        description: 'List all folders in an IMAP account',
        parameters: ['accountId']
      },
      {
        category: 'folder',
        name: 'imap_folder_status',
        description: 'Get folder statistics (total, new, unseen messages)',
        parameters: ['accountId', 'folder']
      },
      {
        category: 'folder',
        name: 'imap_get_unread_count',
        description: 'Count unread emails across folders',
        parameters: ['accountId', 'folders']
      },
      {
        category: 'folder',
        name: 'imap_create_folder',
        description: 'Create a new folder/mailbox in an IMAP account',
        parameters: ['accountId', 'folderName']
      },
      {
        category: 'folder',
        name: 'imap_delete_folder',
        description: 'Delete a folder/mailbox from an IMAP account',
        parameters: ['accountId', 'folderName']
      },
      {
        category: 'folder',
        name: 'imap_rename_folder',
        description: 'Rename a folder/mailbox in an IMAP account',
        parameters: ['accountId', 'oldName', 'newName']
      },

      // Email Sending (2)
      {
        category: 'sending',
        name: 'imap_send_email',
        description: 'Send an email via SMTP',
        parameters: ['accountId', 'to', 'subject', 'body', 'cc', 'bcc', 'attachments']
      },
      {
        category: 'sending',
        name: 'imap_reply_to_email',
        description: 'Reply to an existing email',
        parameters: ['accountId', 'folder', 'uid', 'body', 'replyAll']
      },

      // Metrics & Monitoring (3)
      {
        category: 'metrics',
        name: 'imap_get_metrics',
        description: 'Get connection health metrics (operations, success rate, latency, uptime)',
        parameters: ['accountId']
      },
      {
        category: 'metrics',
        name: 'imap_get_operation_metrics',
        description: 'Get per-operation statistics',
        parameters: ['accountId', 'operation']
      },
      {
        category: 'metrics',
        name: 'imap_reset_metrics',
        description: 'Reset metric tracking for an account',
        parameters: ['accountId']
      },

      // Meta/Discovery Tools (2)
      {
        category: 'meta',
        name: 'imap_about',
        description: 'Get comprehensive information about the IMAP MCP Pro service',
        parameters: []
      },
      {
        category: 'meta',
        name: 'imap_list_tools',
        description: 'List all available MCP tools with descriptions',
        parameters: ['category']
      }
    ];

    // Filter by category if specified
    const filteredTools = category === 'all'
      ? allTools
      : allTools.filter(tool => tool.category === category);

    const response = {
      totalTools: allTools.length,
      filteredCount: filteredTools.length,
      category: category,
      tools: filteredTools.map(tool => ({
        name: tool.name,
        category: tool.category,
        description: tool.description,
        parameters: tool.parameters
      }))
    };

    return {
      content: [{
        type: 'text',
        text: JSON.stringify(response, null, 2)
      }]
    };
  }));
}
