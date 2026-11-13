import crypto from 'crypto';

/** Legacy AES-256-CBC wire format: `<iv_hex>:<ciphertext_hex>` (no auth tag). */
const LEGACY_CBC_RE = /^[0-9a-f]+:[0-9a-f]+$/i;

/** AES-256-GCM v1: `gcm:v1:<iv_b64>:<tag_b64>:<ct_b64>`. */
const GCM_V1_PREFIX = 'gcm:v1:';

export type CipherKind = 'gcm-v1' | 'cbc-v0' | 'empty' | 'unknown';

export function classifyCiphertext(value: string | null | undefined): CipherKind {
  if (value === undefined || value === null || value === '') return 'empty';
  if (typeof value !== 'string') return 'unknown';
  if (value.startsWith(GCM_V1_PREFIX)) return 'gcm-v1';
  if (LEGACY_CBC_RE.test(value) && value.includes(':')) return 'cbc-v0';
  return 'unknown';
}

/**
 * Encrypt with AES-256-GCM. `aad` binds ciphertext to account/field context so
 * a swapped field cannot decrypt under another label.
 */
export function encryptAesGcm(plaintext: string, key: Buffer, aad: string): string {
  if (key.length !== 32) {
    throw new Error('AES-256-GCM requires a 32-byte key');
  }
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(aad, 'utf8'));
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    'gcm',
    'v1',
    iv.toString('base64url'),
    tag.toString('base64url'),
    ciphertext.toString('base64url'),
  ].join(':');
}

export function decryptAesGcm(value: string, key: Buffer, aad: string): string {
  if (key.length !== 32) {
    throw new Error('AES-256-GCM requires a 32-byte key');
  }
  const parts = value.split(':');
  if (parts.length !== 5 || parts[0] !== 'gcm' || parts[1] !== 'v1') {
    throw new Error('Cannot decrypt credential field: not a valid gcm:v1 ciphertext');
  }
  const iv = Buffer.from(parts[2], 'base64url');
  const tag = Buffer.from(parts[3], 'base64url');
  const ciphertext = Buffer.from(parts[4], 'base64url');
  if (iv.length !== 12 || tag.length !== 16) {
    throw new Error('Cannot decrypt credential field: malformed gcm:v1 parameters');
  }
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAAD(Buffer.from(aad, 'utf8'));
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}

/** Legacy CBC decrypt for migration only. Unauthenticated — do not use for new writes. */
export function decryptAesCbc(value: string, keyHex: string): string {
  const [ivHex, encrypted] = value.split(':');
  if (!ivHex || !encrypted) {
    throw new Error('Cannot decrypt credential field: value is not a valid encrypted string');
  }
  const iv = Buffer.from(ivHex, 'hex');
  const key = Buffer.from(keyHex, 'hex');
  if (key.length !== 32) {
    throw new Error('Cannot decrypt legacy CBC credential: key must be 32 bytes');
  }
  const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

export function encryptAesCbcLegacy(plaintext: string, keyHex: string): string {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-cbc', Buffer.from(keyHex, 'hex'), iv);
  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  return iv.toString('hex') + ':' + encrypted;
}

export function fieldAad(accountId: string, field: string): string {
  return `imap-mcp|${accountId}|${field}`;
}
