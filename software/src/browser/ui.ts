/**
 * Browser demo UI for the Tetris ROM on the behavioral core.
 *
 * The game redraws the whole scene on every gravity step (~1.4M cycles), which
 * is slower than a display frame at demo speeds. Rendering every frame would
 * show the board being wiped and repainted; instead the loop watches the game's
 * own sceneDirty static (address emitted by tools/record-tetris.mjs into
 * demo/meta.json) and paints only completed frames.
 */
import { HackCore, parseHackText, parseScriptText, type ScriptEntry } from "./engine.js";

interface DemoMeta {
  statics: { sceneDirty: number };
  debug: { lines: number; score: number };
}

const SCREEN_W = 512;
const SCREEN_H = 256;
const CHUNK = 20_000;

function context2d(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const c = canvas.getContext("2d");
  if (c === null) throw new Error("2d context unavailable");
  return c;
}

const canvas = document.getElementById("screen") as HTMLCanvasElement;
const ctx = context2d(canvas);
const pixels = ctx.createImageData(SCREEN_W, SCREEN_H);
const statusEl = document.getElementById("status") as HTMLElement;
const scoreEl = document.getElementById("score") as HTMLElement;
const speedEl = document.getElementById("speed") as HTMLInputElement;
const speedLabel = document.getElementById("speed-label") as HTMLElement;
const pauseBtn = document.getElementById("pause") as HTMLButtonElement;

let rom: Uint16Array | null = null;
let script: ScriptEntry[] = [];
let meta: DemoMeta | null = null;
let core: HackCore | null = null;
let running = true;
let showBoot = true;
let fpsCycle = 0;
let fpsTime = 0;
let showKcps = 0;

const s16 = (v: number): number => (v > 0x7fff ? v - 0x10000 : v);

function draw(): void {
  if (core === null) return;
  const data = pixels.data;
  let p = 0;
  for (let y = 0; y < SCREEN_H; y++) {
    const base = 0x4000 + y * 32;
    for (let wx = 0; wx < 32; wx++) {
      const word = core.ram[base + wx];
      for (let b = 15; b >= 0; b--) {
        const lit = (word >> b) & 1;
        data[p++] = lit ? 244 : 12;
        data[p++] = lit ? 244 : 14;
        data[p++] = lit ? 236 : 20;
        data[p++] = 255;
      }
    }
  }
  ctx.putImageData(pixels, 0, 0);
}

function restart(withScript: boolean): void {
  if (rom === null) return;
  core = new HackCore(rom);
  if (withScript) core.loadScript(script);
  running = true;
  showBoot = true;
  fpsCycle = 0;
  fpsTime = performance.now();
  pauseBtn.textContent = "暂停";
  draw();
}

function cyclesPerFrame(): number {
  return Number(speedEl.value);
}

function updateSpeedLabel(): void {
  speedLabel.textContent = `${Math.round(cyclesPerFrame() / 1000)}k cycles/frame`;
}

function frame(): void {
  const now = performance.now();
  if (core !== null && running) {
    const c = core;
    const budget = cyclesPerFrame();
    const dirtyAddr = meta !== null ? meta.statics.sceneDirty : -1;
    let dirty = dirtyAddr >= 0 && s16(c.ram[dirtyAddr]) !== 0;
    let completed = dirtyAddr < 0;
    let ran = 0;
    while (ran < budget && !c.halted) {
      const n = Math.min(CHUNK, budget - ran);
      c.run(n);
      ran += n;
      if (dirtyAddr >= 0) {
        const nowDirty = s16(c.ram[dirtyAddr]) !== 0;
        if (dirty && !nowDirty) completed = true;
        dirty = nowDirty;
      }
    }
    // Boot paints frame/HUD without going through sceneDirty; keep refreshing
    // until the first completed redraw so the screen comes up.
    if (completed || showBoot) {
      draw();
      if (completed) showBoot = false;
    }

    fpsCycle += ran;
    if (now - fpsTime >= 500) {
      showKcps = fpsCycle / 1000 / ((now - fpsTime) / 1000);
      fpsCycle = 0;
      fpsTime = now;
    }
    const state = c.halted ? " · halted" : "";
    statusEl.textContent = `${(c.cycle / 1e6).toFixed(1)}M cycles · ${showKcps.toFixed(0)}k cycles/s${state}`;
    if (meta !== null) {
      scoreEl.textContent = `LINES ${s16(c.ram[meta.debug.lines])} · SCORE ${s16(c.ram[meta.debug.score])}`;
    }
  }
  requestAnimationFrame(frame);
}

const KEYMAP: Record<string, number> = {
  ArrowLeft: 37,
  ArrowUp: 38,
  ArrowRight: 39,
  ArrowDown: 40,
};

function bindKeys(): void {
  window.addEventListener("keydown", (ev) => {
    const code = KEYMAP[ev.key];
    if (code === undefined) return;
    ev.preventDefault();
    if (core !== null) core.setKey(code);
  });
  window.addEventListener("keyup", (ev) => {
    if (KEYMAP[ev.key] === undefined) return;
    ev.preventDefault();
    if (core !== null) core.setKey(0);
  });
  window.addEventListener("blur", () => {
    if (core !== null) core.setKey(0);
  });
}

async function main(): Promise<void> {
  try {
    const [hackText, scriptText, metaJson] = await Promise.all([
      fetch("tetris.hack").then((r) => {
        if (!r.ok) throw new Error(`tetris.hack: HTTP ${r.status}`);
        return r.text();
      }),
      fetch("input.txt").then((r) => (r.ok ? r.text() : "")),
      fetch("meta.json").then((r) => (r.ok ? (r.json() as Promise<DemoMeta>) : null)).catch(() => null),
    ]);
    rom = parseHackText(hackText);
    script = scriptText ? parseScriptText(scriptText) : [];
    meta = metaJson;
  } catch (err) {
    statusEl.textContent = `load failed: ${(err as Error).message} (run npm run build:demo)`;
    return;
  }

  bindKeys();
  speedEl.addEventListener("input", updateSpeedLabel);
  updateSpeedLabel();

  (document.getElementById("restart") as HTMLButtonElement).addEventListener("click", () => restart(false));
  (document.getElementById("replay") as HTMLButtonElement).addEventListener("click", () => {
    speedEl.value = "600000";
    updateSpeedLabel();
    restart(true);
  });
  pauseBtn.addEventListener("click", () => {
    running = !running;
    pauseBtn.textContent = running ? "暂停" : "继续";
  });

  restart(false);
  requestAnimationFrame(frame);
}

void main();
