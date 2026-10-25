// M8 集成测试：软件轨汇编产物 + 硬件 demo 在门级计算机上的 headless 端到端。
// 门级 vs oracle 逐周期对拍 + 冻结期望（哈希/观测值）校验。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runIntegration } from '../src/integration/driver.ts';
import type { IntegrationSpec } from '../src/integration/driver.ts';

const specFile = join(dirname(fileURLToPath(import.meta.url)), '..', 'integration', 'software-asm.json');
const suite = JSON.parse(readFileSync(specFile, 'utf8')) as { cases: IntegrationSpec[] };

for (const spec of suite.cases) {
  test(`集成: ${spec.name}（门级 vs oracle + 冻结期望）`, () => {
    const r = runIntegration(spec);
    assert.equal(r.oracleDiff.ok, true, `oracle 对拍分歧: ${r.oracleDiff.firstDivergence}`);
    assert.equal(r.expectOk, true, `冻结期望不匹配: watch=${JSON.stringify(r.watch)} hashes=${JSON.stringify(r.gateScreenHashes)}`);
    for (const [cyc, h] of Object.entries(r.gateScreenHashes)) {
      assert.equal(r.oracleScreenHashes[cyc], h, `检查点 ${cyc} 门级/oracle 哈希不一致`);
    }
  });
}
