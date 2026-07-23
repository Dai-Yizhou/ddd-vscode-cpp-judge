# C++ Runner 使用说明

## 基本使用

1. 打开一个 C++ 源文件（.cpp）。
2. 在底部面板的「输入」栏输入测试数据，或在「预期输出」栏输入期望结果。
3. 点击「运行」按钮（或按 Ctrl+Shift+R / Cmd+Shift+R）编译并运行。
4. 运行结果将显示在「实际输出」栏，若设置了预期输出将自动比对差异。

## 软限制 (Soft Limits)

- 工具栏中的「软时限」(ms) 和「软内存」(MB) 用于设置软限制，0 表示不限。
- 软限制不会强制终止程序，仅当程序超出限制时在状态栏标注 TLE/MLE 提示。
- 硬限制由系统保护（默认时间 60s，内存 4GB），超出将强制终止并显示 TLE!/MLE!。

## 文件输入/输出

- 支持拖拽 .in/.txt 文件到输入栏，或点击「载入文件」按钮选择文件。
- 拖拽优先使用 File API 直接读取，其次尝试 file:// URI，最后尝试纯文本路径。
- 大文件（>1MB）：仅加载前 64KB 作为预览显示（只读），运行时从文件流式读取完整内容，不卡顿。**不要直接拖拽大文件到输入框，而应点击“载入文件”从文件浏览器中加载，如果不慎因此卡住，请重新打开面板。如果输入框显示了文件路径，则表示加载失败，请通过“载入文件”按钮加载。**
- 若程序使用 freopen/fopen/fstream 进行文件 I/O，扩展会自动检测：
  - 运行前将面板输入写入程序期望的输入文件；
  - 运行后从程序输出文件读取结果并显示、比对。

## stderr / cerr / clog 输出

- 程序的 cerr / clog / stderr 输出始终显示在「stderr」标签页中。
- 当有 stderr 输出时，stderr 标签会显示红色「!」徽章提醒。
- 编译错误也会显示在 stderr 标签页中。

## 性能换算

- 运行后显示在目标评测机上的等效运行时间（基于 GeekBench 6 单核分数换算）。
- 评测机参数（数据来源：洛谷 chen_zhe 2025-06-01：https://www.luogu.com.cn/article/f3bqyl4w 或 https://www.luogu.me/article/f3bqyl4w）：
  - 洛谷: Intel Xeon Platinum 8369HC (GB6 单核 ~1472)
  - CCF 2025 CSP-S: Intel Core Ultra 9 285K (GB6 单核 ~2150)
    注意：CCF 曾更新评测机，2018-2024 用 i7-8700K (GB6 ~1614)，2025 CSP-S 起更换为 Core Ultra 9 285K（数据来源：洛谷 chen_zhe 2025-02-25：https://www.luogu.com.cn/article/csoig4zt 或 https://www.luogu.me/article/csoig4zt）。
- 推荐在设置中手动指定设备 GeekBench 6 分数以获得更准确换算（cppRunner.userDeviceGeekbenchScore）。
- 查询设备分数：https://browser.geekbench.com

## 编译选项

- 工具栏可快速切换 C++ 标准、优化级别和警告级别。
- 修改后自动保存到 settings.json，下次打开时恢复。
- 警告级别选择「custom」时，请在设置页面自定义警告标志。

## 设置入口

- 点击「设置」按钮（Alt+S）打开可视化设置页面。
- 点击「JSON」按钮（Alt+Shift+S）打开 settings.json 配置文件。
- 可配置项包括：编译器路径、C++ 标准、优化级别、警告标志、性能换算基准等。

## 快捷键

所有快捷键均可在 VS Code「键盘快捷方式」（Ctrl+K Ctrl+S）中自定义：

- 运行: Ctrl+Shift+R / Cmd+Shift+R
- 调试: Ctrl+Shift+D / Cmd+Shift+D
- 编译并运行（编辑器）: F6
- 调试（编辑器）: Ctrl+Shift+B / Cmd+Shift+B
- 打开运行面板: Alt+R
- 打开输入面板: Alt+I
- 载入输入文件: Alt+L
- 设置预期输出: Alt+E
- 清空输入/预期: Alt+C
- 设置编译选项: Alt+O
- 设置警告级别: Alt+W
- 设置页面: Alt+S
- settings.json: Alt+Shift+S
- 面板内运行: Ctrl+Enter（可通过 cppRunner.panelRunKey 设置自定义）

## 运行状态说明

- AC: 正常结束且输出匹配（或未设置预期输出）
- RE: 运行时错误（非零退出码或崩溃）
- TLE: 超出软时间限制（提示，不强制终止）
- TLE!: 超出硬时间限制（系统保护，默认 60s，强制终止）
- MLE: 超出软内存限制（提示，不强制终止）
- MLE!: 超出硬内存限制（系统保护，默认 4GB，强制终止）
- CE: 编译错误，stderr 栏显示编译器错误信息
