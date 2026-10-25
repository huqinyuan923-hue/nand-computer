// 屏幕工具：SPEC 哈希（8192 字大端展开 16384 字节 → SHA-256 小写 hex）
// 与像素映射（字地址 w=y*32+(x>>4)，像素位=15-(x&15)，MSB=最左像素，1=点亮）。

import { createHash } from 'node:crypto';

export function screenHash(words: Uint16Array): string {
  const bytes = Buffer.alloc(words.length * 2);
  for (let i = 0; i < words.length; i++) {
    bytes[i * 2] = (words[i] >>> 8) & 0xff;
    bytes[i * 2 + 1] = words[i] & 0xff;
  }
  return createHash('sha256').update(bytes).digest('hex');
}

export function setPixel(words: Uint16Array, x: number, y: number, on: boolean): void {
  const w = y * 32 + (x >> 4);
  const bit = 1 << (15 - (x & 15));
  if (on) words[w] |= bit;
  else words[w] &= ~bit & 0xffff;
}

export function getPixel(words: Uint16Array, x: number, y: number): number {
  return (words[y * 32 + (x >> 4)] >>> (15 - (x & 15))) & 1;
}
