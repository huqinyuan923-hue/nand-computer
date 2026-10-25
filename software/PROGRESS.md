# nand-computer 软件轨进度（PROGRESS.md）

每完成一个里程碑追加一行：日期 | 里程碑 | 结论。

- 2026-10-25 | M0 | 仓库初始化（main 分支 + origin），SPEC.md 按契约逐字生成，software/ 脚手架就绪（TypeScript strict、node:test、运行时零依赖）
- 2026-10-25 | M1 | 汇编器完成：两遍扫描/符号表/预定义符号/全错误报告，黄金 .asm/.hack 对+往返一致，10/10 测试
- 2026-10-25 | M2 | hackrun 完成：行为级 ISA 解释器（1 指令=1 周期、old-A 跳转、SPEC 内存图、键盘注入、检查点 SHA-256 屏幕哈希），pipe CLI，21/21 测试
