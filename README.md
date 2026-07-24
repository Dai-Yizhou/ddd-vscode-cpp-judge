# C++ Runner

> 一款专为 C++ 单文件快速测试与竞赛编程场景设计的 VSCode 扩展

![Version](https://img.shields.io/badge/version-0.2.0-blue)
![License](https://img.shields.io/badge/license-MIT-green)
![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Linux%20%7C%20Windows-lightgrey)

一键编译运行、可视化输入输出面板、自动差异比对、资源统计、性能换算与轻量级运行时保护。

![English README](README-en-US.md)

## ✨ 功能特性

### 🚀 编译与运行
- **一键编译运行**：快捷键、命令面板、右键菜单，多种方式触发
- **编译选项自定义**：C++ 标准（c++11/14/17/20/23）、优化级别（-O0 ~ -O3/-Os）、警告参数
- **自动保存**：编译前自动保存脏文件，确保运行最新版本
- **调试支持**：一键生成调试配置，启动 VS Code 调试会话

### 📝 输入输出管理
- **三栏面板布局**：输入 / 预期输出 / 实际输出，侧边栏停靠
- **多种输入方式**：手动编辑、文件加载、拖拽导入
- **大样例优化**：>1MB 文件预览前 64KB，运行时流式读取
- **文件 I/O 自动检测**：自动识别 `freopen` / `fopen` / `fstream`

### ✅ 测试与比对
- **自动差异比对**：逐行比对实际输出与预期输出，高亮差异
- **忽略行尾空白**：可配置是否忽略 trailing whitespace
- **多状态展示**：AC / WA / RE / TLE / MLE / CE，洛谷风格配色

### ⚡ 性能与保护
- **资源统计**：Wall-clock 时间 + 峰值内存占用
- **性能换算**：基于 GeekBench 6 换算洛谷 / CCF 评测机等效时间
- **两层运行时保护**：
  - **软限制**：自定义时间/内存阈值，超限标注状态
  - **硬限制**：系统级保护，超限强制终止进程
- **stderr 捕获**：自动展示 `cerr` / `clog` / `stderr` 输出

### 🌍 多语言支持
- 简体中文 / English 界面自动切换
- 帮助文档多语言版本

---

## 🚀 快速开始

### 安装要求
- VS Code 1.74.0+
- 已安装 C++ 编译器：
  - **macOS**：Xcode Command Line Tools（`xcode-select --install`）
  - **Linux**：`g++` 或 `clang++`
  - **Windows**：[MinGW-w64](https://www.mingw-w64.org/) / MSYS2（需配置 PATH）

### 使用方式

1. 打开任意 `.cpp` 文件
2. 按 `Ctrl+Alt+R`（macOS: `Cmd+Alt+R`）打开运行面板
3. 在输入栏中输入测试数据
4. 点击「运行」或按 `Ctrl+Shift+R` / `Cmd+Shift+R` 编译运行
5. 查看实际输出与差异比对结果

---

## ⌨️ 快捷键

所有快捷键均可在「键盘快捷方式」（`Ctrl+K Ctrl+S`）中自定义。

| 功能 | 快捷键 | 备注 |
|------|--------|------|
| 打开运行面板 | `Ctrl+Alt+R` / `Cmd+Alt+R` | |
| 编译并运行 | `Ctrl+Shift+R` / `Cmd+Shift+R` | |
| 面板内运行 | `Ctrl+Enter` | 可通过 `cppRunner.panelRunKey` 自定义 |
| 设置编译选项 | `Alt+O` | |
| 设置警告级别 | `Alt+W` | |
| 打开设置页面 | `Alt+S` | |

---

## ⚙️ 配置项

所有配置位于 `settings.json` 的 `cppRunner` 命名空间下。

### 编译配置

| 配置项 | 类型 | 默认值 | 说明 |
|---------|------|---------|-------------|
| `compilerPath` | string | `g++` | C++ 编译器路径 |
| `cppStandard` | string | `c++17` | C++ 语言标准 |
| `optimizationLevel` | string | `-O2` | 编译优化级别 |
| `warningFlags` | string[] | `[-Wall, -Wextra]` | 编译警告参数 |
| `outputDirectory` | string | `""` | 编译产物输出目录 |

### 运行配置

| 配置项 | 类型 | 默认值 | 说明 |
|---------|------|---------|-------------|
| `timeLimitHard` | number | `60000` | 硬时间限制（ms） |
| `memoryLimitHard` | number | `4294967296` | 硬内存限制（字节） |
| `ignoreTrailingWhitespace` | boolean | `true` | 比对时忽略行尾空白 |
| `panelRunKey` | string | `ctrl+enter` | 面板内运行快捷键 |
| `showControls` | string[] | `[...]` | 面板可见控件 |

### 性能换算

| 配置项 | 类型 | 默认值 | 说明 |
|---------|------|---------|-------------|
| `performanceBaseline` | string | `luogu` | 基准评测机：`none` / `luogu` / `ccf` |
| `userDeviceGeekbenchScore` | number | `0` | 设备 GB6 单核分数（0=自动估算）|

### 文件关联

| 配置项 | 类型 | 默认值 | 说明 |
|---------|------|---------|-------------|
| `inputFileExtensions` | string[] | `["txt", "in"]` | 输入文件扩展名 |
| `expectedOutputFileExtensions` | string[] | `["txt", "out"]` | 预期输出文件扩展名 |
| `largeFileThreshold` | number | `1048576` | 大文件阈值（字节）|

---

## 🖥️ 平台兼容性

| 平台 | 编译运行 | 内存检测 | 调试 |
|------|---------|---------|------|
| **macOS** | ✅ g++/clang++ | ✅ `ps` 查询 RSS | ✅ lldb |
| **Linux** | ✅ g++/clang++ | ✅ `/proc` 高精度 | ✅ gdb |
| **Windows** | ✅ g++ (MinGW) | ⚠️ 精度有限 | ⚠️ 需 MinGW gdb |

---

## 📖 更多文档

- [使用说明书](docs/panel-help-zh-CN.md) - 面板功能详细说明
- [技术文档](docs/TECHNICAL.md) - 架构设计与开发者指南
- [更新日志](CHANGELOG.md) - 各版本变更记录
- [英文版 README](README-en-US.md) - English documentation

---

## 🤝 参与贡献

欢迎提交 Issue 和 Pull Request！

- 🐛 报告 Bug：[Issues](https://github.com/Dai-Yizhou/ddd-vscode-cpp-judge/issues)
- 💡 功能建议：[Issues](https://github.com/Dai-Yizhou/ddd-vscode-cpp-judge/issues)
- 🔧 代码贡献：Fork 后提交 PR

- 欢迎加入QQ用户群：[1025918740](https://qm.qq.com/q/aeBkojHdao)

---

## 📄 许可证

[MIT](LICENSE) License
