import { describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { classifyReviewFailure } from '../scripts/review-failure-diagnostics.mjs';

describe('review diagnostics confidentiality', () => {
  it.each([
    ['authentication_error: synthetic-secret', 'authentication'],
    ['Credit balance exhausted: synthetic-secret', 'quota_or_rate_limit'],
    ['403 forbidden: synthetic-secret', 'permissions'],
    ['overloaded_error: synthetic-secret', 'provider_unavailable'],
    ['Unspecified failure: synthetic-secret', 'unclassified_execution_error'],
  ])('categorizes failures without returning provider content', (result, expected) => {
    expect(classifyReviewFailure([{ type: 'result', is_error: true, result }])).toBe(expected);
  });

  it('ignores authentication examples in successful review/tool messages', () => {
    expect(classifyReviewFailure([
      { type: 'assistant', message: { content: [{ text: '401 authentication_error' }] } },
      { type: 'result', is_error: false, result: 'invalid api key example' },
    ])).toBe('unclassified_execution_error');
  });

  it('CLI emits only the category and never a synthetic credential', () => {
    const dir = mkdtempSync(join(tmpdir(), 'review-diagnostic-'));
    try {
      const file = join(dir, 'output.json');
      writeFileSync(file, JSON.stringify([{ type: 'result', is_error: true, result: 'authentication_error: synthetic-secret' }]));
      const result = spawnSync(process.execPath, ['scripts/review-failure-diagnostics.mjs'], {
        cwd: process.cwd(), env: { ...process.env, CLAUDE_REVIEW_OUTPUT: file }, encoding: 'utf8',
      });
      expect(result.status).toBe(0);
      expect(result.stdout).toBe('Claude review diagnostic category: authentication\n');
      expect(result.stderr).toBe('');
      expect(result.stdout + result.stderr).not.toContain('synthetic-secret');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
