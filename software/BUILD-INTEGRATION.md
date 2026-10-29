# BUILD-INTEGRATION.md — 软件轨构建、黄金产物与集成说明

软件轨（`software/`）自举了完整的 Hack 工具链：汇编器 → 行为级 ISA 解释器（`hackrun`，全轨验证 oracle）→ VM 翻译器 → Jack 编译器 → Jack OS 子集 → Tetris。本文档给出 Milestone 7 的交付物、构建命令、哈希口径，以及和硬件轨门级计算机的集成方式。

## 1. 交付物

| 路径 | 内容 | 产生命令 |
|------|------|----------|
| `software/golden/tetris/tetris.hack` | Tetris ROM，32094 字（< 32768），`romSha256=aaa3b68c…40de` | `npm run record:tetris`（或 `npm run build:tetris`） |
| `software/golden/tetris/input.txt` | 黄金输入脚本，25 条 `cycle keycode`（SPEC 行格式），首个事件 `5344668 39` | `npm run record:tetris` |
| `software/golden/tetris/checkpoints.json` | 运行元数据 + 7 个检查点（周期、标签、屏幕 SHA-256、游戏状态），`totalCycles=166446228` | `npm run record:tetris` |
| `software/golden/tetris/integration-spec.json` | 硬件轨集成驱动 spec（内联脚本 + `expect.checkpoints` 7 个哈希） | `npm run record:tetris` |
| `software/golden/tetris/demo-meta.json` | demo 用地址映射：`sceneDirty` 静态变量（RAM 43）+ 调试单元 `0x3F00..0x3F06` | `npm run record:tetris` |
| `software/demo/index.html` | 浏览器行为级 demo 页面（提交入库） | 手写 |
| `software/demo/{engine,ui}.js`、`tetris.hack`、`input.txt`、`meta.json` | demo 运行时资产（.gitignore 覆盖，按需生成） | `npm run build:demo` |

ROM 与输入脚本由闭环录制工具 `tools/record-tetris.mjs` 生成：它用汇编符号表定位 `Tetris` 类的静态变量地址，直接驱动真实 ROM 跑出计划中的 5 次落子（第 5 块 J 旋转后消一行），边跑边记录键盘事件，最后从零回放并逐检查点核对屏幕哈希。伪随机方块序列由 LCG（`seed=seed+1; type=seed%7`，seed 从 7 起）决定，无需外部随机源。

## 2. 构建与测试

```bash
cd software
npm install        # 仅 devDependencies（typescript、@types/node）；运行时零依赖
npm test           # tsc + node:test：71/71（含 1000 例种子化差分）
npm run build:tetris        # 只建 ROM：stdout=.hack，stderr=ROM 占用量，溢出退出码 1
npm run record:tetris       # 重录 golden/（约 10 秒：构建 + 驱动真实 ROM + 回放校验）
npm run build:demo          # tsc -p tsconfig.demo.json + 拷贝 golden 资产到 demo/
```

`npm test` 覆盖：汇编器/VM/编译器/OS 各自黄金、Tetris ROM 与黄金镜像逐字比对（含 32K 预算护栏）、7 个检查点的行为级回放哈希、`hackrun` CLI 独立复跑哈希、以及浏览器引擎 `HackCore` 与 oracle 的逐指令对拍（寄存器 + 全内存镜像）和对全部检查点哈希的回放。

`test/fuzz.test.ts` 另含 1000 例固定种子（mulberry32）随机差分，失败可复现：

- 500 例随机 Hack 程序：`step()`（参考实现）vs 快速 `run()` vs `HackCore`，随机键盘脚本/监视地址/检查点，寄存器、全内存、监视事件、检查点屏幕哈希全部逐点一致。
- 400 例随机 VM 表达式（深度 ≤4 的 add/sub/and/or/neg/not/eq/gt/lt 树）：翻译 + 汇编 + 真实 `HackMachine` 执行，结果对拍 JS 16 位 oracle。
- 100 例随机汇编输入：前后向标签、预定义符号、随机 C 指令，逐字对拍独立规范编码器。

性能（本机 60M 周期基准，best-of-3）：`HackMachine` 约 95M 周期/秒，浏览器 `HackCore` 约 105M 周期/秒；demo 只对变化屏幕字做脏矩形重绘。

已知语义边界：VM `gt/lt` 采用 nand2tetris 参考翻译器的“16 位环绕差值”判定；异号且 `|x-y| >= 32768` 时与数学比较不符。防溢出内联展开每处约 +14 字，Tetris 有 76 处比较、ROM 余量约 674 字，故保留紧凑实现（`src/vm/translate.ts` 注释、`test/vm.test.ts` 有固定用例）。Tetris 实际比较数值远小于 32768，行为不受影响。

## 3. 哈希与检查点口径（跨轨统一）

- **屏幕哈希**：`SHA-256(0x4000..0x5FFF 共 8192 个字，每字大端 2 字节)` → 16384 字节，小写 hex。这是 SPEC 定义的唯一屏幕摘要口径。
- **检查点周期 V**：表示“第 V 个周期执行完毕后的状态”（周期计数从 0 起，执行完 V 后计数为 V+1）。`hackrun --checkpoints V`、`HackMachine` 快照、硬件轨集成驱动 `checkpoints:[V]` 三处语义一致。
- **ROM 哈希**：`SHA-256(ROM 各字大端 2 字节拼接)`，记录在 `checkpoints.json.romSha256`。
- **时间模型**：1 指令 = 1 周期；C 指令用旧 A 值跳转；键盘寄存器在周期 t 的读数为“最后一条 `cycle <= t` 的脚本事件的键码”，0 表示无按键。
- **Tetris 按键**：37/38/39/40 = 左/上（旋转）/右/下（软降），0 = 抬起。重力由固定周期忙等实现（`GRAV_SUB=8` 子帧 × `SUB_TICKS=750` 忙等迭代），不存在运行时校准。

黄金检查点（完整哈希见 `checkpoints.json`）：

| 周期 | 状态 | 屏幕哈希前缀 |
|------|------|--------------|
| 5,344,667 | 开局：首块 O 生成 | `376f24bd…` |
| 37,946,240 | 第 1 块 O 落定 @x=7 | `f1ecc160…` |
| 66,307,349 | 第 2 块 T 落定 @x=2 | `94378e5f…` |
| 98,758,622 | 第 3 块 S 落定 @x=0 | `02b6860c…` |
| 129,458,399 | 第 4 块 Z 落定 @x=4 | `7ca9ca22…` |
| 131,006,990 | 第 5 块 J 空中旋转到 r=1 | `21d47120…` |
| 166,446,227 | 第 5 块 J 落定 @x=6，消一行 | `eb9348b8…` |

终局 `lines=1, score=100`（单行消行计 100 分，经 `Output.printInt` 显示）。

## 4. 跨轨集成：门级 Computer × 行为级 oracle

`integration-spec.json` 的 `expect.checkpoints` 由软件轨行为级 oracle 导出（不是门级跑出来的），因此门级运行通过即是一次独立实现的对拍：

```bash
cd hardware
node --no-warnings tools/run-integration.ts --spec ../software/golden/tetris/integration-spec.json
# 等价：npm run integ -- --spec ../software/golden/tetris/integration-spec.json
```

spec 要点：`hack` 相对仓库根（`software/golden/tetris/tetris.hack`）；`script` 内联 25 条事件；`cycles=166446228`；`checkpoints` 为 7 个周期；`expect.checkpoints` 为周期 → 屏幕哈希。驱动每个周期比较门级与 oracle 的 `pc/a/d/addressM/writeM/outM`，在检查点周期分别对两边的屏幕取哈希。

退出码 0 当且仅当 `oracleDiff.ok && expectOk`。全量脚本约 1.66 亿周期，门级模拟约 207k 周期/秒，单次运行约 14 分钟；开局检查点（5,344,667）的哈希 `376f24bd…` 已与 `hackrun` 输出逐位一致，验证了两轨的周期/检查点约定。

集成验证结果（2026-10-29，软件轨记录，全量 166,446,228 周期，审计修复后重跑）：

- `oracleDiff.ok = true`，`firstDivergence = null`（全程门级 = 行为级 oracle）
- `expectOk = true`（7/7 检查点：门级哈希 = oracle 哈希 = `checkpoints.json` 黄金哈希）
- 退出码 0

## 5. 浏览器行为级 demo

```bash
cd software
npm run build:demo
python -m http.server 8000     # 任意静态服务器均可；必须走 HTTP，ES module 不支持 file://
# 打开 http://localhost:8000/demo/
```

- 页面加载 `demo/tetris.hack` + `input.txt` + `meta.json`，在自包含的 `HackCore`（与 `src/hack/machine.ts` 语义逐指令一致）上运行；键盘 ←/→/↑/↓ 实时游玩，速度滑杆是“每帧模拟周期数”（模拟时钟倍率，不是难度）。
- 全场景重绘一帧约 140 万周期，直接逐帧渲染会看到清屏中间态；UI 采样游戏自己的 `sceneDirty` 静态变量（地址由 `demo-meta.json` 提供），只在 1→0 的整帧边界绘制。
- 「回放脚本」从零加载黄金 `input.txt` 并以 600k 周期/帧运行，可看到消行与 `SCORE 100`；「重启」「暂停/继续」随时可用。HUD 的 `LINES/SCORE` 读自游戏写入的调试单元 `0x3F05/0x3F06`。
- 已用 Chromium（headless）实测：开机画面渲染、按住 → 方块移动、回放至 `LINES 1 · SCORE 100`、控制台无错误。

### 线上 demo

- 地址：**https://nand-computer-demo.pages.dev**（Cloudflare Pages 项目 `nand-computer-demo`，生产分支 `main`）。自定义域名未配置，留给主会话处理。
- 重新发布（wrangler 4.x；授权用 `wrangler login` 或 `CLOUDFLARE_API_TOKEN`）：
  ```bash
  cd software
  npm run build:demo
  npx wrangler pages deploy demo --project-name nand-computer-demo --branch main
  ```
- 发布后复核：直接加载一次页面（让 Pages 边缘缓存生效），再比对线上 `tetris.hack` 的 SHA-256 与 `golden/tetris/tetris.hack` 一致。2026-10-29 重发布后实测：线上 `tetris.hack`/`input.txt`/`meta.json`/`engine.js`/`ui.js`/`index.html` 哈希均与本地构建一致，Chromium 中开机渲染、方向键移动、黄金脚本回放（`LINES 1 · SCORE 100`，画布哈希 1723327576）均正常，控制台零错误。

## 6. 复现与边界

- 从源码重建全部黄金产物：`npm test && npm run record:tetris && npm run build:demo`。录制工具写盘前会从零回放并核对 7 个检查点哈希，不一致直接失败。
- 门级范围到 CPU 为止：RAM16K/Screen/Keyboard 为行为级数组（官方课程同款豁免），因此跨轨对拍比较 CPU 端口与屏幕哈希，不比较存储器内部实现。
- 仓库不提交 `dist/`、`demo/*.js`、`demo/{tetris.hack,input.txt,meta.json}` 等生成物；`hardware/`、根 `SPEC.md` 未在本轨修改。
- M8（部署）计划将 `software/demo/` 静态发布到 Cloudflare Pages（`*.pages.dev`），自定义域名不在本轨范围内。
