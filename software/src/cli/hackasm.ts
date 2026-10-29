/**
 * hackasm CLI: assemble Hack assembly from stdin, emit .hack text to stdout.
 * Usage: node hackasm.js < in.asm > out.hack
 * (All CLIs in this project are pipe-based: no filesystem access, no path handling.)
 */

import { assemble, wordsToHack } from "../hack/asm";

async function main(): Promise<number> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  const src = Buffer.concat(chunks).toString("utf8").replace(/^\uFEFF/, "");
  const result = assemble(src);
  if (result.errors.length > 0) {
    for (const e of result.errors) {
      process.stderr.write(`<stdin>:${e.line}: error: ${e.msg}\n`);
    }
    return 1;
  }
  process.stdout.write(wordsToHack(result.words));
  return 0;
}

void main().then((code) => process.exit(code));
