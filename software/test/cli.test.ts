import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import * as path from "node:path";

const HACKRUN = path.join(__dirname, "../src/cli/hackrun.js");
const HACKASM = path.join(__dirname, "../src/cli/hackasm.js");

test("hackrun --dump reports per-checkpoint RAM, not final RAM", () => {
  const prog = ["@1", "D=A", "@2", "M=D", "@3", "M=D", "(H)", "@H", "0;JMP"].join("\n");
  const hack = execFileSync(process.execPath, [HACKASM], {
    input: "\uFEFF" + prog + "\n",
    encoding: "utf8",
  });
  const stdout = execFileSync(process.execPath, [
    HACKRUN, "--until", "5", "--checkpoints", "0,3", "--dump", "ram",
  ], { input: hack, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
  const res = JSON.parse(stdout) as {
    checkpoints: Array<{ cycle: number; ram: string[] }>;
  };
  assert.equal(res.checkpoints.length, 2);
  const cp0 = res.checkpoints[0];
  const cp3 = res.checkpoints[1];
  assert.equal(cp0.ram.length, 0x4000);
  assert.equal(cp0.ram[2], "0000000000000000");
  assert.equal(cp3.ram[2], "0000000000000001", "RAM[2]=1 after cycle 3");
  assert.equal(cp3.ram[3], "0000000000000000", "RAM[3] is still 0 at cycle 3");
});
