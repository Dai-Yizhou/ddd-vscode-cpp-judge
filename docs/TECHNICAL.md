# C++ Runner 技术文档

本文档面向开发者，介绍项目架构、模块职责、核心流程和扩展点。

## 0.2.1 兼容性说明

macOS 编译流程支持用户源码中的 `#include <bits/extc++.h>`。当配置的编译器是 Apple Clang 或其他非 GNU 编译器时，Compiler 会注入扩展随附的 `headers/` 目录，提供常用 `pb_ds` 接口的有限兼容实现。当编译器版本输出被识别为真实 GNU GCC 时，不注入该目录，避免覆盖 GCC 自带的 `bits/extc++.h`、`ext/pb_ds` 和 libstdc++ 相关头文件。

`bits/extc++.h`、`ext/pb_ds/*` 均属于 GNU 非标准扩展。Compiler 会检测源码是否包含这些头文件，并在 Runner 面板中提示可能显著增加编译时间。需要完整 GNU `pb_ds` 语义时，应配置 GNU GCC/libstdc++；Apple Clang 兼容层仅面向常见的顺序统计树和哈希表用法。

## 架构概览

```
┌─────────────────────────────────────────────────┐
│                  VS Code Extension Host          │
│                                                  │
│  ┌──────────┐   ┌──────────┐   ┌─────────────┐ │
│  │ extension │──▶│ Compiler │──▶│   Runner    │ │
│  │  .ts     │   │  .ts     │   │    .ts      │ │
│  └────┬─────┘   └──────────┘   └──────┬──────┘ │
│       │                                  │       │
│  ┌────▼──────────────────────────────▼────┐    │
│  │         RunnerPanelProvider             │    │
│  │         (WebviewViewProvider)           │    │
│  │  ┌─────────────────────────────────┐   │    │
│  │  │       Webview (HTML/CSS/JS)      │   │    │
│  │  │  Input | Expected | Actual | Diff │   │    │
│  │  └─────────────────────────────────┘   │    │
│  └────────────────────────────────────────┘    │
│                                                  │
│  ┌──────────┐  ┌──────────┐  ┌────────────┐    │
│  │ Config   │  │ Input    │  │ Expected   │    │
│  │ Manager  │  │ Manager  │  │ Output Mgr │    │
│  └──────────┘  └──────────┘  └────────────┘    │
│                                                  │
│  ┌──────────┐  ┌──────────┐  ┌────────────┐    │
│  │ DiffUtil │  │ FileIo   │  │ Performance│    │
│  │          │  │ Detector │  │ Calculator │    │
│  └──────────┘  └──────────┘  └────────────┘    │
│                                                  │
│  ┌──────────┐  ┌──────────┐  ┌────────────┐    │
│  │ Debugger │  │ StatusBar│  │  Locale    │    │
│  │ Manager  │  │          │  │  (i18n)    │    │
│  └──────────┘  └──────────┘  └────────────┘    │
└─────────────────────────────────────────────────┘
```

## 模块职责

### 核心模块

| 模块 | 文件 | 职责 |
|------|------|------|
| **Extension Entry** | `src/extension.ts` | 扩展入口，命令注册，回调编排，面板生命周期管理 |
| **RunnerPanelProvider** | `src/runnerPanel.ts` | Webview 面板提供者，渲染 UI，处理消息通信，持久化状态 |
| **ConfigManager** | `src/configManager.ts` | 配置管理，读写 `settings.json`，交互式配置 |
| **Compiler** | `src/compiler.ts` | 编译服务，调用 g++/clang++，工具链识别，GNU 扩展头文件选择，参数拼接，诊断解析 |
| **Runner** | `src/runner.ts` | 执行服务，stdin 重定向，资源统计，两层运行时保护 |

### 工具模块

| 模块 | 文件 | 职责 |
|------|------|------|
| **InputManager** | `src/inputManager.ts` | 输入文件/内容关联与持久化 |
| **ExpectedOutputManager** | `src/expectedOutputManager.ts` | 预期输出 `.expected.txt` 文件读写 |
| **DiffUtil** | `src/diffUtil.ts` | 输出差异比对，支持字符串与流式比对 |
| **FileIoDetector** | `src/fileIoDetector.ts` | 检测源码中的 freopen/fopen/fstream |
| **PerformanceCalculator** | `src/performanceCalculator.ts` | 基于 GB6 分数的评测机时间换算 |
| **DebuggerManager** | `src/debugger.ts` | 生成/更新 `launch.json`，启动调试会话 |
| **Locale** | `src/locale/index.ts` | 多语言管理（zh-CN / en-US） |

## 核心流程

### 1. 编译运行流程

```
用户触发运行（快捷键/按钮/命令）
  │
  ├─▶ openRunnerPanel() 或 compileAndRun()
  │     │
  │     ├─▶ 检查编辑器是否为 C++ 文件
  │     ├─▶ 自动保存脏文件（editor.document.save()）
  │     ├─▶ Compiler.compile(sourceFile)
  │     │     ├─▶ 拼接编译参数（标准、优化、警告）
  │     │     ├─▶ child_process.spawn(g++, ...)
  │     │     └─▶ 返回 { success, executablePath, stderr }
  │     │
  │     ├─▶ FileIoDetector.detect(sourceFile)
  │     │     └─▶ 返回 { hasFileIo, inputFile, outputFile }
  │     │
  │     ├─▶ Runner.run(executablePath, stdinInputFile, runOptions)
  │     │     ├─▶ 创建子进程，stdin 重定向
  │     │     ├─▶ 启动资源监控（时间 + 内存）
  │     │     ├─▶ 软限制检测（超限标注 TLE/MLE）
  │     │     ├─▶ 硬限制检测（超限强制终止）
  │     │     └─▶ 返回 { status, stdout, stderr, timeMs, peakMemoryBytes, exitCode }
  │     │
  │     ├─▶ DiffUtil.compareStringOutputs(actualOutput, expectedOutput)
  │     │     └─▶ 返回 { match, summary }
  │     │
  │     ├─▶ PerformanceCalculator.getPerformanceInfo(timeMs, baseline, userScore)
  │     │     └─▶ 返回 { convertedTimeMs, baselineName, baselineScore, ... }
  │     │
  │     └─▶ RunnerPanelProvider.showRunResult(testCaseResult)
  │           └─▶ postMessage → Webview 更新 UI
  │
  └─▶ handleSaveOutput(sourceFile, actualOutput)
```

### 2. 文件加载流程

```
用户拖拽文件 / 点击"载入文件"按钮
  │
  ├─▶ Webview setupDrop() / loadFileButton click
  │     ├─▶ 拖拽 (text/uri-list): postMessage({ command: 'loadFileRequest', target, fileUri })
  │     └─▶ 按钮: postMessage({ command: 'loadFileRequest', target })  // 无 fileUri
  │
  ├─▶ Extension onLoadFileCallback(target, fileUri?)
  │     ├─▶ 有 fileUri: 解析路径（vscode.Uri.parse）
  │     └─▶ 无 fileUri: 打开原生文件选择器（showOpenDialog）
  │
  ├─▶ fs.statSync(filePath)
  │     ├─▶ >1MB: 读取前 64KB 预览 → setFileContent(target, preview, fileName, true, filePath)
  │     └─▶ ≤1MB: 完整读取 → setFileContent(target, content, fileName, false)
  │
  └─▶ Webview 接收 fileContent 消息，更新 textarea
```

### 3. 面板生命周期

```
activate()
  │
  ├─▶ new RunnerPanelProvider(configManager)
  ├─▶ registerWebviewViewProvider('cppRunner.runnerView', provider)
  ├─▶ registerPanelCallbacks()  // 注册 onLoadFile/onRun/onDebug 回调
  │
  ├─▶ 用户通过快捷键打开面板
  │     └─▶ openRunnerPanel()
  │           ├─▶ setSourceFilePath(sourceFile)
  │           ├─▶ setSourceFile(fileName)
  │           ├─▶ show() 或 executeCommand('workbench.view.extension.cppRunner.runnerView')
  │           ├─▶ setLocale(locale, strings)
  │           ├─▶ sendCompileOptions(opts)
  │           ├─▶ setPanelRunKey(key)
  │           ├─▶ setShowControls(controls)
  │           └─▶ setHelpContent(markdown)
  │
  └─▶ 用户通过活动栏图标打开面板
        └─▶ resolveWebviewView(webviewView)
              ├─▶ 渲染 HTML
              ├─▶ 重放 pendingMessages
              └─▶ 重新应用持久化状态（lastFileName, lastLocale, lastCompileOptions, ...）
```

### 4. 大文件处理

```
文件大小检测
  │
  ├─▶ ≤1MB（小文件）
  │     ├─▶ 完整读取到内存
  │     ├─▶ textarea 可编辑
  │     └─▶ 运行时直接使用 textarea 内容
  │
  └─▶ >1MB（大文件）
        ├─▶ 仅读取前 64KB 作为预览
        ├─▶ textarea 只读，标注"大文件预览"
        ├─▶ 保留 filePath 供运行时使用
        └─▶ 运行时:
              ├─▶ 输入: Runner 使用 fs.createReadStream().pipe() 流式读取
              ├─▶ 预期输出: fs.readFileSync() 完整读取（用于比对）
              └─▶ 文件 I/O 模式: fs.copyFileSync() 直接复制
```

## Webview 通信协议

扩展主进程与 Webview 之间通过 `postMessage` 通信：

### 主进程 → Webview

| 命令 | 参数 | 说明 |
|------|------|------|
| `sourceFile` | `fileName` | 设置当前文件名 |
| `locale` | `locale`, `strings` | 设置语言和本地化字符串 |
| `compileOptions` | `opts` | 发送编译选项 |
| `initData` | `input`, `expected` | 初始化输入/预期输出 |
| `panelRunKey` | `key` | 面板内运行快捷键 |
| `showControls` | `controls` | 可见控件列表 |
| `helpContent` | `markdown` | 帮助文档内容 |
| `fileContent` | `target`, `content`, `truncated`, `fileName`, `filePath` | 文件内容 |
| `running` | — | 设置运行中状态 |
| `runResult` | `TestCaseResult` | 运行结果 |
| `compileError` | `stderr` | 编译错误 |
| `triggerRun` | — | 触发运行 |

### Webview → 主进程

| 命令 | 参数 | 说明 |
|------|------|------|
| `run` | `input`, `expected`, `softLimits`, `inputFilePath`, `expectedFilePath` | 触发编译运行 |
| `loadFileRequest` | `target`, `fileUri?` | 请求加载文件 |
| `compileOptionsChange` | `cppStandard`, `optimizationLevel`, `warningFlags` | 编译选项变更 |
| `debug` | — | 请求调试 |
| `helpFromPanel` | — | 请求显示帮助 |

## 性能换算算法

```
换算公式: convertedTime = actualTime × (userDeviceScore / judgeMachineScore)

评测机参数:
  洛谷:  Intel Xeon Platinum 8369HC, GB6 单核 ~1472
  CCF:   Intel Core Ultra 9 285K, GB6 单核 ~2150

用户设备分数来源:
  1. 手动设置 (cppRunner.userDeviceGeekbenchScore > 0)
  2. 自动估算 (基于平台和 CPU 核心数)

示例:
  用户设备 GB6 = 2000, 洛谷 GB6 = 1472
  实际运行时间 = 100ms
  换算时间 = 100 × (2000 / 1472) ≈ 135.9ms
```

## 内存检测实现

| 平台 | 方法 | 精度 |
|------|------|------|
| **macOS** | `ps -o rss= -p <pid>` | 中（RSS） |
| **Linux** | `/proc/<pid>/status` → VmHWM | 高（高水位） |
| **Windows** | PowerShell `Get-CimInstance Win32_Process` | 低 |

## 运行时保护机制

### 软限制（Soft Limit）
- 用户通过面板工具栏设置时间（ms）和内存（MB）阈值
- 超限时程序**继续运行**，仅标注 TLE/MLE 状态
- 用于竞赛编程中模拟评测机限制

### 硬限制（Hard Limit）
- 系统级保护，默认 60s / 4GB
- 超限时**强制终止**进程（SIGKILL）
- 防止恶意或错误程序损害用户设备

## 国际化（i18n）

- 语言文件位于 `src/locale/`，TypeScript 模块（编译到 `out/locale/`）
- 支持 `zh-CN`（简体中文）和 `en-US`（英文）
- 根据 `vscode.env.language` 自动检测语言
- Webview 元素使用 `data-i18n` 和 `data-i18n-placeholder` 属性
- 帮助文档按语言加载：`docs/panel-help-zh-CN.md` / `docs/panel-help-en-US.md`

## 调试与开发

### 环境准备
```bash
npm install          # 安装依赖
npm run compile      # 编译 TypeScript
```

### 调试
1. 在 VS Code 中打开项目
2. 按 `F5` 启动 Extension Development Host
3. 在新窗口中打开 C++ 文件测试

### 打包发布
```bash
npm install -g @vscode/vsce
vsce package          # 生成 .vsix 文件
vsce publish          # 发布到 Marketplace（需发布者账号）
```

### 项目约定
- TypeScript 源码编译到 `out/` 目录
- 测试样例位于 `test-samples/`（不包含在发布包中）
- 配置通过 `cppRunner.*` 命名空间管理
- 所有快捷键可通过 VS Code 键盘快捷方式自定义
- 大文件预览仅加载前 64KB，运行时流式读取完整内容
- 编译前自动保存脏文件
