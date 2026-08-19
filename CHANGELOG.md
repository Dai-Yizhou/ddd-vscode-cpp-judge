# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.3] - 2026-08-19

### Fixed
- 移除残留的 VS Code 底栏状态栏模块及其构建产物
- 修复帮助文档 Markdown 换行解析，恢复标题、列表和段落的正常渲染

## [0.2.2] - 2026-08-12

### Fixed
- 修复 StatusBarManager 未在扩展入口初始化的问题，状态栏徽标（编译选项/输入文件）不再缺失
- 修复 showResultFields 配置 fallback 为空数组导致底栏字段不显示的问题

## [0.2.1] - 2026-08-09

### Added
- macOS 支持 `#include <bits/extc++.h>` 及常用 `pb_ds` 接口的有限兼容层
- 真实 GNU GCC/libstdc++ 可用时自动避免内置兼容头文件覆盖
- 检测 GNU 非标准头文件并提示可能增加编译时间
- 支持可配置 C++ 源文件扩展名和结果栏字段显示

### Changed
- 调试功能标记为弃用，保留旧命令以兼容既有配置
- 统一从外部模板加载运行面板 HTML
- 统一从 locale 模块提供运行面板文本

## [0.2.0] - 2026-07-24 (LTS)

### Added
- 多语言支持：简体中文和英文界面切换，根据 VS Code 语言设置自动适配
- 可配置面板控件：通过 `cppRunner.showControls` 设置项自定义工具栏可见控件
- 多语言帮助文档：根据 VS Code 语言设置自动加载中/英文说明书
- 多语言项目文档：新增英文版 README（`README-en-US.md`）
- CHANGELOG.md 和技术文档（`docs/TECHNICAL.md`）

### Changed
- 面板从底部栏迁移到侧边栏（activitybar），更符合 VS Code 扩展布局惯例
- 快捷键从 `Alt+R` 变更为 `Ctrl+Alt+R`（macOS: `Cmd+Alt+R`），避免与 VS Code 内置快捷键冲突
- 评测状态统一使用大写字母显示（AC, WA, RE, TLE, MLE, CE）
- 评测状态颜色对齐洛谷风格（AC: #52c41a, WA: #E74C3C, RE: #9D3DCF, TLE/MLE: #052242, CE: #FADB14）
- 评测机换算时间与程序文件名不再使用特殊颜色高亮，统一为默认样式
- 帮助/设置按钮移至标题栏（view/title），使用 codicons 图标
- 面板工具栏和结果栏支持自动换行（flex-wrap），防止窄面板下控件遮挡
- 打开面板时不再自动加载样例文件，保持输入/预期输出区域为空

### Fixed
- 修复文件加载卡在 "loading" 状态的问题：回调注册从 `openRunnerPanel` 移至 `activate()`，确保通过活动栏图标打开面板时回调也可用
- 修复快捷键无法唤起面板的问题：使用 `WebviewView.show()` 替代不可靠的 `executeCommand`
- 修复 locale 模块加载失败导致 `openRunnerPanel` 函数中断的问题：添加 try-catch 回退
- 修复面板底部重复显示评测状态的问题（工具栏已有状态徽章）
- 修复帮助文档加载经常失败的问题：改为同步 `fs.readFileSync` 读取

## [0.1.1] - 2026-07-24

### Added
- 可自定义面板内运行快捷键（`cppRunner.panelRunKey` 配置项）
- 帮助文档从文件读取（`docs/panel-help.md`），不再硬编码在源码中
- 内存检测优化：Linux 使用 `/proc/[pid]/task/[pid]/children` 减少进程开销，macOS 使用异步 `pgrep`

### Changed
- 统一文件加载逻辑：拖拽文件与按钮载入使用相同的代码路径
- 编译前自动保存脏文件，确保运行最新版本

### Fixed
- 修复 Linux 内存检测正则表达式匹配问题（`\s+` 替代 `\\s`）
- 修复大文件拖拽加载卡死问题

## [0.1.0] - 2026-07-20

### Added
- 初始发布
- 可视化运行面板：三栏布局（输入 / 预期输出 / 实际输出）
- 一键编译运行：快捷键、命令面板、右键菜单
- 编译选项自定义：C++ 标准、优化级别、警告参数
- 输入管理：手动输入、文件加载、拖拽文件
- 预期输出与差异比对：逐行比对，高亮差异
- 大样例优化：>1MB 文件仅加载前 64KB 预览，运行时流式读取
- 文件 I/O 自动检测：freopen/fopen/fstream
- 运行资源统计：Wall-clock 时间与峰值内存
- 性能换算：基于 GeekBench 6 分数换算洛谷/CCF 评测机等效时间
- 两层运行时保护：软限制（提示）+ 硬限制（强制终止）
- stderr 捕获：cerr/clog/stderr 输出
- 运行时错误捕获：SIGSEGV/SIGABRT/SIGFPE 等信号
- 调试支持：自动生成 launch.json
- 快捷键自定义：所有快捷键可通过 VS Code 键盘快捷方式自定义
