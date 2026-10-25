# nand-computer

TypeScript 门级仿真：从 NAND / DFF 两个原语出发，逐层组合出完整的 Hack 计算机（nand2tetris 风格），最终在浏览器里运行。

## 目录

- [SPEC.md](SPEC.md) — 两轨冻结契约（勿改）。
- [docs/GOLDEN.md](docs/GOLDEN.md) — 黄金测试向量格式、时钟语义、双后端求值约定。
- [hardware/](hardware/) — 门级仿真核心、芯片库、黄金测试、浏览器 demo（硬件轨）。
- [software/](software/) — 汇编器 / VM / 编译器 / Tetris（软件轨，硬件轨只读）。

进度与里程碑结论见 [PROGRESS.md](PROGRESS.md)。

## 硬件轨快速上手

```bash
cd hardware
npm install
npm run gen:golden   # 重新生成确定性黄金向量（可选，仓库内已含）
npm test             # node:test，全部黄金向量在 interp/jit 双后端下运行
npm run web          # 本地浏览器 demo（静态服务 + TS 即时转译，无构建产物）
```

## 设计要点

- 唯一原语：`Nand`（组合）与 `DFF`（时序）；所有上层芯片都是 TS 组合，编译成扁平门网表求值。
- 门级范围到 CPU；RAM16K / Screen / Keyboard 用行为级数组（官方课程同款豁免）。
- 求值双后端：拓扑序解释执行 + 网表编译为 JS 函数（JIT），所有黄金测试双后端各跑一遍互为交叉验证。
- 行为级 ISA 解释器仅作黄金对照 oracle 与浏览器快进模式。
