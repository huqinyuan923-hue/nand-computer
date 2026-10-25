// 性能预算测试（M6）：门级 CPU 在 Node 下 ≥ 10 万 Hack 周期/秒（jit 后端）。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runBench } from '../src/dev/bench.ts';

const BUDGET = 100_000;

test(`性能：jit 后端 ≥ ${BUDGET} 周期/秒`, () => {
  const r = runBench(300_000, 'jit');
  console.log(`    jit: ${r.cycles} 周期 / ${r.ms.toFixed(1)}ms = ${r.cyclesPerSec.toLocaleString()} 周期/秒`);
  assert.ok(r.cyclesPerSec >= BUDGET, `jit ${r.cyclesPerSec} < 预算 ${BUDGET} 周期/秒`);
});

test('性能：interp 后端参考值（不断言）', () => {
  const r = runBench(100_000, 'interp');
  console.log(`    interp: ${r.cycles} 周期 / ${r.ms.toFixed(1)}ms = ${r.cyclesPerSec.toLocaleString()} 周期/秒`);
  assert.ok(r.cyclesPerSec > 10_000, 'interp 低于 1 万周期/秒，异常');
});
