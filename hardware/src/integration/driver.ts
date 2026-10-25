// 集成驱动核心（M8）：headless 驱动门级 Computer 跑任意 .hack + 输入脚本，
// 与行为级 oracle 并行逐周期对拍，输出检查点屏幕哈希与 RAM 观测值。
// 跨轨对拍：expect 中的哈希来自软件轨 hackrun（或注明的 oracle 推导）。

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Computer } from '../chips/computer.ts';
import { HackOracle } from '../oracle/hack.ts';
import { parseHack } from '../io/hackfile.ts';
import { parseInputScript, KeyboardDriver } from '../io/input.ts';
import { screenHash } from '../io/screen.ts';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

export interface IntegrationSpec {
  name: string;
  /** 相对仓库根的 .hack 路径 */
  hack: string;
  /** 输入脚本原文（SPEC 行格式：cycle keycode） */
  script?: string;
  initRam?: Record<string, number>;
  cycles: number;
  resetCycles?: number;
  /** 输出这些周期的屏幕哈希 */
  checkpoints?: number[];
  /** 输出这些 RAM 地址的终值 */
  watch?: number[];
  /** 期望值冻结区：checkpoints=cycle→哈希，watch=addr→值 */
  expect?: {
    checkpoints?: Record<string, string>;
    watch?: Record<string, number>;
  };
}

export interface IntegrationResult {
  name: string;
  cycles: number;
  gateScreenHashes: Record<string, string>;
  oracleScreenHashes: Record<string, string>;
  watch: Record<string, number>;
  oracleDiff: { ok: boolean; firstDivergence: string | null };
  expectOk: boolean;
}

export function runIntegration(spec: IntegrationSpec): IntegrationResult {
  const hackPath = spec.hack.startsWith('/') ? spec.hack : join(REPO_ROOT, spec.hack);
  const rom = parseHack(readFileSync(hackPath, 'utf8'));
  const events = spec.script ? parseInputScript(spec.script) : [];
  const resetCycles = spec.resetCycles ?? 1;

  const gate = new Computer();
  const ref = new HackOracle();
  gate.loadRom(rom);
  ref.loadRom(rom);
  for (const [k, v] of Object.entries(spec.initRam ?? {})) {
    gate.mem.ram[Number(k) & 0x3fff] = v & 0xffff;
    ref.mem.ram[Number(k) & 0x3fff] = v & 0xffff;
  }

  const drvG = new KeyboardDriver(events);
  const drvO = new KeyboardDriver(events);
  const gateHashes: Record<string, string> = {};
  const oracleHashes: Record<string, string> = {};
  const cpSet = new Set(spec.checkpoints ?? []);
  let firstDivergence: string | null = null;

  for (let n = 0; n < spec.cycles; n++) {
    drvG.apply(n, (v) => gate.setKeyboard(v));
    drvO.apply(n, (v) => ref.setKeyboard(v));
    const reset = (n < resetCycles ? 1 : 0) as 0 | 1;
    const g = gate.step(reset);
    const o = ref.step(reset);
    if (firstDivergence === null) {
      const fields: [string, number, number][] = [
        ['pc', g.pc, o.pc], ['a', g.a, o.a], ['d', g.d, o.d],
        ['addressM', g.addressM, o.addressM], ['writeM', g.writeM, o.writeM],
      ];
      for (const [k, gv, ov] of fields) {
        if (gv !== ov) { firstDivergence = `cycle ${n} ${k}: gate=${gv} oracle=${ov}`; break; }
      }
      if (firstDivergence === null && o.outM !== null && g.outM !== o.outM) {
        firstDivergence = `cycle ${n} outM: gate=${g.outM} oracle=${o.outM}`;
      }
    }
    if (cpSet.has(n)) {
      gateHashes[String(n)] = screenHash(gate.mem.screen);
      oracleHashes[String(n)] = screenHash(ref.mem.screen);
    }
  }

  const watch: Record<string, number> = {};
  for (const addr of spec.watch ?? []) watch[String(addr)] = gate.mem.ram[addr & 0x3fff];

  let expectOk = true;
  for (const [cyc, h] of Object.entries(spec.expect?.checkpoints ?? {})) {
    if (gateHashes[cyc] !== h) expectOk = false;
  }
  for (const [addr, v] of Object.entries(spec.expect?.watch ?? {})) {
    if (watch[addr] !== v) expectOk = false;
  }

  return {
    name: spec.name,
    cycles: spec.cycles,
    gateScreenHashes: gateHashes,
    oracleScreenHashes: oracleHashes,
    watch,
    oracleDiff: { ok: firstDivergence === null, firstDivergence },
    expectOk,
  };
}
