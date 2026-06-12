import { ImapAccount } from '../types/index.js';

const AUTO_SAVE_PATTERNS = [
  /(^|\.)zoho\./i,
  /(^|\.)gmail\.com$/i,
  /(^|\.)googlemail\.com$/i,
  /(^|\.)google\.com$/i,
];

function hostAutoSaves(host?: string): boolean {
  if (!host) return false;
  return AUTO_SAVE_PATTERNS.some(p => p.test(host));
}

export function shouldSaveToSent(account: ImapAccount): boolean {
  if (account.saveToSent === false) return false;
  if (account.saveToSent === true) return true;
  if (hostAutoSaves(account.smtp?.host) || hostAutoSaves(account.host)) return false;
  return true;
}
