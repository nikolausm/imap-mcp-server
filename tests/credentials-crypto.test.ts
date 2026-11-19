import { describe, it, expect } from 'vitest';
import crypto from 'crypto';
import {
  classifyCiphertext,
  decryptAesCbc,
  decryptAesGcm,
  encryptAesCbcLegacy,
  encryptAesGcm,
  fieldAad,
} from '../src/credentials/crypto.js';

describe('credentials/crypto', () => {
  const key = crypto.randomBytes(32);
  const keyHex = key.toString('hex');

  it('round-trips AES-256-GCM with AAD', () => {
    const aad = fieldAad('acc-1', 'password');
    const ct = encryptAesGcm('s3cret', key, aad);
    expect(ct.startsWith('gcm:v1:')).toBe(true);
    expect(classifyCiphertext(ct)).toBe('gcm-v1');
    expect(decryptAesGcm(ct, key, aad)).toBe('s3cret');
  });

  it('rejects GCM tampering and wrong AAD', () => {
    const aad = fieldAad('acc-1', 'password');
    const ct = encryptAesGcm('s3cret', key, aad);
    const tweaked = ct.slice(0, -1) + (ct.endsWith('a') ? 'b' : 'a');
    expect(() => decryptAesGcm(tweaked, key, aad)).toThrow();
    expect(() => decryptAesGcm(ct, key, fieldAad('acc-1', 'smtp.password'))).toThrow();
  });

  it('uses unique nonces', () => {
    const aad = fieldAad('a', 'password');
    const a = encryptAesGcm('x', key, aad);
    const b = encryptAesGcm('x', key, aad);
    expect(a).not.toBe(b);
  });

  it('decrypts legacy AES-CBC for migration', () => {
    const legacy = encryptAesCbcLegacy('old-secret', keyHex);
    expect(classifyCiphertext(legacy)).toBe('cbc-v0');
    expect(decryptAesCbc(legacy, keyHex)).toBe('old-secret');
  });

  it('classifies empty and unknown', () => {
    expect(classifyCiphertext('')).toBe('empty');
    expect(classifyCiphertext('not-encrypted')).toBe('unknown');
  });
});
