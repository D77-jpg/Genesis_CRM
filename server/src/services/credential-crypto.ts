import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import env from '../config/env';

interface EncryptedSecret {
  ciphertext: string;
  iv: string;
  tag: string;
}

function encryptionKey(purpose: 'mail' | 'ai' = 'mail'): Buffer {
  const source = env.MAIL_CREDENTIAL_ENCRYPTION_KEY || env.JWT_SECRET;
  return createHash('sha256').update(`genesis-${purpose}-credentials:v1:${source}`).digest();
}

function encrypt(value: string, purpose: 'mail' | 'ai'): EncryptedSecret {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(purpose), iv);
  const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return {
    ciphertext: ciphertext.toString('base64'),
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
  };
}

function decrypt(secret: EncryptedSecret, purpose: 'mail' | 'ai'): string {
  const decipher = createDecipheriv('aes-256-gcm', encryptionKey(purpose), Buffer.from(secret.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(secret.tag, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(secret.ciphertext, 'base64')),
    decipher.final(),
  ]).toString('utf8');
}

export function encryptCredential(value: string): EncryptedSecret { return encrypt(value, 'mail'); }
export function decryptCredential(secret: EncryptedSecret): string { return decrypt(secret, 'mail'); }
export function encryptAiCredential(value: string): EncryptedSecret { return encrypt(value, 'ai'); }
export function decryptAiCredential(secret: EncryptedSecret): string { return decrypt(secret, 'ai'); }
