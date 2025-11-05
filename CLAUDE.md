# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is an IMAP MCP (Model Context Protocol) server built with TypeScript that provides comprehensive IMAP email integration with secure account management and connection pooling.

## Common Development Commands

- Build the project: `npm run build`
- Run in development mode: `npm run dev`
- Start the compiled server: `npm start`
- Install dependencies: `npm install`

## Architecture

### Core Components

1. **MCP Server (`src/index.ts`)**: The main entry point that sets up the MCP server using the McpServer class from the MCP SDK.

2. **Services**:
   - `ImapService`: Manages IMAP connections, email operations, and folder management with connection pooling
   - `AccountManager`: Handles secure account storage with AES-256 encryption

3. **Tools**: MCP tools are organized into three categories:
   - `account-tools.ts`: Account management (add, remove, list, connect, disconnect)
   - `email-tools.ts`: Email operations (search, read, mark, delete)
   - `folder-tools.ts`: Folder operations (list, status, unread counts)

### Key Design Decisions

- Uses `node-imap` for IMAP protocol implementation
- Implements connection pooling to efficiently manage multiple IMAP connections
- Stores encrypted credentials in `~/.imap-mcp/accounts.json`
- All MCP tools return JSON-formatted text responses
- TypeScript for type safety with comprehensive type definitions in `src/types/`

## Adding New Features

When adding new IMAP operations:
1. Add the operation to the appropriate service (`ImapService`)
2. Create or update the corresponding tool in the tools directory
3. Ensure proper error handling and connection management
4. Update types if needed in `src/types/index.ts`
- Later this library will be used for MSP services so each master account will have it's own subordinate email accounts. Security will need to be maintained. Do not make coding choices that will preclude this in the future.