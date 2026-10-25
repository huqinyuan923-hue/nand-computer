# nand-computer 软件轨进度（PROGRESS.md）

每完成一个里程碑追加一行：日期 | 里程碑 | 结论。

- 2026-10-25 | M0 | 仓库初始化（main 分支 + origin），SPEC.md 按契约逐字生成，software/ 脚手架就绪（TypeScript strict、node:test、运行时零依赖）
- 2026-10-25 | M1 | 汇编器完成：两遍扫描/符号表/预定义符号/全错误报告，黄金 .asm/.hack 对+往返一致，10/10 测试
- 2026-10-25 | M2 | hackrun 完成：行为级 ISA 解释器（1 指令=1 周期、old-A 跳转、SPEC 内存图、键盘注入、检查点 SHA-256 屏幕哈希），pipe CLI，21/21 测试
- 2026-10-25 | M3 | VM 翻译器完成：全段 push/pop（含 static/temp/pointer）、全部算逻、label/goto/if-goto、function/call/return 调用帧、bootstrap 入口；黄金=hackrun 行为断言（递归 factorial 5!=120、段覆盖、负数比较、多模块 statics），31/31 测试。附带修复汇编器 JLT/JGE 编码互换 bug（由行为测试暴露）
