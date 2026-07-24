# C++ Runner

> A VS Code extension designed for rapid C++ single-file testing and competitive programming

![Version](https://img.shields.io/badge/version-0.2.0-blue)
![License](https://img.shields.io/badge/license-MIT-green)
![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Linux%20%7C%20Windows-lightgrey)

One-click compile & run, visual I/O panel, automatic diff comparison, resource statistics, performance estimation, and lightweight runtime protection.

[中文版 README](README.md)

## ✨ Features

### 🚀 Compile & Run
- **One-click compile & run** via keyboard shortcut, command palette, or context menu
- **Customizable compile options**: C++ standard (c++11/14/17/20/23), optimization level (-O0 ~ -O3/-Os), warning flags
- **Auto-save**: Dirty files are automatically saved before compilation
- **Debug support**: One-click debug configuration generation and session launch

### 📝 Input & Output Management
- **Three-column panel layout**: Input / Expected Output / Actual Output, docked in sidebar
- **Multiple input methods**: Manual editing, file loading, drag-and-drop import
- **Large file optimization**: >1MB files show 64KB preview, full content streamed at runtime
- **File I/O auto-detection**: Automatically recognizes `freopen` / `fopen` / `fstream`

### ✅ Testing & Comparison
- **Automatic diff comparison**: Line-by-line comparison with highlighted differences
- **Trailing whitespace option**: Configurable ignore trailing whitespace
- **Multi-status display**: AC / WA / RE / TLE / MLE / CE with Luogu-style color scheme

### ⚡ Performance & Protection
- **Resource statistics**: Wall-clock time + peak memory usage
- **Performance estimation**: Convert runtime to Luogu / CCF judge equivalent time based on GeekBench 6
- **Two-layer runtime protection**:
  - **Soft limit**: Custom time/memory threshold, status marked on exceed
  - **Hard limit**: System-level protection, process forcefully terminated on exceed
- **stderr capture**: Auto-display `cerr` / `clog` / `stderr` output

### 🌍 Multi-language Support
- Simplified Chinese / English interface auto-switching
- Multi-language help documentation

---

## 🚀 Quick Start

### Requirements
- VS Code 1.74.0+
- C++ compiler installed:
  - **macOS**: Xcode Command Line Tools (`xcode-select --install`)
  - **Linux**: `g++` or `clang++`
  - **Windows**: [MinGW-w64](https://www.mingw-w64.org/) / MSYS2 (PATH configured)

### How to Use

1. Open any `.cpp` file
2. Press `Ctrl+Alt+R` (macOS: `Cmd+Alt+R`) to open the runner panel
3. Enter test data in the input column
4. Click "Run" or press `Ctrl+Shift+R` / `Cmd+Shift+R` to compile and run
5. View actual output and diff comparison results

---

## ⌨️ Keyboard Shortcuts

All shortcuts can be customized in Keyboard Shortcuts (`Ctrl+K Ctrl+S`).

| Function | Shortcut | Note |
|----------|----------|------|
| Open Runner Panel | `Ctrl+Alt+R` / `Cmd+Alt+R` | |
| Compile and Run | `Ctrl+Shift+R` / `Cmd+Shift+R` | |
| Run in Panel | `Ctrl+Enter` | Customizable via `cppRunner.panelRunKey` |
| Set Compile Options | `Alt+O` | |
| Set Warning Level | `Alt+W` | |
| Open Settings | `Alt+S` | |

---

## ⚙️ Configuration

All settings are under the `cppRunner` namespace in `settings.json`.

### Compile Settings

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `compilerPath` | string | `g++` | C++ compiler path |
| `cppStandard` | string | `c++17` | C++ language standard |
| `optimizationLevel` | string | `-O2` | Optimization level |
| `warningFlags` | string[] | `[-Wall, -Wextra]` | Warning flags |
| `outputDirectory` | string | `""` | Output directory for compiled binaries |

### Runtime Settings

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `timeLimitHard` | number | `60000` | Hard time limit (ms) |
| `memoryLimitHard` | number | `4294967296` | Hard memory limit (bytes) |
| `ignoreTrailingWhitespace` | boolean | `true` | Ignore trailing whitespace in diff |
| `panelRunKey` | string | `ctrl+enter` | Run shortcut inside panel |
| `showControls` | string[] | `[...]` | Visible controls in panel |

### Performance Estimation

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `performanceBaseline` | string | `luogu` | Baseline judge: `none` / `luogu` / `ccf` |
| `userDeviceGeekbenchScore` | number | `0` | Device GB6 single-core score (0=auto estimate) |

### File Association

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `inputFileExtensions` | string[] | `["txt", "in"]` | Input file extensions |
| `expectedOutputFileExtensions` | string[] | `["txt", "out"]` | Expected output file extensions |
| `largeFileThreshold` | number | `1048576` | Large file threshold (bytes) |

---

## 🖥️ Platform Compatibility

| Platform | Compile & Run | Memory Detection | Debug |
|----------|--------------|------------------|-------|
| **macOS** | ✅ g++/clang++ | ✅ `ps` RSS query | ✅ lldb |
| **Linux** | ✅ g++/clang++ | ✅ `/proc` VmHWM | ✅ gdb |
| **Windows** | ✅ g++ (MinGW) | ⚠️ Limited accuracy | ⚠️ MinGW gdb required |

---

## 📖 More Documentation

- [User Guide](docs/panel-help-en-US.md) - Detailed panel functionality
- [Technical Docs](docs/TECHNICAL.md) - Architecture and developer guide
- [Changelog](CHANGELOG.md) - Version history
- [中文版 README](README.md) - 中文文档

---

## 🤝 Contributing

Issues and Pull Requests are welcome!

- 🐛 Report bugs: [Issues](https://github.com/Dai-Yizhou/ddd-vscode-cpp-judge/issues)
- 💡 Feature requests: [Issues](https://github.com/Dai-Yizhou/ddd-vscode-cpp-judge/issues)
- 🔧 Code contributions: Fork and submit a PR

---

## 📄 License

[MIT](LICENSE) License
