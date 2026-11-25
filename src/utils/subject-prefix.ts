const REPLY_PREFIX = /^\s*(re|aw)\s*:/i;
const FORWARD_PREFIX = /^\s*(fwd?|wg)\s*:/i;

export function replySubject(subject: string): string {
  return REPLY_PREFIX.test(subject) ? subject : `Re: ${subject}`;
}

export function forwardSubject(subject: string): string {
  return FORWARD_PREFIX.test(subject) ? subject : `Fwd: ${subject}`;
}
