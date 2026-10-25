// .hack 文件读写：每行一条 16 位二进制，自地址 0 递增（SPEC）。

export function parseHack(text: string): number[] {
  const out: number[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (!/^[01]{16}$/.test(line)) throw new Error(`.hack 行非法: "${line}"`);
    out.push(parseInt(line, 2));
    if (out.length > 0x8000) throw new Error('.hack 超过 32768 条指令');
  }
  return out;
}

export function toHackText(words: ArrayLike<number>): string {
  const lines: string[] = [];
  for (let i = 0; i < words.length; i++) {
    lines.push((words[i] & 0xffff).toString(2).padStart(16, '0'));
  }
  return lines.join('\n') + '\n';
}
