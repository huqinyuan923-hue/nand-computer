// 性能基准 CLI：npm run perf

import { runBench } from '../src/dev/bench.ts';

const N = process.argv[2] ? parseInt(process.argv[2], 10) : 500_000;
for (const backend of ['jit', 'interp'] as const) {
  const r = runBench(N, backend);
  console.log(`${backend.padEnd(7)} ${r.cycles} 周期 / ${r.ms.toFixed(1)}ms = ${r.cyclesPerSec.toLocaleString()} 周期/秒`);
}
