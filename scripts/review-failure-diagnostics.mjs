import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

// Never print provider messages, prompts, file contents, or credentials.
// Only error-bearing records contribute to the bounded category output.
export function classifyReviewFailure(output) {
  const events = Array.isArray(output) ? output : (output?.messages || [output]);
  const errors = [];
  const collect = value => {
    if (typeof value === 'string') errors.push(value);
    else if (Array.isArray(value)) value.forEach(collect);
    else if (value && typeof value === 'object') Object.values(value).forEach(collect);
  };
  let denied = false;
  for (const event of events) {
    if (!event || typeof event !== 'object') continue;
    if (event.type === 'result' && event.is_error === true) {
      collect(event.result);
      collect(event.errors);
      denied ||= event.permission_denials_count > 0;
    }
    if (event.error) collect(event.error);
    if (event.is_api_error === true) collect(event.message?.content);
  }
  const message = errors.join('\n');
  if (/authentication_error|invalid.{0,30}(?:api key|oauth token)|oauth.{0,30}expired|unauthorized|\b401\b/i.test(message)) return 'authentication';
  if (/rate_limit|usage limit|quota exceeded|credit balance|too many requests|\b429\b/i.test(message)) return 'quota_or_rate_limit';
  if (denied || /permission_denied|permission denied|forbidden|\b403\b/i.test(message)) return 'permissions';
  if (/overloaded_error|internal_server_error|\b50[0234]\b/i.test(message)) return 'provider_unavailable';
  return 'unclassified_execution_error';
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let category = 'review_output_unavailable';
  const filename = process.env.CLAUDE_REVIEW_OUTPUT || join(process.env.RUNNER_TEMP || '', 'claude-execution-output.json');
  try {
    category = classifyReviewFailure(JSON.parse(readFileSync(filename, 'utf8')));
  } catch {
    // Raw parsing and filesystem errors can contain paths or credentials.
  }
  console.log(`Claude review diagnostic category: ${category}`);
}
