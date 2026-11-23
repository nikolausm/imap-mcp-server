/**
 * Error carrying a stable, machine-readable `reason` code.
 *
 * Service methods throw it for caller-facing refusals (e.g. "destination
 * exists") so tool handlers can return `{ success: false, reason }` instead
 * of making an LLM parse the message text.
 */
export class ImapOperationError extends Error {
  readonly reason: string;

  constructor(reason: string, message: string) {
    super(message);
    this.name = 'ImapOperationError';
    this.reason = reason;
  }
}

/** The `reason` of an {@link ImapOperationError}, or `fallback` for any other error. */
export function errorReason(err: unknown, fallback = 'server_error'): string {
  return err instanceof ImapOperationError ? err.reason : fallback;
}
