# GOLDEN 测试契约（硬件轨）

黄金测试 = 先定测试向量、后写芯片；每里程碑通过即冻结。本文定义向量格式与时钟语义，两处实现（runner 与生成器）都以本文为准。

## 目录与来源

- 向量位于 `hardware/golden/*.json`。
- 组合 / 时序芯片向量由 `npm run gen:golden`（`tools/gen-golden.ts`）**确定性生成**：
  - 1 位门穷举真值表；16 位总线取边界值集合 + 固定种子随机采样（mulberry32，seed = `20261025`）。
  - 期望值一律由**独立的 JS 布尔 / 算术表达式**直接计算（如 `a && b ? 0 : 1`、`(x + y) & 0xFFFF`），与被测芯片的门级实现完全无关。
- `computer-*.json` 为**手工推导**的定向程序黄金：ROM、逐周期 trace、最终 RAM / 屏幕哈希均按本文的时钟语义人工推演，不来自任何实现输出。
- 重新生成必须逐字节稳定（同 seed 同输出）。

## 数值与位序

- 总线 LSB 在前：数值 n 的第 i 位对应总线的第 i 根线。
- 16 位数值范围 0..65535；15 位地址 0..32767；1 位信号取 0/1。
- JSON 中所有数值为十进制。

## 文件格式

通用字段：`chip`（registry 键）、`kind`、`cases`。

### kind = "comb"（组合芯片）

```json
{"chip": "Mux16", "kind": "comb", "cases": [
  {"in": {"a": 0, "b": 65535, "sel": 1}, "out": {"out": 0}, "comment": "可选"}
]}
```

执行：设置 `in` → 组合求值 → 比对 `out`（键 = 输出引脚名，值 = 期望数值；`null` = 不关心，跳过）。

### kind = "clocked"（时序芯片）

```json
{"chip": "PC", "kind": "clocked", "cases": [
  {"set": {"inc": 1}, "out": {"out": 0}, "outAfter": {"out": 1}}
]}
```

每个 case 的执行语义：

1. 设置 `set` 中的输入；未设置的输入保持上一 case 的值。文件开始时芯片为全新状态（所有 DFF = 0）。
2. 组合求值，比对 `out` —— 这是**时钟沿之前**的可观测值。
3. 若 `tick !== false`：执行时钟沿（所有 DFF 同时锁存各自的输入），再次组合求值，比对 `outAfter`（可省略）。

同一文件的所有 case 共用一个芯片实例，状态跨 case 连续。

### kind = "computer-trace"（整机：门级 CPU + 行为级 Memory + ROM）

```json
{"chip": "Computer", "kind": "computer-trace",
 "rom": ["0000000000000101", "1110110000010000"],
 "initRam": {"16": 8},
 "keyboard": [[6, 65]],
 "resetCycles": 1,
 "cycles": 9,
 "trace": [{"pc": 0, "a": 0, "d": 0, "addressM": 0, "outM": null, "writeM": 0}],
 "finalRam": {"16": 8},
 "finalScreenHash": "64位小写十六进制"}
```

时钟语义（第 n 周期，n 从 0 起）：

- 周期开始时的状态 `S_n = {A, D, PC, RAM, Screen, KBD}`；`S_0` 全 0（`initRam` 可预置 RAM 字）。
- keyboard：事件 `[cycle, keycode]` **自第 cycle 周期起生效**（同周期多条取靠后者）；执行第 n 周期前把「≤ n 的最后一条事件」写入 KBD。
- 取指 `instruction_n = ROM[PC_n]`；`addressM_n = A_n & 0x7FFF`（A 寄存器输出，15 位）；`inM_n = Memory.read(addressM_n)`（按 SPEC：越界读 0，KBD 读键盘）。
- 组合求值得到 `outM_n`、`writeM_n`（= C 指令的 d3 位，A 指令 = 0）与跳转判定。
- `trace[n]` 记录**时钟沿之前**的值：`pc`（= PC_n，15 位）、`a`、`d`、`addressM`、`outM`、`writeM`。A 指令周期 `outM` 无定义 → `null`（runner 跳过）；`writeM` 恒有定义。
- 时钟沿（同时发生）：
  - `A ← A指令 ? imm[15位] : (C&d1 ? outM_n : A_n)`
  - `D ← C&d2 ? outM_n : D_n`
  - `PC ← reset_n ? 0 : (C&跳转命中 ? A_n & 0x7FFF : (PC_n + 1) mod 2^15)`（跳转用**沿前**的 A 值）
  - 若 `writeM_n`：`Memory.write(addressM_n, outM_n)`（KBD 与越界写忽略）
- `resetCycles`：前 N 个周期 reset=1（PC 每个沿归 0；指令照常取指执行，因此第 0 条指令会被执行 resetCycles+1 次）。
- `finalRam` / `finalScreenHash`：跑满 `cycles` 个周期后校验；屏幕哈希按 SPEC（8192 字大端展开 16384 字节 → SHA-256 小写 hex）。

## 求值后端

所有黄金测试在两种后端下各跑一遍，结果必须一致（互为交叉验证）：

- `interp` — 拓扑序扁平网表解释执行（Uint8Array 线网 + Kahn 拓扑排序）。
- `jit` — 同一网表编译为单个 JS 函数体求值（浏览器实时模式同款）。

芯片实现只有一份（TS 组合 Nand/DFF），后端只是求值方式。

## 运行

```bash
cd hardware && npm test        # 全部 golden/*.json 自动发现，双后端执行
npm run gen:golden             # 再生成确定性向量
```
