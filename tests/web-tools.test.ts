import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { webTools } from '../src/tools/web-tools.js';

describe('imap_web_search', () => {
  const savedFetch = globalThis.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
    process.env.YDC_API_KEY = 'test-key';
  });

  afterEach(() => {
    globalThis.fetch = savedFetch;
    delete process.env.YDC_API_KEY;
  });

  it('returns a friendly message when YDC_API_KEY is missing', async () => {
    delete process.env.YDC_API_KEY;
    const names: string[] = [];
    let handler: any;
    const server = {
      registerTool: (name: string, _schema: any, cb: any) => {
        names.push(name);
        handler = cb;
      },
    } as any;

    webTools(server);
    const result = await handler({ query: 'openclaw' });

    expect(names).toEqual(['imap_web_search']);
    expect(result.content[0].text).toContain('YDC_API_KEY is not configured');
  });

  it('calls the You.com Search API and returns compact results', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        metadata: { search_uuid: 'abc', query: 'openclaw', latency: 0.1 },
        results: {
          web: [{ title: 'OpenClaw', url: 'https://example.com', description: 'A'.repeat(500), snippets: ['B'.repeat(250)] }],
          news: [{ title: 'News', url: 'https://news.example.com', description: 'Fresh news' }],
        },
      }),
    });
    globalThis.fetch = fetchMock as any;

    let handler: any;
    const server = {
      registerTool: (_name: string, _schema: any, cb: any) => {
        handler = cb;
      },
    } as any;

    webTools(server);
    const result = await handler({ query: 'openclaw', count: 3, country: 'US' });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toContain('query=openclaw');
    expect(String(fetchMock.mock.calls[0][0])).toContain('count=3');
    expect(String(fetchMock.mock.calls[0][0])).toContain('country=US');
    expect(result.content[0].text).toContain('OpenClaw');
    expect(result.content[0].text).toContain('…');
  });
});
