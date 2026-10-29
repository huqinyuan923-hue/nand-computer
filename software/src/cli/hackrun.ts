/**
 * hackrun CLI: run a .hack program on the behavioral interpreter.
 * Pipe-based CLI (no filesystem access):
 *   node hackrun.js [options] < prog.hack
 * Options:
 *   --script "cycle key; cycle key; ..."   keyboard input script (SPEC format pairs)
 *   --until N          run until cycle N (inclusive)
 *   --max-cycles N     safety cap (default 1e9)
 *   --checkpoints a,b  snapshot after these cycles
 *   --watch a,b        report RAM value changes at these addresses
 *   --dump screen|ram  include word dumps in output (repeatable)
 *   --ascii            include downsampled ASCII screen render at checkpoints
 * Output: JSON on stdout.
 */

import { HackMachine, parseInputScript, screenAsciiFromRam } from "../hack/machine";
import { parseHack } from "../hack/asm";

interface Options {
  script: string | null;
  until: number | null;
  maxCycles: number;
  checkpoints: number[];
  watch: number[];
  dump: Set<string>;
  ascii: boolean;
}

function parseArgs(argv: string[]): Options {
  const opts: Options = {
    script: null, until: null, maxCycles: 1_000_000_000,
    checkpoints: [], watch: [], dump: new Set(), ascii: false,
  };
  const numList = (s: string): number[] =>
    s.split(",").map((t) => t.trim()).filter((t) => t.length > 0)
      .map((t) => t.startsWith("0x") ? parseInt(t, 16) : parseInt(t, 10));
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case "--script": opts.script = argv[++i]; break;
      case "--until": opts.until = parseInt(argv[++i], 10); break;
      case "--max-cycles": opts.maxCycles = parseInt(argv[++i], 10); break;
      case "--checkpoints": opts.checkpoints.push(...numList(argv[++i])); break;
      case "--watch": opts.watch.push(...numList(argv[++i])); break;
      case "--dump": opts.dump.add(argv[++i]); break;
      case "--ascii": opts.ascii = true; break;
      default: throw new Error(`unknown option: ${a}`);
    }
  }
  return opts;
}

function wordsToBin(words: Uint16Array): string[] {
  const out: string[] = [];
  for (let i = 0; i < words.length; i++) out.push(words[i].toString(2).padStart(16, "0"));
  return out;
}

async function main(): Promise<number> {
  const opts = parseArgs(process.argv.slice(2));
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  const programText = Buffer.concat(chunks).toString("utf8").replace(/^\uFEFF/, "");

  const program = parseHack(programText);
  const input = opts.script !== null
    ? parseInputScript(opts.script.trim().replace(/[;,]/g, "\n"))
    : [];
  const wantRam = opts.dump.size > 0 || opts.ascii;
  const machine = new HackMachine(program, { input, watch: opts.watch });
  const result = machine.run({
    until: opts.until ?? undefined,
    maxCycles: opts.maxCycles,
    checkpoints: opts.checkpoints,
    captureRam: wantRam,
  });

  const out: Record<string, unknown> = {
    cyclesExecuted: result.cyclesExecuted,
    halted: result.halted,
    haltReason: result.haltReason,
    final: { a: result.finalA, d: result.finalD, pc: result.finalPc, sp: machine.ram[0] },
    checkpoints: result.checkpoints.map((cp) => {
      // dumps must reflect this checkpoint, not the end of the run
      const { ram: snap, ...rest } = cp;
      const image = snap ?? machine.ram;
      return {
        ...rest,
        ascii: opts.ascii ? screenAsciiFromRam(image) : undefined,
        screen: opts.dump.has("screen") ? wordsToBin(image.subarray(0x4000, 0x6000)) : undefined,
        ram: opts.dump.has("ram") ? wordsToBin(image.subarray(0, 0x4000)) : undefined,
      };
    }),
    watch: result.watchEvents,
  };
  process.stdout.write(JSON.stringify(out, null, 1) + "\n");
  return 0;
}

void main().then(
  (code) => process.exit(code),
  (err) => {
    process.stderr.write(`error: ${(err as Error).message}\n`);
    process.exit(1);
  },
);
