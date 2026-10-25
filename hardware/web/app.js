// 浏览器 demo 主逻辑：门级实时 + 行为级快进双模式。
// 直接 import src/ 的 TS 源（serve.ts 即时转译，无构建产物）。

import { Computer } from '/src/chips/computer.ts';
import { HackOracle } from '/src/oracle/hack.ts';
import { parseHack } from '/src/io/hackfile.ts';

// 内置示例：web/demo-kbdbar.hack（键盘条——屏幕首行 32 个字实时显示 KBD 键值），
// 由 tools/gen-demo.ts 生成并经 oracle 语义验证。
const DEMO_URL = '/web/demo-kbdbar.hack';

// ---------- 引擎封装 ----------
function makeGate() {
  const c = new Computer();
  return {
    kind: 'gate',
    inner: c,
    loadRom: (w) => c.loadRom(w),
    step: (reset) => c.step(reset),
    setKbd: (v) => c.setKeyboard(v),
    state: () => ({ a: c.cpu.getOutput('aReg'), d: c.cpu.getOutput('dReg'), pc: c.cpu.getOutput('pc') }),
    importState: ({ a, d, pc }) => c.importState(a, d, pc),
    mem: c.mem,
    cycles: () => c.cycles,
  };
}

function makeOracle() {
  const o = new HackOracle();
  return {
    kind: 'ff',
    inner: o,
    loadRom: (w) => o.loadRom(w),
    step: (reset) => o.step(reset),
    setKbd: (v) => o.setKeyboard(v),
    state: () => ({ a: o.a, d: o.d, pc: o.pc }),
    importState: ({ a, d, pc }) => o.importState(a, d, pc),
    mem: o.mem,
    cycles: () => o.cycles,
  };
}

// ---------- 全局状态 ----------
let engine = makeGate();
let romWords = [];
let running = false;
let mode = 'gate'; // 'gate' | 'ff'
let kbdStack = []; // 按下的键栈（后按优先）

const $ = (id) => document.getElementById(id);
const canvas = $('screen');
const ctx = canvas.getContext('2d');
const img = ctx.createImageData(512, 256);
const buf32 = new Uint32Array(img.data.buffer);

// ---------- 屏幕渲染：SPEC 映射（MSB=最左像素，1=点亮） ----------
function renderScreen() {
  const words = engine.mem.screen;
  for (let w = 0; w < 8192; w++) {
    const v = words[w];
    const base = (w >>> 5) * 512 + (w & 31) * 16;
    for (let b = 0; b < 16; b++) {
      buf32[base + (15 - b)] = (v >>> b) & 1 ? 0xffffffff : 0xff000000;
    }
  }
  ctx.putImageData(img, 0, 0);
}

// ---------- 键盘（SPEC 映射） ----------
const SPECIAL = {
  Backspace: 8, Tab: 9, Enter: 13, Escape: 27,
  ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40,
};
function keyCodeFor(e) {
  if (e.key in SPECIAL) return SPECIAL[e.key];
  if (e.key.length === 1) {
    const c = e.key.charCodeAt(0);
    if (c >= 32) return c;
  }
  return 0;
}
window.addEventListener('keydown', (e) => {
  const code = keyCodeFor(e);
  if (code !== 0) {
    e.preventDefault();
    if (!kbdStack.includes(code)) kbdStack.push(code);
    engine.setKbd(kbdStack[kbdStack.length - 1]);
  }
});
window.addEventListener('keyup', (e) => {
  const code = keyCodeFor(e);
  kbdStack = kbdStack.filter((k) => k !== code);
  engine.setKbd(kbdStack.length ? kbdStack[kbdStack.length - 1] : 0);
});

// ---------- 模式切换（状态迁移） ----------
function switchMode(next) {
  if (next === mode) return;
  const st = engine.state();
  const nextEngine = next === 'gate' ? makeGate() : makeOracle();
  nextEngine.loadRom(romWords);
  nextEngine.importState(st);
  nextEngine.mem.ram.set(engine.mem.ram);
  nextEngine.mem.screen.set(engine.mem.screen);
  nextEngine.setKbd(kbdStack.length ? kbdStack[kbdStack.length - 1] : 0);
  engine = nextEngine;
  mode = next;
  $('stat-mode').textContent = next === 'gate' ? '门级实时' : '行为级快进';
}

// ---------- 主循环 ----------
let lastT = performance.now();
let lastCycles = 0;
let emaFreq = 0;
const speedToCpf = (v) => Math.round(10 ** (2 + (v / 100) * 4)); // 100 .. 1000万

function frame(now) {
  const dt = Math.max(1, now - lastT);
  if (running) {
    const before = engine.cycles();
    if (mode === 'gate') {
      const target = speedToCpf($('speed').value);
      const t0 = performance.now();
      let done = 0;
      while (done < target && performance.now() - t0 < 12) {
        engine.step(0);
        done++;
      }
    } else {
      const t0 = performance.now();
      while (performance.now() - t0 < 12) {
        for (let i = 0; i < 20000; i++) engine.step(0);
      }
    }
    const dc = engine.cycles() - before;
    const inst = dc / (dt / 1000);
    emaFreq = emaFreq ? emaFreq * 0.85 + inst * 0.15 : inst;
  }
  lastT = now;
  lastCycles = engine.cycles();

  renderScreen();
  $('stat-cycles').textContent = engine.cycles().toLocaleString();
  $('stat-freq').textContent = Math.round(emaFreq).toLocaleString();
  $('stat-state').textContent = running ? '运行中' : '已停止';
  requestAnimationFrame(frame);
}

// ---------- 控件 ----------
function loadRomText(text) {
  romWords = parseHack(text);
  engine.loadRom(romWords);
  doReset();
  $('stat-rom').textContent = romWords.length.toLocaleString();
}

function doReset() {
  const keepKbd = kbdStack.length ? kbdStack[kbdStack.length - 1] : 0;
  engine = mode === 'gate' ? makeGate() : makeOracle();
  engine.loadRom(romWords);
  engine.setKbd(keepKbd);
  emaFreq = 0;
}

$('file').addEventListener('change', async (e) => {
  const f = e.target.files[0];
  if (f) loadRomText(await f.text());
});
$('demo').addEventListener('click', () => fetch(DEMO_URL).then((r) => r.text()).then(loadRomText));
$('run').addEventListener('click', () => { running = !running; });
$('reset').addEventListener('click', doReset);
$('mode').addEventListener('change', (e) => switchMode(e.target.value));

// 启动：默认载入示例
fetch(DEMO_URL).then((r) => r.text()).then(loadRomText);
requestAnimationFrame(frame);

// 调试/自动化验证句柄
window.__nand = {
  get cycles() { return engine.cycles(); },
  get running() { return running; },
  get mode() { return mode; },
  get pc() { return engine.state().pc; },
  get aReg() { return engine.state().a; },
  get dReg() { return engine.state().d; },
  get ram0() { return engine.mem.ram[0]; },
  get screenWord() { return (w) => engine.mem.screen[w]; },
  get kbd() { return engine.mem.kbd; },
  press(code) {
    kbdStack.push(code);
    engine.setKbd(code);
  },
  release(code) {
    kbdStack = kbdStack.filter((k) => k !== code);
    engine.setKbd(kbdStack.length ? kbdStack[kbdStack.length - 1] : 0);
  },
  start() { running = true; },
  stop() { running = false; },
  runSteps(n) { for (let i = 0; i < n; i++) engine.step(0); }, // 同步步进，绕开 rAF 节流
  switchTo(next) {
    $('mode').value = next;
    switchMode(next);
  },
};
