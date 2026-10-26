/** Validate only the RFC 5322 header block; never decode or normalize MIME body bytes. */
export function draftHeaders(raw: Buffer): { split: number; headers: string[] } {
  const split = raw.indexOf('\r\n\r\n');
  if (split < 0) throw new Error('Draft must have RFC 5322 CRLF headers');
  for (let i = 0; i < split; i++) {
    if (raw[i] === 13) {
      if (raw[i + 1] !== 10) throw new Error('Draft headers contain a lone CR or LF');
      i++;
    } else if (raw[i] === 10) {
      throw new Error('Draft headers contain a lone CR or LF');
    }
  }
  return { split, headers: raw.subarray(0, split).toString('latin1').split(/\r\n(?![ \t])/) };
}
