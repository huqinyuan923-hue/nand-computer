# nand-computer 软件轨进度（PROGRESS.md）

每完成一个里程碑追加一行：日期 | 里程碑 | 结论。

- 2026-10-25 | M0 | 仓库初始化（main 分支 + origin），SPEC.md 按契约逐字生成，software/ 脚手架就绪（TypeScript strict、node:test、运行时零依赖）
- 2026-10-25 | M1 | 汇编器完成：两遍扫描/符号表/预定义符号/全错误报告，黄金 .asm/.hack 对+往返一致，10/10 测试
- 2026-10-25 | M2 | hackrun 完成：行为级 ISA 解释器（1 指令=1 周期、old-A 跳转、SPEC 内存图、键盘注入、检查点 SHA-256 屏幕哈希），pipe CLI，21/21 测试
- 2026-10-25 | M3 | VM 翻译器完成：全段 push/pop（含 static/temp/pointer）、全部算逻、label/goto/if-goto、function/call/return 调用帧、bootstrap 入口；黄金=hackrun 行为断言（递归 factorial 5!=120、段覆盖、负数比较、多模块 statics），31/31 测试。附带修复汇编器 JLT/JGE 编码互换 bug（由行为测试暴露）
- 2026-10-25 | M4 | Jack 编译器完成：tokenizer/递归下降 parser/AST codegen→VM（类/静态/字段/构造器/方法/函数、完整表达式优先级、this、数组、字符串字面量、跨类符号解析）；黄金=TEST_OS+样例程序 hackrun 行为断言（38/38 测试）。修复：VM function/call 名不再加模块前缀（跨模块调用）、bootstrap 完整调用帧
- 2026-10-25 | M5 | OS 子集完成（纯 Jack + 自家编译器）：Memory 自由表分配器、Array、Math(abs/min/max/multiply/divide 16 轮定长循环、-32768 边界)、String(intValue/setInt)、Output(8x8 字模 41 字形、词级渲染)、Screen(SPEC 像素映射、查表免除法、词级矩形)、Keyboard.key、Sys；ROM 29104<32768；hackrun 行为断言 46/46。修复编译器两个关键 bug：if/while 条件多发 not（带 ~ 的条件全反转）、let a[i]=含数组读的 RHS 覆盖 THAT 写地址（改为先 RHS 后地址）
- 2026-10-28 | M6 | Tetris 完成：10x20 板/12px 格（原点 16,8）、7 方块×4 旋转（spawn 表 + 旋转公式 (x,y)->(n-y,x)，O 不变）、左/右/软降/旋转、固定 busy-wait 重力（GRAV_SUB=8、SOFT_SUB=1、SUB_TICKS=750，无运行时校准）、全场景重绘、消行计分经 Output.printInt。修复 setCells 基址错位（rot[t*8]→rot[t*32]；此前 6/7 方块表退化，落点变单格）。闭环录制 tools/record-tetris.mjs（经汇编符号表读 Jack statics 驱动真实机器）产出 golden/tetris/tetris.hack（32540<32768 字）+ input.txt（26 事件）+ checkpoints.json（7 检查点：开局/5 次落子/1 次空中旋转；第 5 块 J 消一行，lines=1 score=100，final sha eb9348b8…），回放逐点校验；hackrun CLI 独立复跑哈希一致。50/50 测试（新增方块表良构、黄金回放、ROM 预算与黄金镜像逐字比对）。坑：重力步内 spawn 早于 sceneDirty 置位，等 dirty=0 会误判锁块完成——改为先等 dirty→1 再等 →0
- 2026-10-28 | M7 | 集成包 + 浏览器行为级 demo：`software/BUILD-INTEGRATION.md`（产物路径/构建命令/哈希口径/跨轨集成步骤）；自包含 `HackCore`（src/browser/engine.ts，语义与 machine.ts 逐指令一致）+ ui.ts + demo/index.html（512x256 整屏、方向键游玩、速度滑杆、暂停/重启、黄金脚本回放；只在游戏自有 sceneDirty 1→0 的整帧边界绘制），tsconfig.demo → demo/*.js，tools/prepare-demo.mjs 拷 golden 资产；golden/tetris 新增 demo-meta.json（sceneDirty=RAM 43、调试单元 0x3F00..0x3F06）与 integration-spec.json（26 事件内联 + 7 检查点哈希）。门级全量对拍通过：174,971,745 周期零分歧、7/7 检查点门级=oracle=黄金哈希（约 14 分钟，约 207k 周期/秒）。53/53 测试（新增 demo 解析、全检查点回放、HackCore 与 oracle 逐指令锁步 + 全内存比对）。Chromium 实测：开机渲染、按键移动、回放至 LINES 1 · SCORE 100、控制台零错误；`npm run record:tetris` 复跑与已提交黄金逐位一致
