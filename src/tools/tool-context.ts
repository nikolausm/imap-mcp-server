/**
 * Tool Context - Provides user context for MCP tools
 *
 * Extracts MCP_USER_ID from environment variable to enforce user isolation.
 * Critical for MSP multi-tenant deployments to prevent cross-user data access.
 *
 * Author: Colin Bitterfield
 * Email: colin@bitterfield.com
 * Date: 2025-11-06
 * Version: 1.0.0
 *
 * Related Issues: #8, #32, #34
 */

import { DatabaseService } from '../services/database-service.js';

export interface ToolContext {
  userId: string;      // User ID from MCP_USER_ID env var
  username: string;    // Username for display
  db: DatabaseService; // Database service instance
}

/**
 * Get tool context from environment
 *
 * Reads MCP_USER_ID from environment variable (set in Claude Desktop config).
 * Falls back to 'default' for backward compatibility.
 *
 * @param db - Database service instance
 * @returns ToolContext with user information
 * @throws Error if user not found or inactive
 */
export function getToolContext(db: DatabaseService): ToolContext {
  // Get username from environment (set in MCP config)
  const username = process.env.MCP_USER_ID || 'default';

  // Look up user in database
  const user = db.getUserByUsername(username);

  if (!user) {
    throw new Error(
      `User '${username}' not found. ` +
      `Please ensure MCP_USER_ID environment variable is set correctly in your MCP configuration.`
    );
  }

  if (!user.is_active) {
    throw new Error(
      `User '${username}' is inactive. ` +
      `Please contact your administrator.`
    );
  }

  return {
    userId: user.user_id,
    username: user.username,
    db
  };
}

/**
 * Wrapper to add user authorization to MCP tool handlers
 *
 * Automatically injects user context into tool handler.
 * Verifies user exists and is active before calling handler.
 *
 * Example usage:
 * ```typescript
 * server.registerTool('imap_list_accounts', {
 *   description: 'List all IMAP accounts for the current user',
 *   inputSchema: {}
 * }, withUserAuthorization(db, async (params, context) => {
 *   // context.userId is guaranteed to be valid
 *   const accounts = db.listAccounts(context.userId);
 *   return { content: [{ type: 'text', text: JSON.stringify(accounts) }] };
 * }));
 * ```
 *
 * @param db - Database service instance
 * @param handler - Tool handler function that receives params and context
 * @returns Wrapped handler with user authorization
 */
export function withUserAuthorization<T>(
  db: DatabaseService,
  handler: (params: T, context: ToolContext) => Promise<any>
) {
  return async (params: T) => {
    // Get user context from environment
    const context = getToolContext(db);

    // Call handler with context
    return handler(params, context);
  };
}
