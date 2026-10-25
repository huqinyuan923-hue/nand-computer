# PROGRESS（硬件轨）

每完成一个里程碑追加一行：日期 / 里程碑 / 结论。软件轨进度见 software/PROGRESS.md。

| 日期 | 里程碑 | 结论 |
|------|--------|------|
| 2026-10-25 | M1 脚手架 + SPEC + 黄金 runner | 完成：docs/GOLDEN.md 定契约（comb/clocked/computer-trace 三种 kind、双后端 interp+jit）；门网表引擎 src/core/circuit.ts（Kahn 拓扑 + 连通性校验）；Nand 真值表黄金通过；SPEC.md 已存在且逐字一致，未改动 |
| 2026-10-25 | M2 基础门 | 完成：Not/And/Or/Xor/Mux/DMux + 16 位/多路变体共 17 个黄金文件穷举/采样（独立布尔 oracle），双后端 34 测试通过；修复 Kahn consumers 键错误 |
| 2026-10-25 | M3 运算 + ALU | 完成：HalfAdder/FullAdder/Add16/Inc16（JS 算术 oracle）+ Hack ALU（128 组控制位 × 操作数对语义表 oracle），44 测试通过 |
| 2026-10-25 | M4 时序 + 门级 RAM | 完成：Bit/Register/ARegister/DRegister/PC（reset>load>inc 优先级、15 位回绕定向黄金）+ RAM8/RAM64 门级全地址写读回黄金；行为级 Memory（RAM16K/Screen/KBD）落地；58 测试通过 |
| 2026-10-25 | M5 CPU + Computer | 完成：门级 CPU（取指/译码/执行/跳转）+ Computer（ROM+行为级 Memory）+ 行为级 oracle + .hack/输入脚本/屏幕哈希 IO；冒烟程序门级=oracle 逐周期一致；修复 dest 字段位序 bug（d3(M)→bit3）；66 测试通过 |
| 2026-10-25 | M6 指令级黄金 + 性能 | 完成：4 个手工推演整机黄金（add/max/屏幕+键盘/越界语义，含冻结屏幕哈希）+ 80 程序固定种子随机对拍 oracle 逐周期 diff（A/D/PC/outM/writeM/addressM + 终态内存）双后端；性能 jit≈60.7 万周期/s、interp≈35 万周期/s（预算 10 万）；78 测试通过 |
| 2026-10-25 | M7 浏览器壳 | 完成：tools/serve.ts（TS 即时转译静态服务，无构建产物）+ web/（.hack 加载、canvas 512×256 渲染、键盘写 KBD、频率显示、门级实时/行为级快进双模式带状态迁移）；chrome-devtools 实测：键盘条 demo 全链路通、快进≈889 万周期/s、门级浏览器≈7.6 万周期/s（Node 60.7 万）；修复 demo 程序两处自伤 bug（A 覆盖/越行写入） |
| 2026-10-25 | M8 集成 | 完成（软件轨 Tetris 未到，先行可集成部分）：headless 集成驱动 npm run integ（门级+oracle 并行逐周期对拍+检查点哈希）；软件轨汇编产物 kbdcopy.hack/sum.hack 在门级计算机端到端跑通（kbdcopy 键入 0x1234→screen[0] ✓、sum R0=10→R1=55 ✓）；81/81 测试通过；Tetris 到货后按 INTEGRATION.md 三步接入，无需改代码 |
