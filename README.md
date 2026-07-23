# VSCode C++ Runner 扩展

一款专为 C++ 单文件快速测试与竞赛编程场景设计的 VSCode 扩展，提供一键编译运行、可视化运行面板、输入输出管理、自动差异比对、资源统计、性能换算与轻量级运行时保护等能力。

## 功能特性

- **可视化运行面板**：底部三栏面板（输入 / 预期输出 / 实际输出），支持直接编辑、拖拽文件、实时比对
- **一键编译运行**：打开 `.cpp` 文件后，通过快捷键、命令面板或右键菜单即可编译并运行
- **编译选项自定义**：支持指定 C++ 标准（c++11/14/17/20/23）、优化级别（-O0/-O1/-O2/-O3/-Os）与警告参数，面板内快速切换
- **输入管理**：支持通过面板手动输入、从文件加载（`.txt`/`.in`），或将文件拖拽到输入栏作为标准输入（stdin）
- **预期输出与差异比对**：可设定预期输出，运行后自动与实际输出进行逐行比对，高亮展示差异
- **大样例优化**：针对 ~50MB 级别的大样例进行交互性能优化，非运行阶段仅加载前 64KB 预览，运行时流式读取完整内容
- **文件 I/O 自动检测**：自动检测程序中的 `freopen`/`fopen`/`fstream`，运行前将面板输入写入程序期望的输入文件，运行后从输出文件读取结果
- **运行资源统计**：每次运行结束后显示 Wall-clock 时间与峰值内存占用（目前内存占用检测很不准确，远小于实际）
- **性能换算**：基于 GeekBench 6 单核分数，将运行时间换算为洛谷/CCF 评测机上的等效时间
- **两层运行时保护**：
  - **软限制（Soft Limit）**：用户可自定义的时间/内存阈值，超出后程序继续运行，但标注为超限状态
  - **硬限制（Hard Limit）**：系统级保护阈值，超出后强制终止进程，防止损害用户设备
- **stderr 捕获**：自动捕获并展示 `cerr`/`clog`/`stderr` 输出，编译错误也显示在 stderr 标签页
- **运行时错误（RE）捕获**：自动捕获并展示 SIGSEGV、SIGABRT、SIGFPE 等信号与非零返回码
- **调试支持**：一键生成带 `-g` 调试信息的程序，并自动配置/更新 `launch.json` 启动调试会话
- **快捷键自定义**：所有快捷键均可在 VS Code「键盘快捷方式」中自定义

## 平台兼容性

| 平台 | 编译运行 | 内存检测 | 调试 | 备注 |
|------|---------|---------|------|------|
| **macOS** | ✅ g++/clang++ | ✅ `ps` 查询 RSS | ✅ lldb | 推荐平台 |
| **Linux** | ✅ g++/clang++ | ✅ `/proc` 直接读取（最高精度） | ✅ gdb | 推荐平台 |
| **Windows** | ✅ g++（需 MinGW） | ⚠️ PowerShell 查询（精度有限） | ⚠️ 需 MinGW gdb | 需安装 MinGW 并配置 PATH |

**Windows 用户注意**：
- 需安装 [MinGW-w64](https://www.mingw-w64.org/) 或 MSYS2，并确保 `g++` 在 PATH 中
- 调试功能需要 MinGW 的 `gdb`，或在 `launch.json` 中手动配置 `cppvsdbg`（MSVC 调试器）
- 内存检测使用 PowerShell 的 `Get-CimInstance`（`wmic` 已在 Windows 11 22H2+ 弃用）

## 安装与开发

1. 将本项目复制到 VSCode 扩展目录，或打包为 `.vsix` 文件安装
2. 在项目根目录执行 `npm install` 安装依赖
3. 执行 `npm run compile` 编译 TypeScript
4. 在 VSCode 中按 `F5` 启动 Extension Development Host 进行测试

## 使用指南

### 编译与运行

打开任意 `.cpp` 文件，通过以下任一方式触发：
- **快捷键**：`Ctrl+Shift+R`（macOS: `Cmd+Shift+R`）运行，`F6` 编译并运行
- **面板按钮**：打开底部运行面板，点击「运行」按钮
- **命令面板**：`Ctrl+Shift+P` 后输入 `C++ Runner: Compile and Run`
- **面板内运行**：在输入框中按 `Ctrl+Enter`（可通过 `cppRunner.panelRunKey` 自定义）

### 配置编译选项

- 在底部面板工具栏快速切换 C++ 标准、优化级别和警告级别
- 修改后自动保存到 `settings.json`
- 或执行命令 `C++ Runner: Set Compile Options` / `C++ Runner: Set Warning Level`

### 输入管理

- **面板输入**：在底部面板「输入」栏直接编辑
- **加载文件**：点击「载入文件」按钮选择文件，或将文件拖拽到输入栏
- **大文件**：超过 1MB 的文件仅加载前 64KB 作为预览（只读），运行时从文件流式读取完整内容
- **文件 I/O 检测**：若程序使用 `freopen`/`fopen`/`fstream`，扩展会自动检测并处理文件 I/O

### 预期输出与差异比对

- 在底部面板「预期输出」栏输入，或拖拽/载入预期输出文件
- 运行后自动比对实际输出与预期输出，显示差异详情
- 支持配置是否忽略行尾空白（`cppRunner.ignoreTrailingWhitespace`）

### 性能换算

运行后可显示在目标评测机上的等效运行时间（基于 GeekBench 6 单核分数换算）：
- **洛谷**：Intel Xeon Platinum 8369HC（GB6 单核 ~1472）
- **CCF 2025 CSP-S**：Intel Core Ultra 9 285K（GB6 单核 ~2150）
- 推荐在设置中手动指定设备 GeekBench 6 分数（`cppRunner.userDeviceGeekbenchScore`）以获得更准确换算
- 查询设备分数：https://browser.geekbench.com

### 调试

按 `Ctrl+Shift+B`（macOS: `Cmd+Shift+B`）或执行 `C++ Runner: Debug`：
1. 使用 `-g` 参数重新编译程序
2. 自动在工作区 `.vscode/launch.json` 中生成或更新调试配置
3. 启动 VSCode 调试会话

## 快捷键

所有快捷键均可在 VS Code「键盘快捷方式」（`Ctrl+K Ctrl+S`）中自定义：

| 功能 | 快捷键 | 备注 |
|------|--------|------|
| 运行 | `Ctrl+Shift+R` / `Cmd+Shift+R` | 从面板或编辑器触发 |
| 调试 | `Ctrl+Shift+B` / `Cmd+Shift+B` | 编辑器中触发 |
| 编译并运行（编辑器） | `F6` | |
| 打开运行面板 | `Alt+R` | |
| 打开输入面板 | `Alt+I` | |
| 载入输入文件 | `Alt+L` | |
| 设置预期输出 | `Alt+E` | |
| 清空输入/预期 | `Alt+C` | |
| 设置编译选项 | `Alt+O` | |
| 设置警告级别 | `Alt+W` | |
| 打开设置页面 | `Alt+S` | |
| 打开 settings.json | `Alt+Shift+S` | |
| 面板内运行 | `Ctrl+Enter` | 可通过 `cppRunner.panelRunKey` 自定义 |

## 配置项

所有配置位于 `settings.json` 的 `cppRunner` 命名空间下，支持按工作区配置：

| 配置项 | 类型 | 默认值 | 说明 |
|---------|------|---------|-------------|
| `cppRunner.compilerPath` | string | `g++` | C++ 编译器路径 |
| `cppRunner.cppStandard` | string | `c++17` | C++ 语言标准（c++11/14/17/20/23）|
| `cppRunner.optimizationLevel` | string | `-O2` | 编译优化级别 |
| `cppRunner.warningFlags` | string[] | `[-Wall, -Wextra]` | 编译警告参数 |
| `cppRunner.outputDirectory` | string | `""` | 编译产物输出目录（空则为源文件同级目录）|
| `cppRunner.saveActualOutput` | string | `never` | 保存实际输出行为：`always` / `never`（`ask` 已废弃）|
| `cppRunner.performanceBaseline` | string | `luogu` | 性能换算基准：`none` / `luogu` / `ccf` |
| `cppRunner.userDeviceGeekbenchScore` | number | `0` | 设备 GB6 单核分数（0=自动估算）|
| `cppRunner.largeFileThreshold` | number | `1048576` | 大文件阈值（字节）|
| `cppRunner.timeLimitHard` | number | `60000` | 硬时间限制（毫秒），系统保护 |
| `cppRunner.memoryLimitHard` | number | `4294967296` | 硬内存限制（字节），系统保护 |
| `cppRunner.ignoreTrailingWhitespace` | boolean | `true` | 比对输出时是否忽略行尾空白 |
| `cppRunner.inputFileExtensions` | string[] | `["txt", "in"]` | 输入文件支持的扩展名 |
| `cppRunner.expectedOutputFileExtensions` | string[] | `["txt", "out"]` | 预期输出文件支持的扩展名 |
| `cppRunner.actualOutputExtension` | string | `txt` | 实际输出文件的扩展名 |
| `cppRunner.panelRunKey` | string | `ctrl+enter` | 面板内触发运行的快捷键（留空禁用）|

## 项目结构

```
vscode-cpp-runner/
├── package.json                  # 扩展清单与贡献点配置
├── tsconfig.json                 # TypeScript 编译配置
├── README.md                     # 项目说明文档
├── .vscodeignore                 # 打包排除清单
├── docs/
│   └── panel-help.md             # 面板使用说明（运行时读取，非硬编码）
├── src/
│   ├── extension.ts              # 扩展入口：命令注册与模块协调
│   ├── configManager.ts          # 配置管理器：settings.json 读写与交互式配置
│   ├── compiler.ts               # 编译服务：调用编译器、参数拼接、诊断解析
│   ├── runner.ts                 # 运行服务：stdin 重定向、资源统计、两层运行时保护
│   ├── runnerPanel.ts            # 可视化运行面板：底部三栏 Webview
│   ├── inputManager.ts           # 输入管理器：输入文件/内容关联与持久化
│   ├── expectedOutputManager.ts  # 预期输出管理器：.expected.txt 文件读写
│   ├── diffUtil.ts               # 差异比对：支持普通文件与超大文件流式比对
│   ├── fileIoDetector.ts         # 文件 I/O 检测：检测 freopen/fopen/fstream
│   ├── performanceCalculator.ts  # 性能换算：基于 GB6 分数的评测机时间换算
│   ├── debugger.ts               # 调试管理器：生成 launch.json 并启动调试
│   ├── statusBar.ts              # 状态栏：显示编译选项与关联输入文件名
│   └── webviewInputPanel.ts      # Webview 输入面板：多行编辑与文件拖拽
└── test-samples/                 # 测试样例
```

## 环境要求

- VSCode 1.74.0 或更高版本
- 已安装 C++ 编译器：
  - **macOS**：`g++` 或 `clang++`（Xcode Command Line Tools）
  - **Linux**：`g++` 或 `clang++`
  - **Windows**：MinGW-w64 的 `g++`（需配置 PATH）
- 如需调试功能，建议安装 C/C++ 扩展（`ms-vscode.cpptools`）以提供调试适配器支持

## 许可证

MIT

Code by:Trae AI

