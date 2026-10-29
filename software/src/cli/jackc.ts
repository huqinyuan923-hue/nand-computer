/**
 * jackc CLI: compile Jack source from stdin to VM code on stdout.
 * Input format: multiple classes concatenated; each introduced by `class Name { ... }`
 * (class boundaries are self-delimiting). Cross-class references resolved by a
 * two-phase pass: collect subroutine kinds + field counts, then emit.
 * Usage: node jackc.js [--name FILENAME] < all.jack
 *   --name FILENAME  base name for error reporting (default <stdin>)
 */

import { parseJackUnits } from "../jack/parser";
import { ClassDecl, Type } from "../jack/parser";
import { compileClass } from "../jack/codegen";

export interface CompileProgramResult {
  /** VM text per class, in input order */
  vms: Array<{ className: string; vm: string }>;
  errors: Array<{ line: number; msg: string }>;
}

/** Compile multiple classes with cross-class symbol resolution. */
export function compileProgram(sources: Array<{ name: string; src: string }>): CompileProgramResult {
  const errors: Array<{ line: number; msg: string }> = [];
  const classes: ClassDecl[] = [];
  for (const { name, src } of sources) {
    const res = parseJackUnits(src);
    for (const e of res.errors) errors.push({ line: e.line, msg: `${name}: ${e.msg}` });
    for (const cls of res.classes) classes.push(cls);
  }
  if (errors.length > 0) return { vms: [], errors };

  // phase 1: collect subroutine kinds, return types and field counts
  const subroutineKinds = new Map<string, "method" | "function" | "constructor">();
  const subroutineRets = new Map<string, Type>();
  const classFields = new Map<string, number>();
  for (const cls of classes) {
    let n = 0;
    for (const dec of cls.classVars) if (dec.kind === "field") n += dec.names.length;
    classFields.set(cls.name, n);
    for (const sub of cls.subroutines) {
      subroutineKinds.set(sub.name, sub.kind);
      subroutineRets.set(sub.name, sub.retType);
    }
  }
  const knownClasses = new Set(classes.map((c) => c.name));

  // phase 2: emit
  const vms: Array<{ className: string; vm: string }> = [];
  for (const cls of classes) {
    const res = compileClass(cls, { subroutineKinds, classFields, subroutineRets });
    for (const e of res.errors) errors.push({ line: e.line, msg: `${cls.name}.jack: ${e.msg}` });
    vms.push({ className: cls.name, vm: res.vm });
  }
  // validate call targets exist (cheap link check)
  for (const { vm } of vms) {
    for (const line of vm.split("\n")) {
      const m = line.match(/^call (\S+) (\d+)$/);
      if (m === null) continue;
      const fn = m[1];
      if (!subroutineKinds.has(fn)) {
        errors.push({ line: 0, msg: `call to undefined function: ${fn}` });
      }
    }
  }
  void knownClasses;
  return { vms, errors };
}

async function main(): Promise<number> {
  const args = process.argv.slice(2);
  let name = "<stdin>";
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--name") name = args[++i];
    else { process.stderr.write(`unknown option: ${args[i]}\n`); return 2; }
  }
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  const src = Buffer.concat(chunks).toString("utf8").replace(/^\uFEFF/, "");
  const res = compileProgram([{ name, src }]);
  if (res.errors.length > 0) {
    for (const e of res.errors) process.stderr.write(`${name}:${e.line}: error: ${e.msg}\n`);
    return 1;
  }
  for (const { vm } of res.vms) process.stdout.write(vm);
  if (res.vms.length > 1) {
    process.stderr.write(
      `${name}: warning: ${res.vms.length} classes in one VM stream share the module's static space; translate each class separately\n`,
    );
  }
  return 0;
}

if (require.main === module) {
  void main().then(
    (code) => process.exit(code),
    (err) => {
      process.stderr.write(`error: ${(err as Error).message}\n`);
      process.exit(1);
    },
  );
}
