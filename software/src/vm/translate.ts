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
  const mod = opts.module;

  const emit = (...lines: string[]): void => {
    out.push(...lines);
  };
  const fresh = (tag: string): string => `${mod}$${tag}.${labelCounter++}`;

  if (opts.bootstrap) {
    // entry point is the module-prefixed label, matching function emission below
    emit(
      "@256", "D=A", "@SP", "M=D",
      `@${mod}$Sys.init`, "0;JMP",
    );
  }

  for (const cmd of commands) {
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
          "@SP", "M=M-1", "A=M", "D=M", // y -> D
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
        const labelTrue = fresh(cmd.type.toUpperCase());
        const labelEnd = fresh(cmd.type.toUpperCase() + ".END");
        const jump = cmd.type === "eq" ? "JEQ" : cmd.type === "gt" ? "JGT" : "JLT";
        emit(
          "@SP", "M=M-1", "A=M", "D=M", // y -> D
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
        emit(`(${mod}$${cmd.arg1})`);
        break;
      case "goto":
        emit(`@${mod}$${cmd.arg1}`, "0;JMP");
        break;
      case "if-goto":
        emit("@SP", "M=M-1", "A=M", "D=M", `@${mod}$${cmd.arg1}`, "D;JNE");
        break;
      case "function": {
        emit(`(${mod}$${cmd.arg1})`);
        for (let i = 0; i < (cmd.arg2 ?? 0); i++) {
          emit("@SP", "M=M+1", "A=M-1", "M=0");
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
        // ARG = SP - nargs - 5
        emit(
          "@SP", "D=M", `@${cmd.arg2}`, "D=D-A", "@5", "D=D-A", "@ARG", "M=D",
          // LCL = SP
          "@SP", "D=M", "@LCL", "M=D",
          // goto f
          `@${mod}$${cmd.arg1}`, "0;JMP",
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
          "@SP", "M=M-1", "A=M", "D=M", "@ARG", "A=M", "M=D",
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

  function emitPush(cmd: VmCommand, modName: string): void {
    const seg = cmd.arg1!;
    const idx = cmd.arg2!;
    if (seg === "constant") {
      if (idx > 0x7fff) {
        throw new Error(`constant too large at line ${cmd.line}: ${idx}`);
      }
      emit(`@${idx}`, "D=A", "@SP", "M=M+1", "A=M-1", "M=D");
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
    if (seg in SEG_BASE) {
      emit(
        // addr (R13) = base + idx
        `@${SEG_BASE[seg]}`, "D=M", `@${idx}`, "D=D+A", "@R13", "M=D",
        // *SP-- -> *addr
        "@SP", "M=M-1", "A=M", "D=M", "@R13", "A=M", "M=D",
      );
    } else if (seg === "temp") {
      emit("@SP", "M=M-1", "A=M", "D=M", `@${5 + idx}`, "M=D");
    } else if (seg === "pointer") {
      emit("@SP", "M=M-1", "A=M", "D=M", `@${idx === 0 ? "THIS" : "THAT"}`, "M=D");
    } else {
      emit("@SP", "M=M-1", "A=M", "D=M", `@${modName}.${idx}`, "M=D");
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
