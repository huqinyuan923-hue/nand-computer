/**
 * Hack disassembler: 16-bit words -> canonical assembly text.
 * Used for roundtrip tests (asm -> words -> disasm -> asm -> same words) and for
 * debugging compiled programs. Emits canonical comp/dest/jump spellings.
 */

// canonical comp strings indexed by the 6-bit encoding, split by a-bit
const COMP_BY_A0: string[] = new Array(64).fill("");
const COMP_BY_A1: string[] = new Array(64).fill("");
{
  const tbl0: Record<string, number> = {
    "0": 0b101010, "1": 0b111111, "-1": 0b111010, D: 0b001100, A: 0b110000,
    "!D": 0b001101, "!A": 0b110001, "-D": 0b001111, "-A": 0b110011,
    "D+1": 0b011111, "A+1": 0b110111, "D-1": 0b001110, "A-1": 0b110010,
    "D+A": 0b000010, "D-A": 0b010011, "A-D": 0b000111, "D&A": 0b000000, "D|A": 0b010101,
  };
  const tbl1: Record<string, number> = {
    M: 0b110000, "!M": 0b110001, "-M": 0b110011, "M+1": 0b110111, "M-1": 0b110010,
    "D+M": 0b000010, "D-M": 0b010011, "M-D": 0b000111, "D&M": 0b000000, "D|M": 0b010101,
  };
  for (const [s, v] of Object.entries(tbl0)) COMP_BY_A0[v] = s;
  for (const [s, v] of Object.entries(tbl1)) COMP_BY_A1[v] = s;
}

const DEST_BITS: Array<[string, number]> = [["A", 0b100], ["D", 0b010], ["M", 0b001]];

const JUMP_BY: string[] = new Array(8).fill("");
{
  const j: Record<string, number> = {
    JGT: 0b001, JEQ: 0b010, JLT: 0b011, JGE: 0b100, JNE: 0b101, JLE: 0b110, JMP: 0b111,
  };
  for (const [s, v] of Object.entries(j)) JUMP_BY[v] = s;
}

/** Disassemble words; address >= words.length or unused encodings become "// ?" markers. */
export function disassemble(words: Uint16Array, opts: { labels?: Record<string, number> } = {}): string {
  const labels = opts.labels ?? {};
  const out: string[] = [];
  for (let addr = 0; addr < words.length; addr++) {
    const w = words[addr];
    if (addr in labels) out.push(`(${labels[addr]})`);
    if ((w & 0x8000) === 0) {
      // A-instruction (bit 15 = 0): value may span the full 15-bit range
      out.push(`@${w & 0x7fff}`);
      continue;
    }
    if ((w & 0xe000) !== 0xe000) {
      out.push(`// ? ${w.toString(2).padStart(16, "0")}`);
      continue;
    }
    const a = (w >> 12) & 1;
    const comp = (w >> 6) & 0x3f;
    const destB = (w >> 3) & 0x7;
    const jumpB = w & 0x7;
    const compStr = a === 0 ? COMP_BY_A0[comp] : COMP_BY_A1[comp];
    if (compStr === "") {
      out.push(`// ? ${w.toString(2).padStart(16, "0")}`);
      continue;
    }
    let destStr = "";
    for (const [name, bit] of DEST_BITS) if (destB & bit) destStr += name;
    const jumpStr = jumpB === 0 ? "" : JUMP_BY[jumpB];
    let line = "";
    if (destStr !== "") line += `${destStr}=`;
    line += compStr;
    if (jumpStr !== "") line += `;${jumpStr}`;
    out.push(line);
  }
  return out.join("\n") + "\n";
}
