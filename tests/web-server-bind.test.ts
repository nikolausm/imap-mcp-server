import { describe, it, expect, afterEach } from 'vitest';
import { WebUIServer } from '../src/web/server.js';

describe('WebUIServer bind host', () => {
  const saved = process.env.IMAP_MCP_BIND;

  afterEach(() => {
    if (saved === undefined) delete process.env.IMAP_MCP_BIND;
    else process.env.IMAP_MCP_BIND = saved;
  });

  it('defaults bindHost to 127.0.0.1', () => {
    delete process.env.IMAP_MCP_BIND;
    const wizard = new WebUIServer(0, { accountManager: {} as any, imapService: {} as any });
    expect((wizard as any).bindHost).toBe('127.0.0.1');
  });

  it('honors IMAP_MCP_BIND', () => {
    process.env.IMAP_MCP_BIND = '0.0.0.0';
    const wizard = new WebUIServer(0, { accountManager: {} as any, imapService: {} as any });
    expect((wizard as any).bindHost).toBe('0.0.0.0');
  });

  it('constructor bindHost overrides env', () => {
    process.env.IMAP_MCP_BIND = '0.0.0.0';
    const wizard = new WebUIServer(0, {
      accountManager: {} as any,
      imapService: {} as any,
      bindHost: '127.0.0.1',
    });
    expect((wizard as any).bindHost).toBe('127.0.0.1');
  });
});
