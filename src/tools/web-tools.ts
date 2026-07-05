import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

const DEFAULT_COUNT = 5;
const SEARCH_URL = 'https://ydc-index.io/v1/search';

function buildSearchUrl(query: string, count: number) {
  const url = new URL(SEARCH_URL);
  url.searchParams.set('query', query);
  url.searchParams.set('count', String(count));
  return url;
}

function truncate(value: string | undefined, max = 400): string | undefined {
  if (value === undefined) return undefined;
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

export function webTools(server: McpServer): void {
  server.registerTool('imap_web_search', {
    description: 'Search the web with You.com and return concise web and news results. This is optional and only works when YDC_API_KEY is configured. Use it when email work needs a quick external lookup, reference check, or fresh context without leaving the MCP session.',
    inputSchema: {
      query: z.string().min(1).describe('Search query'),
      count: z.coerce.number().min(1).max(10).default(DEFAULT_COUNT).describe('Maximum results per section'),
      livecrawl: z.enum(['web', 'news', 'all']).optional().describe('Optionally include inline page contents from You.com search results'),
      language: z.string().optional().describe('Optional language code, e.g. EN'),
      country: z.string().optional().describe('Optional country code, e.g. US'),
      safesearch: z.enum(['off', 'moderate', 'strict']).optional().describe('Safe search mode'),
    },
  }, async ({ query, count, livecrawl, language, country, safesearch }) => {
    const apiKey = process.env.YDC_API_KEY;
    if (!apiKey) {
      return {
        content: [{ type: 'text', text: 'YDC_API_KEY is not configured. Set it to enable imap_web_search.' }],
      };
    }

    try {
      const url = buildSearchUrl(query, count);
      if (livecrawl) url.searchParams.set('livecrawl', livecrawl);
      if (language) url.searchParams.set('language', language);
      if (country) url.searchParams.set('country', country);
      if (safesearch) url.searchParams.set('safesearch', safesearch);

      const response = await fetch(url, { headers: { 'X-API-Key': apiKey } });
      if (!response.ok) {
        return {
          content: [{ type: 'text', text: `You.com Search API request failed: ${response.status}` }],
        };
      }

      const data = await response.json() as any;
      const web = (data?.results?.web ?? []).map((item: any) => ({
        title: item.title,
        url: item.url,
        description: truncate(item.description),
        snippets: Array.isArray(item.snippets) ? item.snippets.map((snippet: string) => truncate(snippet, 200)) : undefined,
      }));
      const news = (data?.results?.news ?? []).map((item: any) => ({
        title: item.title,
        url: item.url,
        description: truncate(item.description),
      }));

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            metadata: data?.metadata,
            results: { web, news },
          }, null, 2),
        }],
      };
    } catch (err) {
      return {
        content: [{ type: 'text', text: `You.com Search API error: ${err instanceof Error ? err.message : String(err)}` }],
      };
    }
  });
}
