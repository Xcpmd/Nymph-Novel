import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { MASTER_KEY_FILE } from './paths';

/**
 * 本地主密钥管理。
 * 主密钥为 32 字节随机数，保存在 data/master.key，权限位 0600。
 * 主密钥只在本机存在，不参与任何网络传输，因此 API Key 无法被离线解密。
 */
let cachedKey: Buffer | null = null;

function loadMasterKey(): Buffer {
  if (cachedKey) return cachedKey;

  if (fs.existsSync(MASTER_KEY_FILE)) {
    const raw = fs.readFileSync(MASTER_KEY_FILE);
    if (raw.length !== 32) {
      throw new Error('主密钥文件已损坏，长度不是 32 字节');
    }
    cachedKey = raw;
    return cachedKey;
  }

  fs.mkdirSync(path.dirname(MASTER_KEY_FILE), { recursive: true });
  const key = crypto.randomBytes(32);
  fs.writeFileSync(MASTER_KEY_FILE, key, { mode: 0o600 });
  cachedKey = key;
  return cachedKey;
}

const SECRET_PREFIX = 'v1';

/**
 * 使用 AES-256-GCM 加密敏感字符串，同时提供机密性与完整性校验。
 * 输出格式：v1:iv(base64):authTag(base64):ciphertext(base64)
 */
export function encryptSecret(plain: string): string {
  if (!plain) return '';
  const key = loadMasterKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    SECRET_PREFIX,
    iv.toString('base64'),
    tag.toString('base64'),
    ciphertext.toString('base64'),
  ].join(':');
}

/** 解密由 encryptSecret 生成的密文。密文被篡改时抛出异常。 */
export function decryptSecret(payload: string): string {
  if (!payload) return '';
  const parts = payload.split(':');
  if (parts.length !== 4 || parts[0] !== SECRET_PREFIX) {
    throw new Error('密文格式不受支持');
  }
  const [, ivB64, tagB64, ctB64] = parts;
  const key = loadMasterKey();
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(ctB64, 'base64')),
    decipher.final(),
  ]).toString('utf8');
}

/** 生成用于界面展示的掩码，避免明文 API Key 出现在页面上。 */
export function maskSecret(plain: string): string {
  if (!plain) return '';
  if (plain.length <= 8) return '•'.repeat(plain.length);
  return `${plain.slice(0, 4)}${'•'.repeat(Math.min(12, plain.length - 8))}${plain.slice(-4)}`;
}

/** 生成短随机标识，用作各类实体的主键前缀。 */
export function shortId(prefix: string): string {
  return `${prefix}_${crypto.randomBytes(8).toString('hex')}`;
}

/** 供测试重置内存中的主密钥缓存。 */
export function __resetMasterKeyCache(): void {
  cachedKey = null;
}
