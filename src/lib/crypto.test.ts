import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * 加密模块的测试。
 * 主密钥文件会写到 NYMPH_DATA_DIR 指定的目录，
 * 因此这里先指向一个临时目录，避免污染项目数据。
 */
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nymph-crypto-'));
process.env.NYMPH_DATA_DIR = tempDir;

const { decryptSecret, encryptSecret, maskSecret, shortId } = await import('./crypto');

describe('API Key 加密存储', () => {
  it('加密后可正确解密', () => {
    const secret = 'sk-1234567890abcdefghijklmn';
    const encrypted = encryptSecret(secret);
    expect(encrypted).not.toContain(secret);
    expect(encrypted.startsWith('v1:')).toBe(true);
    expect(decryptSecret(encrypted)).toBe(secret);
  });

  it('相同明文每次加密结果不同，避免密文比对泄露信息', () => {
    const secret = 'sk-sameinput';
    expect(encryptSecret(secret)).not.toBe(encryptSecret(secret));
  });

  it('密文被篡改时解密失败，触发完整性校验', () => {
    const encrypted = encryptSecret('sk-tamper-check');
    const parts = encrypted.split(':');
    const tampered = `${parts[0]}:${parts[1]}:${parts[2]}:${Buffer.from('tampered').toString('base64')}`;
    expect(() => decryptSecret(tampered)).toThrow();
  });

  it('空字符串不产生密文', () => {
    expect(encryptSecret('')).toBe('');
    expect(decryptSecret('')).toBe('');
  });

  it('不受支持的密文格式会被拒绝', () => {
    expect(() => decryptSecret('v2:aa:bb:cc')).toThrow();
  });

  it('主密钥写入本地且长度固定为三十二字节', () => {
    encryptSecret('触发生成主密钥');
    const keyFile = path.join(tempDir, 'master.key');
    expect(fs.existsSync(keyFile)).toBe(true);
    expect(fs.readFileSync(keyFile).length).toBe(32);
  });
});

describe('maskSecret', () => {
  it('仅保留首尾各四位，中间以圆点替代', () => {
    const masked = maskSecret('sk-1234567890abcdef');
    expect(masked.startsWith('sk-1')).toBe(true);
    expect(masked.endsWith('cdef')).toBe(true);
    expect(masked).not.toContain('567890');
  });

  it('短密钥全部遮蔽', () => {
    expect(maskSecret('short')).toBe('•••••');
  });

  it('空值返回空字符串', () => {
    expect(maskSecret('')).toBe('');
  });
});

describe('shortId', () => {
  it('带前缀且各次生成互不相同', () => {
    const first = shortId('nv');
    const second = shortId('nv');
    expect(first.startsWith('nv_')).toBe(true);
    expect(first).not.toBe(second);
  });
});
