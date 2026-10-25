// 集成驱动 CLI：npm run integ -- --spec hardware/integration/xxx.json
// 或逐项参数：--hack path --script file --cycles N --checkpoints a,b --watch a,b

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runIntegration } from '../src/integration/driver.ts';
import type { IntegrationSpec } from '../src/integration/driver.ts';

const args = process.argv.slice(2);
function arg(name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

const hardwareRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const specPath = arg('--spec');
let spec: IntegrationSpec;
if (specPath) {
  spec = JSON.parse(readFileSync(specPath.startsWith('/') ? specPath : join(hardwareRoot, specPath), 'utf8')) as IntegrationSpec;
} else {
  const hack = arg('--hack');
  if (!hack) {
    console.error('用法: --spec <json> 或 --hack <path> [--script <file>] [--cycles N] [--checkpoints a,b] [--watch a,b]');
    process.exit(2);
  }
  const scriptFile = arg('--script');
  spec = {
    name: hack,
    hack,
    script: scriptFile ? readFileSync(scriptFile, 'utf8') : undefined,
    cycles: Number(arg('--cycles') ?? 100),
    checkpoints: (arg('--checkpoints') ?? '').split(',').filter(Boolean).map(Number),
    watch: (arg('--watch') ?? '').split(',').filter(Boolean).map(Number),
  };
}

const result = runIntegration(spec);
console.log(JSON.stringify(result, null, 2));
process.exit(result.oracleDiff.ok && result.expectOk ? 0 : 1);
