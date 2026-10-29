/**
 * VM -> Hack assembly translator (standard stack VM code generation).
 *
 * Segment mapping: local/argument/this/that -> LCL/ARG/THIS/THAT base registers,
 * temp -> RAM 5..12, pointer 0/1 -> THIS/THAT, static -> assembler-allocated
 * variables named <module>.<i> (RAM 16+, first-come order per assembly).
 *
 * All emitted labels are prefixed with the module name so multi-module programs
 * never collide. Labels are unique via a global counter.
 */

import { VmCommand } from "./parse";
import { parseVm } from "./parse";

export interface TranslateOptions {
  module: string; // module name for statics and label prefixes
  bootstrap?: boolean; // emit SP=256 + call Sys.init (full-program builds)
}

const SEG_BASE: Record<string, string> = {
  local: "LCL", argument: "ARG", this: "THIS", that: "THAT",
};

export function translateVm(commands: VmCommand[], opts: TranslateOptions): string {
  const out: string[] = [];
  let labelCounter = 0;
  let currentFunc: string | null = null;
  const mod = opts.module;

  const emit = (...lines: string[]): void => {
    out.push(...lines);
  };
  const fresh = (tag: string): string => `${mod}$${tag}.${labelCounter++}`;
  // VM labels are function-scoped; top-level (pre-function) labels use the module.
  const labelSym = (name: string): string => `${currentFunc ?? mod}$${name}`;

  if (opts.bootstrap) {
    // full call frame so Sys.init may return; returning lands in the halt loop
    emit(
      "@256", "D=A", "@SP", "M=D",
      // push return address
      "@BOOT$HALT", "D=A", "@SP", "M=M+1", "A=M-1", "M=D",
      // push LCL, ARG, THIS, THAT
      "@LCL", "D=M", "@SP", "M=M+1", "A=M-1", "M=D",
      "@ARG", "D=M", "@SP", "M=M+1", "A=M-1", "M=D",
      "@THIS", "D=M", "@SP", "M=M+1", "A=M-1", "M=D",
      "@THAT", "D=M", "@SP", "M=M+1", "A=M-1", "M=D",
      // ARG = SP - 5, LCL = SP
      "@SP", "D=M", "@5", "D=D-A", "@ARG", "M=D",
      "@SP", "D=M", "@LCL", "M=D",
      // goto Sys.init (fixed entry class, global name)
      "@Sys.init", "0;JMP",
      "(BOOT$HALT)",
      "@BOOT$HALT", "0;JMP",
    );
  }

  for (let ci = 0; ci < commands.length; ci++) {
    const cmd = commands[ci];
    // peephole: push <seg> i ; push constant K ; add ; pop pointer 1
    // -> THAT = <seg>[i] + K computed directly (6 asm instead of ~24)
    const opt = tryOptArrayAddr(commands, ci, mod);
    if (opt !== null) {
      emit(...opt.lines);
      ci += opt.consumed - 1;
      continue;
    }
    // peephole: the address pattern followed by push constant V ; pop that 0
    // -> direct store of V at <seg>[i]+K without touching THAT's stack traffic
    const optStore = tryOptArrayStore(commands, ci, mod);
    if (optStore !== null) {
      emit(...optStore.lines);
      ci += optStore.consumed - 1;
      continue;
    }
    // peephole: variable-index array READ via pointer 1
    const optRead = tryOptArrayRead(commands, ci, mod);
    if (optRead !== null) {
      emit(...optRead.lines);
      ci += optRead.consumed - 1;
      continue;
    }
    // peephole: method prologue push argument 0; pop pointer 0 -> THIS = *ARG
    if (
      cmd.type === "push" && cmd.arg1 === "argument" && cmd.arg2 === 0 &&
      commands[ci + 1] !== undefined && commands[ci + 1].type === "pop" &&
      commands[ci + 1].arg1 === "pointer" && commands[ci + 1].arg2 === 0
    ) {
      emit("@ARG", "D=M", "@0", "A=D+A", "D=M", "@THIS", "M=D");
      ci += 1;
      continue;
    }
    switch (cmd.type) {
      case "push":
        emitPush(cmd, mod);
        break;
      case "pop":
        emitPop(cmd, mod);
        break;
      case "add": case "sub": case "and": case "or": {
        // binary: pop y into D, x is the new top; result replaces x.
        // comp mnemonics require D on the left (D+M, M-D, D&M, D|M).
        emit(
          "@SP", "AM=M-1", "D=M", // y -> D
          "@SP", "A=M-1", // top now x
        );
        const op = cmd.type === "add" ? "D+M" : cmd.type === "sub" ? "M-D" : cmd.type === "and" ? "D&M" : "D|M";
        emit(`M=${op}`);
        break;
      }
      case "neg": {
        emit("@SP", "A=M-1", "M=-M");
        break;
      }
      case "not": {
        emit("@SP", "A=M-1", "M=!M");
        break;
      }
      case "eq": case "gt": case "lt": {
        // Reference semantics: signed test on the wrapped 16-bit x-y, like the
        // nand2tetris translator. For opposite-sign operands whose difference
        // overflows (|x-y| >= 32768) gt/lt disagree with mathematical x>y.
        // An overflow-safe sequence costs ~14 extra words per site; Tetris has
        // 76 comparisons and only ~200 words of ROM headroom, so the compact
        // form is deliberate. test/vm.test.ts pins the behaviour.
        const labelTrue = fresh(cmd.type.toUpperCase());
        const labelEnd = fresh(cmd.type.toUpperCase() + ".END");
        const jump = cmd.type === "eq" ? "JEQ" : cmd.type === "gt" ? "JGT" : "JLT";
        emit(
          "@SP", "AM=M-1", "D=M", // y -> D
          "@SP", "A=M-1", "D=M-D", // x - y
          `@${labelTrue}`, `D;${jump}`,
          "@SP", "A=M-1", "M=0",
          `@${labelEnd}`, "0;JMP",
          `(${labelTrue})`,
          "@SP", "A=M-1", "M=-1",
          `(${labelEnd})`,
        );
        break;
      }
      case "label":
        emit(`(${labelSym(cmd.arg1!)})`);
        break;
      case "goto":
        emit(`@${labelSym(cmd.arg1!)}`, "0;JMP");
        break;
      case "if-goto":
        emit("@SP", "AM=M-1", "D=M", `@${labelSym(cmd.arg1!)}`, "D;JNE");
        break;
      case "function": {
        currentFunc = cmd.arg1!;
        // function names are fully qualified (Class.sub) and global — no prefix.
        // Locals init via push constant 0 (4 words each with the short form,
        // and it advances SP past the locals — the direct-store form would not).
        emit(`(${cmd.arg1})`);
        for (let i = 0; i < (cmd.arg2 ?? 0); i++) {
          emitPush({ type: "push", arg1: "constant", arg2: 0, line: cmd.line }, mod);
        }
        break;
      }
      case "call": {
        const ret = fresh(`${cmd.arg1}.ret`);
        // push return address, LCL, ARG, THIS, THAT
        emit(`@${ret}`, "D=A", "@SP", "M=M+1", "A=M-1", "M=D");
        for (const base of ["LCL", "ARG", "THIS", "THAT"]) {
          emit(`@${base}`, "D=M", "@SP", "M=M+1", "A=M-1", "M=D");
        }
        // ARG = SP - (nargs + 5), LCL = SP
        emit(
          "@SP", "D=M", `@${(cmd.arg2 ?? 0) + 5}`, "D=D-A", "@ARG", "M=D",
          "@SP", "D=M", "@LCL", "M=D",
          // goto f (global function name)
          `@${cmd.arg1}`, "0;JMP",
          `(${ret})`,
        );
        break;
      }
      case "return": {
        emit(
          // FRAME(R13) = LCL; RET(R14) = *(FRAME-5)
          "@LCL", "D=M", "@R13", "M=D",
          "@5", "A=D-A", "D=M", "@R14", "M=D",
          // *ARG = pop()
          "@SP", "AM=M-1", "D=M", "@ARG", "A=M", "M=D",
          // SP = ARG+1
          "@ARG", "D=M", "@SP", "M=D+1",
          // restore THAT, THIS, ARG, LCL
          ...["THAT", "THIS", "ARG", "LCL"].flatMap((base, i) => [
            "@R13", "D=M", `@${i + 1}`, "A=D-A", "D=M", `@${base}`, "M=D",
          ]),
          // goto RET
          "@R14", "A=M", "0;JMP",
        );
        break;
      }
    }
  }

  return out.join("\n") + "\n";

  /** Recognize `push <seg> i; push constant K; add; pop pointer 1` (array address). */
  function tryOptArrayAddr(
    cmds: VmCommand[],
    i: number,
    modName: string,
  ): { lines: string[]; consumed: number } | null {
    const c0 = cmds[i];
    const c1 = cmds[i + 1];
    const c2 = cmds[i + 2];
    const c3 = cmds[i + 3];
    if (
      c0 === undefined || c1 === undefined || c2 === undefined || c3 === undefined ||
      c0.type !== "push" || c0.arg1 === undefined ||
      c0.arg1 === "constant" ||
      c1.type !== "push" || c1.arg1 !== "constant" ||
      c2.type !== "add" ||
      c3.type !== "pop" || c3.arg1 !== "pointer" || c3.arg2 !== 1
    ) {
      return null;
    }
    const K = c1.arg2!;
    const seg = c0.arg1;
    const idx = c0.arg2!;
    let lines: string[];
    if (seg in SEG_BASE) {
      // push seg i yields RAM[BASE + i] (a stored pointer); THAT = ptr + K
      lines = [`@${SEG_BASE[seg]}`, "D=M", `@${idx}`, "A=D+A", "D=M", `@${K}`, "D=D+A", "@THAT", "M=D"];
    } else if (seg === "temp") {
      // temp/static/pointer push the raw content at a fixed address
      lines = [`@${5 + idx}`, "D=M", `@${K}`, "D=D+A", "@THAT", "M=D"];
    } else if (seg === "pointer") {
      lines = [`@${idx === 0 ? "THIS" : "THAT"}`, "D=M", `@${K}`, "D=D+A", "@THAT", "M=D"];
    } else {
      lines = [`@${modName}.${idx}`, "D=M", `@${K}`, "D=D+A", "@THAT", "M=D"];
    }
    return { lines, consumed: 4 };
  }

  /** Recognize the address pattern + `push constant V; pop that 0` (const store). */
  function tryOptArrayStore(
    cmds: VmCommand[],
    i: number,
    modName: string,
  ): { lines: string[]; consumed: number } | null {
    const addr = tryOptArrayAddr(cmds, i, modName);
    if (addr === null) return null;
    const c4 = cmds[i + 4];
    const c5 = cmds[i + 5];
    if (
      c4 === undefined || c5 === undefined ||
      c4.type !== "push" || c4.arg1 !== "constant" ||
      c5.type !== "pop" || c5.arg1 !== "that" || c5.arg2 !== 0
    ) {
      return null;
    }
    const K = cmds[i + 1].arg2!;
    const V = c4.arg2!;
    const seg = cmds[i].arg1!;
    const idx = cmds[i].arg2!;
    let head: string[];
    if (seg in SEG_BASE) {
      head = [`@${SEG_BASE[seg]}`, "D=M", `@${idx}`, "A=D+A", "D=M", `@${K}`, "D=D+A"];
    } else if (seg === "temp") {
      head = [`@${5 + idx}`, "D=M", `@${K}`, "D=D+A"];
    } else if (seg === "pointer") {
      head = [`@${idx === 0 ? "THIS" : "THAT"}`, "D=M", `@${K}`, "D=D+A"];
    } else {
      head = [`@${modName}.${idx}`, "D=M", `@${K}`, "D=D+A"];
    }
    const lines = [
      ...head, "@R13", "M=D",
      `@${V}`, "D=A", "@SP", "M=M+1", "A=M-1", "M=D",
      "@SP", "AM=M-1", "D=M", "@R13", "A=M", "M=D",
    ];
    return { lines, consumed: 6 };
  }

  /** Lines that leave D = value of `push <seg> <idx>` for any segment. */
  function loadSegValue(seg: string, idx: number, modName: string): string[] {
    if (seg in SEG_BASE) {
      return [`@${SEG_BASE[seg]}`, "D=M", `@${idx}`, "A=D+A", "D=M"];
    }
    if (seg === "temp") return [`@${5 + idx}`, "D=M"];
    if (seg === "pointer") return [`@${idx === 0 ? "THIS" : "THAT"}`, "D=M"];
    return [`@${modName}.${idx}`, "D=M"];
  }

  /**
   * Recognize `push A i; push B j; add; pop pointer 1; push that 0`
   * (variable-index array read) and load the value directly.
   */
  function tryOptArrayRead(
    cmds: VmCommand[],
    i: number,
    modName: string,
  ): { lines: string[]; consumed: number } | null {
    const c0 = cmds[i], c1 = cmds[i + 1], c2 = cmds[i + 2], c3 = cmds[i + 3], c4 = cmds[i + 4];
    if (
      c0 === undefined || c1 === undefined || c2 === undefined || c3 === undefined || c4 === undefined ||
      c0.type !== "push" || c0.arg1 === undefined || c0.arg1 === "constant" ||
      c1.type !== "push" || c1.arg1 === undefined || c1.arg1 === "constant" ||
      c2.type !== "add" ||
      c3.type !== "pop" || c3.arg1 !== "pointer" || c3.arg2 !== 1 ||
      c4.type !== "push" || c4.arg1 !== "that" || c4.arg2 !== 0
    ) {
      return null;
    }
    const lines = [
      ...loadSegValue(c0.arg1, c0.arg2!, modName),
      "@R13", "M=D",
      ...loadSegValue(c1.arg1, c1.arg2!, modName),
      "@R13", "D=D+M",
      // The elided `pop pointer 1` must still set THAT (observable by later pushes).
      "@THAT", "M=D",
      "A=D", "D=M",
      "@SP", "M=M+1", "A=M-1", "M=D",
    ];
    return { lines, consumed: 5 };
  }

  function emitPush(cmd: VmCommand, modName: string): void {
    const seg = cmd.arg1!;
    const idx = cmd.arg2!;
    if (seg === "constant") {
      if (idx > 0x7fff) {
        throw new Error(`constant too large at line ${cmd.line}: ${idx}`);
      }
      if (idx === 0 || idx === 1) {
        // comp "0"/"1" short form
        emit("@SP", "M=M+1", "A=M-1", `M=${idx}`);
      } else {
        emit(`@${idx}`, "D=A", "@SP", "M=M+1", "A=M-1", "M=D");
      }
    } else if (seg in SEG_BASE) {
      emit(
        `@${SEG_BASE[seg]}`, "D=M", `@${idx}`, "A=D+A", "D=M",
        "@SP", "M=M+1", "A=M-1", "M=D",
      );
    } else if (seg === "temp") {
      emit(`@${5 + idx}`, "D=M", "@SP", "M=M+1", "A=M-1", "M=D");
    } else if (seg === "pointer") {
      emit(`@${idx === 0 ? "THIS" : "THAT"}`, "D=M", "@SP", "M=M+1", "A=M-1", "M=D");
    } else {
      // static
      emit(`@${modName}.${idx}`, "D=M", "@SP", "M=M+1", "A=M-1", "M=D");
    }
  }

  function emitPop(cmd: VmCommand, modName: string): void {
    const seg = cmd.arg1!;
    const idx = cmd.arg2!;
    // `AM=M-1` writes the decremented SP back to RAM[0] (M targets the *old* A)
    // and leaves A = top, so the pop head costs 3 words instead of 4.
    if (seg in SEG_BASE) {
      emit(
        // addr (R13) = base + idx
        `@${SEG_BASE[seg]}`, "D=M", `@${idx}`, "D=D+A", "@R13", "M=D",
        // *SP-- -> *addr
        "@SP", "AM=M-1", "D=M", "@R13", "A=M", "M=D",
      );
    } else if (seg === "temp") {
      emit("@SP", "AM=M-1", "D=M", `@${5 + idx}`, "M=D");
    } else if (seg === "pointer") {
      emit("@SP", "AM=M-1", "D=M", `@${idx === 0 ? "THIS" : "THAT"}`, "M=D");
    } else {
      emit("@SP", "AM=M-1", "D=M", `@${modName}.${idx}`, "M=D");
    }
  }
}

/** Convenience: parse+translate a whole VM source file to assembly text. */
export function translateVmSource(src: string, opts: TranslateOptions): {
  asm: string;
  errors: Array<{ line: number; msg: string }>;
} {
  const { commands, errors } = parseVm(src);
  if (errors.length > 0) return { asm: "", errors };
  return { asm: translateVm(commands, opts), errors: [] };
}
