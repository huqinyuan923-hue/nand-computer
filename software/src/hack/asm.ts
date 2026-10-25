/**
 * Hack assembler (SPEC contract).
 * Two passes: pass 1 collects label ROM addresses; pass 2 emits 16-bit words.
 * Predefined symbols, labels and variables (RAM 16..) per standard Hack rules.
 */

export const SCREEN = 0x4000;
export const KBD = 0x6000;

export interface AsmError {
  line: number; // 1-based source line
  msg: string;
}

export interface AssembleResult {
  words: Uint16Array;
  errors: AsmError[];
}

const PREDEFINED: Record<string, number> = {
  R0: 0, R1: 1, R2: 2, R3: 3, R4: 4, R5: 5, R6: 6, R7: 7,
  R8: 8, R9: 9, R10: 10, R11: 11, R12: 12, R13: 13, R14: 14, R15: 15,
  SP: 0, LCL: 1, ARG: 2, THIS: 3, THAT: 4, SCREEN: 0x4000, KBD: 0x6000,
};

// comp field encodings, a=0 (A register) and a=1 (M). Standard Hack spec.
const COMP_A0: Record<string, number> = {
  "0": 0b101010, "1": 0b111111, "-1": 0b111010, D: 0b001100, A: 0b110000,
  "!D": 0b001101, "!A": 0b110001, "-D": 0b001111, "-A": 0b110011,
  "D+1": 0b011111, "A+1": 0b110111, "D-1": 0b001110, "A-1": 0b110010,
  "D+A": 0b000010, "D-A": 0b010011, "A-D": 0b000111, "D&A": 0b000000, "D|A": 0b010101,
};
const COMP_A1: Record<string, number> = {
  M: 0b110000, "!M": 0b110001, "-M": 0b110011, "M+1": 0b110111, "M-1": 0b110010,
  "D+M": 0b000010, "D-M": 0b010011, "M-D": 0b000111, "D&M": 0b000000, "D|M": 0b010101,
};

// dest bits: d1=A (bit5), d2=D (bit4), d3=M (bit3)
const DEST_BIT: Record<string, number> = { A: 0b100, D: 0b010, M: 0b001 };

const JUMP: Record<string, number> = {
  JGT: 0b001, JEQ: 0b010, JLT: 0b011, JGE: 0b100, JNE: 0b101, JLE: 0b110, JMP: 0b111,
};

const IDENT_RE = /^[A-Za-z_.$:][A-Za-z0-9_.$:]*$/;

function stripComment(line: string): string {
  const idx = line.indexOf("//");
  const code = idx >= 0 ? line.slice(0, idx) : line;
  return code.trim();
}

/** Assemble Hack assembly source into machine words. Collects all errors. */
export function assemble(src: string): AssembleResult {
  const errors: AsmError[] = [];
  const lines: string[] = [];
  const lineNos: number[] = [];
  {
    const raw = src.split(/\r?\n/);
    for (let i = 0; i < raw.length; i++) {
      const t = stripComment(raw[i]);
      if (t.length > 0) {
        lines.push(t);
        lineNos.push(i + 1);
      }
    }
  }

  // ---- pass 1: labels ----
  const labels: Record<string, number> = {};
  let romAddr = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith("(")) {
      if (!line.endsWith(")")) {
        errors.push({ line: lineNos[i], msg: `malformed label: ${line}` });
        continue;
      }
      const name = line.slice(1, -1);
      if (!IDENT_RE.test(name)) {
        errors.push({ line: lineNos[i], msg: `invalid label name: ${name}` });
        continue;
      }
      if (name in PREDEFINED || name in labels) {
        errors.push({ line: lineNos[i], msg: `duplicate label: ${name}` });
        continue;
      }
      labels[name] = romAddr;
    } else {
      romAddr++;
    }
  }

  // ---- pass 2: emit ----
  const symbols: Record<string, number> = { ...PREDEFINED, ...labels };
  let nextVar = 16;
  const words: number[] = [];

  const err = (li: number, msg: string): void => {
    errors.push({ line: lineNos[li], msg });
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith("(")) continue; // handled in pass 1
    if (line.startsWith("@")) {
      const sym = line.slice(1);
      let value: number | undefined;
      if (/^[0-9]+$/.test(sym)) {
        value = parseInt(sym, 10);
        if (value > 0x7fff) {
          err(i, `A-instruction value out of range (0..32767): ${sym}`);
          continue;
        }
      } else if (sym.length > 0 && IDENT_RE.test(sym)) {
        if (sym in symbols) {
          value = symbols[sym];
        } else {
          if (nextVar > 0x3fff) {
            err(i, `out of RAM for variables`);
            continue;
          }
          value = nextVar++;
          symbols[sym] = value;
        }
      } else {
        err(i, `invalid A-instruction symbol: ${sym}`);
        continue;
      }
      words.push(value & 0x7fff);
      continue;
    }
    // C-instruction: [dest=]comp[;jump]
    const w = encodeC(line);
    if (typeof w === "string") {
      err(i, w);
      continue;
    }
    words.push(w);
  }

  return { words: new Uint16Array(words), errors };
}

function encodeC(line: string): number | string {
  let destPart: string | null = null;
  let rest = line;
  const eq = line.indexOf("=");
  if (eq >= 0) {
    destPart = line.slice(0, eq);
    rest = line.slice(eq + 1);
  }
  let compPart = rest;
  let jumpPart: string | null = null;
  const semi = rest.indexOf(";");
  if (semi >= 0) {
    compPart = rest.slice(0, semi);
    jumpPart = rest.slice(semi + 1);
  }

  let dest = 0;
  if (destPart !== null) {
    if (destPart.length === 0) return `empty dest in: ${line}`;
    const seen = new Set<string>();
    for (const ch of destPart) {
      const bit = DEST_BIT[ch];
      if (bit === undefined) return `invalid dest: ${destPart}`;
      if (seen.has(ch)) return `duplicate dest char: ${destPart}`;
      seen.add(ch);
      dest |= bit;
    }
  }

  if (jumpPart !== null) {
    if (!(jumpPart in JUMP)) return `invalid jump: ${jumpPart}`;
  }

  let aBit = 0;
  let comp: number | undefined;
  if (compPart in COMP_A0) {
    comp = COMP_A0[compPart];
  } else if (compPart in COMP_A1) {
    comp = COMP_A1[compPart];
    aBit = 1;
  } else {
    return `invalid comp: ${compPart}`;
  }

  const jump = jumpPart === null ? 0 : JUMP[jumpPart];
  // 111a cccccc ddd jjj
  return (0b111 << 13) | (aBit << 12) | (comp << 6) | (dest << 3) | jump;
}

/** Format words as .hack text: one 16-bit binary line per word, starting at address 0. */
export function wordsToHack(words: Uint16Array): string {
  const out: string[] = [];
  for (let i = 0; i < words.length; i++) {
    out.push(words[i].toString(2).padStart(16, "0"));
  }
  return out.join("\n") + (out.length > 0 ? "\n" : "");
}

/** Parse .hack text (one 16-bit binary word per line) into words. */
export function parseHack(text: string): Uint16Array {
  const words: number[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.length === 0) continue;
    if (!/^[01]{16}$/.test(line)) throw new Error(`bad .hack line: "${line}"`);
    words.push(parseInt(line, 2));
  }
  return new Uint16Array(words);
}
