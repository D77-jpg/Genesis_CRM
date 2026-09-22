import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import env from '../config/env';

interface EncryptedSecret {
  ciphertext: string;
  iv: string;
  tag: string;
}

function encryptionKey(): Buffer {
  const source = env.MAIL_CREDENTIAL_ENCRYPTION_KEY || env.JWT_SECRET;
  return createHash('sha256').update(`genesis-mail-credentials:v1:${source}`).digest();
}

export function encryptCredential(value: string): EncryptedSecret {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return {
    ciphertext: ciphertext.toString('base64'),
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
  };
}

export function decryptCredential(secret: EncryptedSecret): string {
  const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(secret.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(secret.tag, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(secret.ciphertext, 'base64')),
    decipher.final(),
  ]).toString('utf8');
}
