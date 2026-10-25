// 自动发现 golden/*.json，双后端各跑一遍。

import { test } from 'node:test';
import { readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runGoldenFile } from './harness.ts';

const goldenDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'golden');

for (const f of readdirSync(goldenDir).filter((n) => n.endsWith('.json')).sort()) {
  const p = join(goldenDir, f);
  test(`golden ${f} [interp]`, () => runGoldenFile(p, 'interp'));
  test(`golden ${f} [jit]`, () => runGoldenFile(p, 'jit'));
}
