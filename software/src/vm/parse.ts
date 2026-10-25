/**
 * VM command parser (stack VM per the standard Nand2Tetris VM language).
 * Commands: push/pop <segment> <i>, arithmetic/logical, label/goto/if-goto,
 * function/call/return. Comments (// ...) and blank lines ignored.
 */

export type VmCmdType =
  | "push" | "pop"
  | "add" | "sub" | "neg" | "eq" | "gt" | "lt" | "and" | "or" | "not"
  | "label" | "goto" | "if-goto"
  | "function" | "call" | "return";

export interface VmCommand {
  type: VmCmdType;
  arg1?: string; // segment, label name, or function name
  arg2?: number; // index or count
  line: number; // 1-based source line
}

const ARITH: Set<string> = new Set(["add", "sub", "neg", "eq", "gt", "lt", "and", "or", "not"]);
const SEGMENTS = new Set([
  "constant", "local", "argument", "this", "that", "temp", "pointer", "static",
]);

export interface VmParseError {
  line: number;
  msg: string;
}

export function parseVm(src: string): { commands: VmCommand[]; errors: VmParseError[] } {
  const commands: VmCommand[] = [];
  const errors: VmParseError[] = [];
  const rawLines = src.split(/\r?\n/);
  for (let i = 0; i < rawLines.length; i++) {
    const text = rawLines[i].split("//")[0].trim();
    if (text.length === 0) continue;
    const line = i + 1;
    const parts = text.split(/\s+/);
    const op = parts[0];
    if (op === "push" || op === "pop") {
      if (parts.length !== 3) {
        errors.push({ line, msg: `${op} expects segment and index` });
        continue;
      }
      const seg = parts[1];
      if (!SEGMENTS.has(seg)) {
        errors.push({ line, msg: `unknown segment: ${seg}` });
        continue;
      }
      if (!/^\d+$/.test(parts[2])) {
        errors.push({ line, msg: `index must be a non-negative integer: ${parts[2]}` });
        continue;
      }
      const idx = parseInt(parts[2], 10);
      if (seg === "constant" && op === "pop") {
        errors.push({ line, msg: "pop constant is invalid" });
        continue;
      }
      if (seg === "pointer" && idx > 1) {
        errors.push({ line, msg: "pointer index must be 0 or 1" });
        continue;
      }
      if (seg === "temp" && idx > 7) {
        errors.push({ line, msg: "temp index must be 0..7" });
        continue;
      }
      commands.push({ type: op, arg1: seg, arg2: idx, line });
    } else if (ARITH.has(op)) {
      commands.push({ type: op as VmCmdType, line });
    } else if (op === "label" || op === "goto" || op === "if-goto") {
      if (parts.length !== 2) {
        errors.push({ line, msg: `${op} expects a label name` });
        continue;
      }
      commands.push({ type: op, arg1: parts[1], line });
    } else if (op === "function" || op === "call") {
      if (parts.length !== 3 || !/^[A-Za-z_.$:][\w.$:]*$/.test(parts[1]) || !/^\d+$/.test(parts[2])) {
        errors.push({ line, msg: `${op} expects function name and count` });
        continue;
      }
      commands.push({ type: op, arg1: parts[1], arg2: parseInt(parts[2], 10), line });
    } else if (op === "return") {
      commands.push({ type: "return", line });
    } else {
      errors.push({ line, msg: `unknown command: ${op}` });
    }
  }
  return { commands, errors };
}
