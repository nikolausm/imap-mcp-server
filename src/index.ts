#!/usr/bin/env node

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import dotenv from 'dotenv';
import { ImapService } from './services/imap-service.js';
import { AccountManager } from './services/account-manager.js';
import { registerTools } from './tools/index.js';

dotenv.config();

const server = new McpServer({
  name: 'imap-mcp-server',
  version: '1.0.0',
});

const imapService = new ImapService();
const accountManager = new AccountManager();

// Register all tools
registerTools(server, imapService, accountManager);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('IMAP MCP Server started');
}

main().catch((error) => {
  console.error('Server error:', error);
  process.exit(1);
});