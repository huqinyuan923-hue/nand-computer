# 集成报告（硬件轨 × 软件轨）

日期：2026-10-25 · 硬件轨 M1–M8 完成

## 硬件轨交付概览

| 组件 | 位置 | 说明 |
|------|------|------|
| 门网表引擎 | `hardware/src/core/circuit.ts` | Nand/DFF 唯一原语；Kahn 拓扑编译；interp + jit 双求值后端 |
| 芯片库 | `hardware/src/chips/` | 基础门→ALU→寄存器/PC→门级 RAM8/RAM64→门级 CPU→Computer |
| 行为级 oracle | `hardware/src/oracle/hack.ts` | ~100 行 ISA 解释器，黄金对照 + 浏览器快进复用 |
| 黄金测试 | `hardware/golden/*.json` + `docs/GOLDEN.md` | 27 个向量文件，双后端各跑一遍 |
| 浏览器 demo | `hardware/web/` + `npm run web` | 门级实时 + 行为级快进双模式，canvas/键盘/频率显示 |
| 集成驱动 | `npm run integ -- --spec <json>` | headless 跑 .hack+输入脚本，检查点屏幕哈希 + oracle 对拍 |

测试：**81/81 通过**（node:test）。性能：**jit ≈ 60.7 万 Hack 周期/秒**（预算 ≥10 万）、interp ≈ 35 万、浏览器门级 ≈ 7.6 万、浏览器行为级快进 ≈ 889 万。

## 已完成的跨轨集成（软件轨汇编产物 → 门级计算机）

软件轨已交付汇编器黄金产物（`software/golden/asm/`，只读消费），已在门级硬件上端到端验证：

| 用例 | 程序 | 输入 | 结果 |
|------|------|------|------|
| kbdcopy | `RAM[SCREEN]=RAM[KBD]` | cycle 2 键入 0x1234 | 门级=oracle 逐周期一致；screen[0]=0x1234；检查点哈希 `8c8050e6…` ✓ |
| sum | `R1=1+2+…+R0`（标签/变量/循环） | initRam R0=10 | 门级=oracle 一致；R1=55 ✓（另验 R0=100→5050） |
| demo-kbdbar | 硬件轨键盘条 demo | cycle 10 键入 65 | 首行 32 字=65；哈希 `0dc315cb…` ✓ |

spec：`hardware/integration/software-asm.json`；测试：`hardware/test/integration.test.ts`。

对拍口径：`expect` 中的哈希当前由硬件轨行为级 oracle 推导并冻结；软件轨 `hackrun` 的检查点哈希与其独立实现同源语义，Tetris 集成时以 hackrun 输出为准回填复核。

## Tetris 集成（待软件轨交付）

软件轨当前进度：汇编器 ✓、hackrun ✓、VM 翻译器 ✓、Jack 编译器进行中（Tetris.hack 未产出）。

Tetris.hack 交付后的集成步骤（工具已就绪，无需改代码）：

1. 软件轨产出 `Tetris.hack` + 输入脚本 + 检查点周期表（含各检查点屏幕哈希，由 hackrun 导出）。
2. 把哈希填入新的 spec JSON（照 `integration/software-asm.json` 格式，expect.checkpoints）。
3. 运行：
   ```bash
   cd hardware && npm run integ -- --spec integration/tetris.json
   ```
   门级 Computer 与 oracle 并行逐周期对拍 + 检查点哈希对拍，退出码非 0 即失败。
4. 浏览器复核：`npm run web` → 加载 Tetris.hack → 门级实时游玩 / 快进模式跳关。

## 冻结与豁免声明

- 门级范围到 CPU 为止；RAM16K/Screen/Keyboard 为行为级数组（官方课程同款豁免），地址译码与越界语义按 SPEC 实现并有定向黄金（computer-oob）。
- SPEC.md 未被两轨修改过（git 历史可查）。
- 无 cron、无后端、无用户数据；仓库无 minified/dist 产物（.gitignore 覆盖 node_modules/dist/.build/.tools）。
