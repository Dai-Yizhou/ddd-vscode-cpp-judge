import * as vscode from 'vscode';
import { RunResult } from './runner';
import { ConfigManager } from './configManager';

/**
 * ============================================================================
 * 模块：运行面板 (Runner Panel) — 底部面板视图
 * ============================================================================
 * 职责：以 WebviewView 形式注册到 VS Code 底部面板（panel）区域，
 *       提供三栏布局的可视化运行界面（输入 / 预期输出 / 实际输出）。
 *
 * 面板结构与扩展主进程通过 onDidReceiveMessage 双向通信：
 *   - Webview → 扩展：run / debug / fileDrop
 *   - 扩展 → Webview：initData / running / compileError / runResult / fileContent / fileError / setSourceFile
 * ============================================================================
 */

/** 性能换算信息 */
export interface PerformanceInfo {
    actualTimeMs: number;
    convertedTimeMs: number;
    /** 目标评测机标识键（用于前端本地化） */
    baselineKey: string;
    baselineName: string;
    baselineCpu: string;
    userScore: number;
    baselineScore: number;
    /** 分数来源：'auto'（自动检测）或 'manual'（手动指定） */
    scoreSource: 'auto' | 'manual' | 'none';
    /** 评测机备注信息 */
    baselineNote: string;
}

/** 编译选项信息（发送到面板显示） */
export interface CompileOptionsInfo {
    compilerPath: string;
    cppStandard: string;
    optimizationLevel: string;
    warningFlags: string[];
}

/** 单条测试点结果 */
export interface TestCaseResult {
    status: RunResult['status'];
    timeMs: number;
    peakMemoryBytes: number | undefined;
    exitCode: number | null;
    stdout: string;
    stderr: string;
    diffSummary?: string;
    match?: boolean;
    performanceInfo?: PerformanceInfo;
    /** 文件 I/O 检测信息（程序使用 freopen/fopen 时） */
    fileIoInfo?: {
        inputFile?: string;
        outputFile?: string;
    };
}

/**
 * 运行面板提供者
 * 实现 vscode.WebviewViewProvider，将面板注册到底部栏。
 */
export class RunnerPanelProvider implements vscode.WebviewViewProvider {
    private static instance: RunnerPanelProvider;
    private view: vscode.WebviewView | undefined;
    private configManager: ConfigManager;
    private onRunCallback: ((input: string, expected: string, softLimits?: { timeMs: number; memoryMB: number }, inputFilePath?: string, expectedFilePath?: string) => void) | undefined;
    private onDebugCallback: (() => void) | undefined;
    /**
     * 载入文件请求回调：
     * - 点击"载入文件"按钮时 fileUri 为 undefined，由扩展主进程打开原生文件选择器
     * - 拖拽文件时 fileUri 为文件 URI 或路径，由扩展主进程直接读取
     */
    private onLoadFileCallback: ((target: 'input' | 'expected', fileUri?: string) => void) | undefined;
    /** 编译选项变更回调：用户在面板修改编译选项时触发 */
    private onCompileOptionsChangeCallback: ((opts: { cppStandard: string; optimizationLevel: string; warningFlags: string[] }) => void) | undefined;
    private pendingMessages: any[] = [];

    /** 当前源文件完整路径（回调中使用） */
    private sourceFilePath: string | undefined;

    /** 持久化状态：在 Webview 重建时自动重新应用 */
    private lastFileName: string | undefined;
    private lastLocale: { locale: string; strings: any } | undefined;
    private lastCompileOptions: CompileOptionsInfo | undefined;
    private lastInitialData: { input: string; expected: string } | undefined;
    private lastPanelRunKey: string | undefined;
    private lastShowControls: string[] | undefined;
    private lastHelpContent: string | undefined;

    static getInstance(): RunnerPanelProvider {
        return RunnerPanelProvider.instance;
    }

    constructor(configManager: ConfigManager) {
        this.configManager = configManager;
        RunnerPanelProvider.instance = this;
    }

    resolveWebviewView(webviewView: vscode.WebviewView) {
        this.view = webviewView;
        this.view.webview.options = { enableScripts: true, enableForms: true };
        this.view.webview.html = this.getHtml();

        this.view.webview.onDidReceiveMessage((message) => {
            this.handleMessage(message);
        });

        for (const msg of this.pendingMessages) {
            this.view.webview.postMessage(msg);
        }
        this.pendingMessages = [];

        // Webview 重建后重新应用所有持久化状态
        if (this.lastFileName !== undefined) {
            this.post({ command: 'sourceFile', fileName: this.lastFileName });
        }

        if (!this.lastLocale) {
            const vscodeLocale = vscode.env.language;
            const locale = vscodeLocale.startsWith('zh') ? 'zh-CN' : 'en-US';
            const strings = this.loadLocaleStrings(locale);
            this.lastLocale = { locale, strings };
            this.post({ command: 'locale', locale, strings });
        } else {
            this.post({ command: 'locale', locale: this.lastLocale.locale, strings: this.lastLocale.strings });
        }

        if (!this.lastCompileOptions) {
            this.lastCompileOptions = {
                compilerPath: this.configManager.getCompilerPath(),
                cppStandard: this.configManager.getCppStandard(),
                optimizationLevel: this.configManager.getOptimizationLevel(),
                warningFlags: this.configManager.getWarningFlags(),
            };
            this.post({ command: 'compileOptions', opts: this.lastCompileOptions });
        } else {
            this.post({ command: 'compileOptions', opts: this.lastCompileOptions });
        }

        if (this.lastInitialData) { this.post({ command: 'initData', input: this.lastInitialData.input, expected: this.lastInitialData.expected }); }

        if (this.lastPanelRunKey === undefined) {
            this.lastPanelRunKey = vscode.workspace.getConfiguration('cppRunner').get<string>('panelRunKey', 'ctrl+enter') || '';
            this.post({ command: 'panelRunKey', key: this.lastPanelRunKey });
        } else {
            this.post({ command: 'panelRunKey', key: this.lastPanelRunKey });
        }

        if (!this.lastShowControls) {
            this.lastShowControls = vscode.workspace.getConfiguration('cppRunner').get<string[]>('showControls', []);
            this.post({ command: 'showControls', controls: this.lastShowControls });
        } else {
            this.post({ command: 'showControls', controls: this.lastShowControls });
        }

        if (this.lastHelpContent === undefined) {
            // 帮助文档将在 openRunnerPanel 中通过 fs.readFileSync 加载并发送
            // 此处不主动加载，避免异步问题
        } else {
            this.post({ command: 'helpContent', markdown: this.lastHelpContent });
        }
    }

    /** 打开并聚焦面板 */
    show() {
        this.view?.show(false);
    }

    isReady(): boolean {
        return this.view !== undefined;
    }

    private loadLocaleStrings(locale: string): any {
        if (locale.startsWith('zh')) {
            return {
                run: "运行", runTitle: "编译并运行", cppStandard: "标准", cppStandardTitle: "C++ 语言标准",
                optimizationLevel: "优化", optimizationLevelTitle: "编译优化级别",
                warningLevel: "警告", warningLevelTitle: "编译器警告级别",
                softTimeLimit: "软时限", softTimeLimitTitle: "软时间限制 (ms)，0 = 不限",
                softMemoryLimit: "软内存", softMemoryLimitTitle: "软内存限制 (MB)，0 = 不限",
                help: "说明", helpTitle: "查看使用说明", settings: "设置", settingsTitle: "打开设置页面",
                ready: "就绪", running: "运行中", input: "输入", inputPlaceholder: "输入数据，或拖拽文件到此处...",
                expectedOutput: "预期", expectedPlaceholder: "预期输出...", actualOutput: "实际",
                output: "输出", diff: "差异", stderr: "stderr", status: "状态",
                time: "时间", memory: "内存", exitCode: "退出码", match: "比对",
                deviceGB6: "设备GB6", judgeMachine: "评测机",
                baselineLuogu: "洛谷评测机", baselineCcf: "CCF评测机",
                loading: "正在载入...", loadingFail: "读取失败",
                largeFilePreview: "大文件预览，运行时完整读取",
                auto: "自动", manual: "手动", unknown: "未知",
                loadInput: "载入文件", loadInputTitle: "从文件载入输入",
                loadExpected: "载入文件", loadExpectedTitle: "从文件载入预期输出",
                clearFile: "\u2715", clearFileTitle: "移除已加载的文件",
                diffPlaceholder: "差异比对...", noStderr: "无 stderr", noOutput: "无输出",
                outputPlaceholder: "输出...", helpTitleModal: "C++ Runner 使用说明",
                close: "关闭", saveActualOutput: "保存实际输出", saveActualOutputTitle: "保存实际输出到文件",
                ac: "AC", wa: "WA", re: "RE", tle: "TLE", mle: "MLE", ce: "CE",
                compileError: "编译失败", runningElipsis: "运行中...",
                matchOk: "输出与预期完全匹配", matchSkip: "未设置预期输出，跳过比对",
                dropInput: "松开以加载输入文件", dropExpected: "松开以加载预期输出文件",
                dropUnknown: "无法识别拖拽内容", fileIo: "文件I/O",
                helpLoading: "加载中...", helpClose: "关闭",
            };
        }
        return {
            run: "Run", runTitle: "Compile & Run", cppStandard: "Std", cppStandardTitle: "C++ Language Standard",
            optimizationLevel: "Opt", optimizationLevelTitle: "Compiler Optimization Level",
            warningLevel: "Warn", warningLevelTitle: "Compiler Warning Level",
            softTimeLimit: "Time", softTimeLimitTitle: "Soft time limit (ms), 0 = unlimited",
            softMemoryLimit: "Mem", softMemoryLimitTitle: "Soft memory limit (MB), 0 = unlimited",
            help: "Help", helpTitle: "Show usage guide", settings: "Settings", settingsTitle: "Open settings",
            ready: "Ready", running: "Running", input: "Input", inputPlaceholder: "Enter input, or drop files here...",
            expectedOutput: "Expected", expectedPlaceholder: "Expected output...", actualOutput: "Actual",
            output: "Output", diff: "Diff", stderr: "Err", status: "Status",
            time: "Time", memory: "Memory", exitCode: "Exit", match: "Match",
            deviceGB6: "Device GB6", judgeMachine: "Judge",
            baselineLuogu: "Luogu Judge", baselineCcf: "CCF Judge",
            loading: "Loading...", loadingFail: "Read failed",
            largeFilePreview: "Large file preview",
            auto: "auto", manual: "manual", unknown: "unknown",
            loadInput: "Load File", loadInputTitle: "Load input from file",
            loadExpected: "Load File", loadExpectedTitle: "Load expected output from file",
            clearFile: "\u2715", clearFileTitle: "Remove loaded file",
            diffPlaceholder: "Diff...", noStderr: "No stderr", noOutput: "No output",
            outputPlaceholder: "Output...", helpTitleModal: "C++ Runner Help",
            close: "Close", saveActualOutput: "Save Output", saveActualOutputTitle: "Save actual output to file",
            ac: "AC", wa: "WA", re: "RE", tle: "TLE", mle: "MLE", ce: "CE",
            compileError: "Compile failed", runningElipsis: "Running...",
            matchOk: "Output matches expected exactly", matchSkip: "No expected output set, skipping comparison",
            dropInput: "Release to load input file", dropExpected: "Release to load expected output file",
            dropUnknown: "Unrecognized content", fileIo: "File I/O",
            helpLoading: "Loading...", helpClose: "Close",
        };
    }

    onRun(callback: (input: string, expected: string, softLimits?: { timeMs: number; memoryMB: number }, inputFilePath?: string, expectedFilePath?: string) => void) {
        this.onRunCallback = callback;
    }

    onDebug(callback: () => void) {
        this.onDebugCallback = callback;
    }

    /** 注册编译选项变更回调 */
    onCompileOptionsChange(callback: (opts: { cppStandard: string; optimizationLevel: string; warningFlags: string[] }) => void) {
        this.onCompileOptionsChangeCallback = callback;
    }

    /** 发送当前编译选项到面板 */
    sendCompileOptions(opts: CompileOptionsInfo) {
        this.lastCompileOptions = opts;
        this.post({ command: 'compileOptions', opts });
    }

    /**
     * 注册“载入文件”请求回调。
     * - 当用户点击“载入文件”按钮时触发（fileUri 为 undefined），由扩展主进程打开原生文件选择器。
     * - 当用户拖拽文件时触发（fileUri 为文件 URI 或路径），由扩展主进程直接读取该文件。
     * 读取文件内容后通过 setFileContent 回填到面板（支持大文件路径标记模式）。
     */
    onLoadFile(callback: (target: 'input' | 'expected', fileUri?: string) => void) {
        this.onLoadFileCallback = callback;
    }

    /**
     * 由扩展主进程回填文件内容到面板。
     * @param target - 目标栏 (input/expected)
     * @param content - 预览内容（小文件=完整内容，大文件=前 64KB 预览）
     * @param fileName - 文件名，用于显示提示
     * @param truncated - 是否为截断模式
     * @param filePath - 大文件的完整路径（运行时从此文件流式读取，不经过 textarea）
     */
    setFileContent(target: 'input' | 'expected', content: string, fileName: string, truncated: boolean, filePath?: string) {
        this.post({ command: 'fileContent', target: target === 'input' ? 'inputArea' : 'expectedArea', content, truncated, fileName, filePath });
    }

    /**
     * 由外部命令触发运行。
     * 向 Webview 发送 'triggerRun' 消息，Webview 收集输入/预期输出内容后回调 onRunCallback。
     */
    triggerRun() {
        this.post({ command: 'triggerRun' });
    }

    /** 由外部命令触发调试 */
    triggerDebug() {
        this.onDebugCallback?.();
    }

    /** 由外部命令（标题栏按钮）显示帮助模态框 */
    showHelp() {
        this.post({ command: 'showHelp' });
    }

    setInitialData(input: string, expected: string) {
        this.lastInitialData = { input, expected };
        this.post({ command: 'initData', input, expected });
    }

    /** 设置当前正在编译的源文件名 */
    setSourceFile(fileName: string) {
        this.lastFileName = fileName || '';
        this.post({ command: 'sourceFile', fileName: this.lastFileName });
    }

    /** 设置当前源文件完整路径（回调中使用） */
    setSourceFilePath(filePath: string) {
        this.sourceFilePath = filePath;
    }

    /** 获取当前源文件完整路径 */
    getSourceFilePath(): string | undefined {
        return this.sourceFilePath;
    }

    /** 发送帮助文档内容到面板（从 docs/panel-help.md 读取） */
    setHelpContent(markdown: string) {
        this.lastHelpContent = markdown;
        this.post({ command: 'helpContent', markdown });
    }

    /** 发送面板内运行快捷键设置到 Webview */
    setPanelRunKey(key: string) {
        this.lastPanelRunKey = key;
        this.post({ command: 'panelRunKey', key });
    }

    /** 发送语言设置到 Webview */
    setLocale(locale: string, strings: any) {
        this.lastLocale = { locale, strings };
        this.post({ command: 'locale', locale, strings });
    }

    /** 发送控件显示配置到 Webview */
    setShowControls(controls: string[]) {
        this.lastShowControls = controls;
        this.post({ command: 'showControls', controls });
    }

    showCompileWarning(stderr: string) {
        this.post({ command: 'compileWarning', stderr });
    }

    showCompileError(stderr: string) {
        this.post({ command: 'compileError', stderr });
    }

    showRunResult(result: TestCaseResult) {
        this.post({ command: 'runResult', result });
    }

    setRunning() {
        this.post({ command: 'running' });
    }

    /** 安全发送消息到 Webview，若视图未就绪则缓存 */
    private post(msg: any) {
        if (this.view) {
            this.view.webview.postMessage(msg);
        } else {
            this.pendingMessages.push(msg);
        }
    }

    /** 处理 Webview 消息 */
    private handleMessage(message: any) {
        switch (message.command) {
            case 'run':
                if (this.onRunCallback) {
                    this.onRunCallback(
                        message.input || '',
                        message.expected || '',
                        message.softLimits || undefined,
                        message.inputFilePath || undefined,
                        message.expectedFilePath || undefined
                    );
                }
                break;
            case 'debug':
                this.onDebugCallback?.();
                break;
            case 'loadFileRequest':
                // 用户点击"载入文件"按钮（无 fileUri）或拖拽文件（带 fileUri）
                // 点击按钮：fileUri 为 undefined，扩展主进程打开原生文件选择器
                // 拖拽文件：fileUri 为文件 URI 或路径，扩展主进程直接读取该文件
                if (message.target === 'input' || message.target === 'expected') {
                    this.onLoadFileCallback?.(message.target, message.fileUri);
                }
                break;
            case 'openSettings':
                vscode.commands.executeCommand('cppRunner.openSettings');
                break;
            case 'openSettingsJson':
                vscode.commands.executeCommand('cppRunner.openSettingsJson');
                break;
            case 'compileOptionsChange':
                // 用户在面板修改编译选项：持久化到 settings.json
                if (this.onCompileOptionsChangeCallback) {
                    this.onCompileOptionsChangeCallback({
                        cppStandard: message.cppStandard,
                        optimizationLevel: message.optimizationLevel,
                        warningFlags: message.warningFlags || [],
                    });
                }
                break;
        }
    }

    /**
     * 生成 Webview HTML。
     */
    private getHtml(): string {
        return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: var(--vscode-font-family);
            font-size: var(--vscode-font-size);
            color: var(--vscode-foreground);
            background-color: var(--vscode-editor-background);
            display: flex;
            flex-direction: column;
            height: 100vh;
            overflow: hidden;
        }
        .toolbar {
            display: flex; align-items: center; gap: 6px;
            padding: 4px 10px;
            border-bottom: 1px solid var(--vscode-panel-border);
            flex-shrink: 0;
            flex-wrap: wrap;
        }
        .toolbar button {
            padding: 3px 10px;
            background-color: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none; border-radius: 3px; cursor: pointer;
            font-size: 12px; font-family: var(--vscode-font-family);
            white-space: nowrap;
        }
        .toolbar button:hover { background-color: var(--vscode-button-hoverBackground); }
        .toolbar button:disabled { opacity: 0.5; cursor: not-allowed; }
        .toolbar button.secondary {
            background-color: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
            font-size: 12px;
            padding: 3px 10px;
        }
        .toolbar button.secondary:hover {
            background-color: var(--vscode-button-secondaryHoverBackground, var(--vscode-button-secondaryBackground));
        }
        .toolbar .spacer { flex: 1; }
        /* 窄面板响应式：隐藏标签文字和按钮文字，仅保留图标 */
        @media (max-width: 560px) {
            .opt-label { display: none !important; }
            .toolbar { gap: 3px; padding: 4px 6px; }
            .toolbar button { padding: 4px 6px; }
            .toolbar button .btn-text { display: none; }
            .limit-input { width: 44px; }
        }
        .source-file {
            font-size: 11px; color: var(--vscode-descriptionForeground);
            margin-right: 8px;
        }
        /* 编译选项相关样式 */
        .opt-group {
            display: flex; align-items: center; gap: 3px;
        }
        .opt-label {
            font-size: 11px; color: var(--vscode-descriptionForeground);
            white-space: nowrap;
        }
        .toolbar select {
            font-size: 11px; font-family: var(--vscode-font-family);
            background-color: var(--vscode-dropdown-background, var(--vscode-input-background));
            color: var(--vscode-dropdown-foreground, var(--vscode-input-foreground));
            border: 1px solid var(--vscode-dropdown-border, var(--vscode-input-border, transparent));
            border-radius: 2px; padding: 2px 4px; cursor: pointer;
            outline: none;
        }
        .toolbar select:focus { border-color: var(--vscode-focusBorder); }
        .limit-input {
            width: 56px; font-size: 11px; font-family: var(--vscode-font-family);
            background-color: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border: 1px solid var(--vscode-input-border, transparent);
            border-radius: 2px; padding: 2px 4px; outline: none;
            text-align: right;
        }
        .limit-input:focus { border-color: var(--vscode-focusBorder); }
        .sep {
            width: 1px; height: 20px;
            background-color: var(--vscode-panel-border);
            margin: 0 2px; flex-shrink: 0;
        }
        .status-badge {
            padding: 2px 8px; border-radius: 10px;
            font-size: 11px; font-weight: 600;
        }
        .status-idle { background-color: var(--vscode-badge-background); color: var(--vscode-badge-foreground); }
        .status-running { background-color: var(--vscode-progressBar-background); color: #fff; }
        .status-ac { background-color: rgba(82,196,26,.2); color: #52C41A; border: 1px solid #52C41A; }
        .status-wa { background-color: rgba(231,76,60,.2); color: #E74C3C; border: 1px solid #E74C3C; }
        .status-re { background-color: rgba(157,61,207,.2); color: #9D3DCF; border: 1px solid #9D3DCF; }
        .status-tle { background-color: rgba(5,34,66,.15); color: #052242; border: 1px solid #052242; }
        .status-mle { background-color: rgba(5,34,66,.15); color: #052242; border: 1px solid #052242; }
        .status-ce { background-color: rgba(250,219,20,.2); color: #FADB14; border: 1px solid #FADB14; }

        .main-content { display: flex; flex: 1; overflow-x: auto; overflow-y: hidden; }
        .column {
            flex: 1; display: flex; flex-direction: column;
            min-width: 180px; border-right: 1px solid var(--vscode-panel-border);
        }
        .column:last-child { border-right: none; }
        .column-header {
            display: flex; align-items: center; justify-content: space-between;
            padding: 3px 8px;
            border-bottom: 1px solid var(--vscode-panel-border);
            font-size: 11px; font-weight: 600; color: var(--vscode-foreground);
            text-transform: uppercase; letter-spacing: .5px; flex-shrink: 0;
        }
        .column-header .header-actions {
            display: flex; align-items: center; gap: 4px;
        }
        .column-header .file-hint {
            font-weight: 400; color: var(--vscode-descriptionForeground);
            font-size: 10px; text-transform: none;
        }
        .column-header .load-btn {
            padding: 1px 6px; font-size: 10px; cursor: pointer;
            background-color: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
            border: none; border-radius: 2px;
        }
        .column-header .load-btn:hover {
            background-color: var(--vscode-button-secondaryHoverBackground, var(--vscode-button-secondaryBackground));
        }
        .column-header .clear-btn {
            color: #E74C3C; font-weight: 700; padding: 1px 5px;
        }
        .editor-area {
            flex: 1; display: flex; flex-direction: column;
            overflow: hidden; position: relative;
        }
        textarea {
            flex: 1; width: 100%;
            font-family: var(--vscode-editor-font-family);
            font-size: var(--vscode-editor-font-size);
            background-color: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border: none; padding: 6px; resize: none; outline: none;
            line-height: 1.4;
        }
        textarea:focus { outline: 1px solid var(--vscode-focusBorder); }
        textarea[readonly] {
            background-color: var(--vscode-editor-background);
            color: var(--vscode-editor-foreground);
        }
        .drop-overlay {
            display: none; position: absolute; inset: 0;
            background-color: rgba(14,99,156,.15);
            border: 2px dashed var(--vscode-focusBorder);
            z-index: 10; align-items: center; justify-content: center;
            font-size: 12px; color: var(--vscode-foreground); pointer-events: none;
        }
        .drop-overlay.active { display: flex; }
        .tabs {
            display: flex; border-bottom: 1px solid var(--vscode-panel-border); flex-shrink: 0;
        }
        .tab {
            padding: 3px 10px; font-size: 11px;
            color: var(--vscode-descriptionForeground); cursor: pointer;
            border-bottom: 2px solid transparent;
            display: flex; align-items: center; gap: 4px; position: relative;
        }
        .tab:hover { color: var(--vscode-foreground); }
        .tab.active { color: var(--vscode-foreground); border-bottom-color: var(--vscode-focusBorder); }
        /* stderr 徽章：有 stderr 输出时显示红色感叹号 */
        .tab .stderr-badge {
            display: none;
            background-color: #E74C3C; color: #fff;
            font-size: 9px; font-weight: 700;
            width: 14px; height: 14px; line-height: 14px;
            border-radius: 50%; text-align: center;
        }
        .tab .stderr-badge.show { display: inline-block; }
        .tab-content { flex: 1; display: none; overflow: hidden; }
        .tab-content.active { display: flex; flex-direction: column; }
        .diff-view {
            flex: 1; overflow: auto;
            font-family: var(--vscode-editor-font-family);
            font-size: var(--vscode-editor-font-size);
            padding: 6px; line-height: 1.4;
        }
        .diff-line { white-space: pre-wrap; word-break: break-all; padding: 0 4px; }
        .diff-line.diff-expected { background-color: rgba(231,76,60,.1); border-left: 3px solid #E74C3C; }
        .diff-line.diff-actual { background-color: rgba(82,196,26,.1); border-left: 3px solid #52C41A; }
        .result-bar {
            display: flex; align-items: center; gap: 10px;
            padding: 4px 10px;
            border-top: 1px solid var(--vscode-panel-border);
            font-size: 11px; flex-shrink: 0;
            flex-wrap: wrap;
        }
        .result-item { display: flex; align-items: center; gap: 3px; }
        .result-item .label { color: var(--vscode-descriptionForeground); }
        .result-item .value { font-weight: 600; }
        .spinner {
            display: inline-block; width: 12px; height: 12px;
            border: 2px solid var(--vscode-badge-foreground);
            border-top-color: transparent; border-radius: 50%;
            animation: spin .6s linear infinite;
        }
        @keyframes spin { to { transform: rotate(360deg); } }
        /* 拖拽时整个区域可放置 */
        .editor-area.drag-over .drop-overlay { display: flex; }
    </style>
</head>
<body>
    <div class="toolbar">
        <button id="runBtn" data-i18n-title="runTitle">&#9654; <span class="btn-text" data-i18n="run">Run</span></button>
        <div class="sep"></div>
        <div class="opt-group" id="cppStandardGroup">
            <span class="opt-label" data-i18n="cppStandard" data-i18n-title="cppStandardTitle">Std</span>
            <select id="cppStandardSelect" data-i18n-title="cppStandardTitle">
                <option value="c++98">c++98</option>
                <option value="c++11">c++11</option>
                <option value="c++14">c++14</option>
                <option value="c++17">c++17</option>
                <option value="c++20">c++20</option>
                <option value="c++23">c++23</option>
            </select>
        </div>
        <div class="opt-group" id="optLevelGroup">
            <span class="opt-label" data-i18n="optimizationLevel" data-i18n-title="optimizationLevelTitle">Opt</span>
            <select id="optLevelSelect" data-i18n-title="optimizationLevelTitle">
                <option value="-O0">-O0</option>
                <option value="-O1">-O1</option>
                <option value="-O2">-O2</option>
                <option value="-O3">-O3</option>
                <option value="-Os">-Os</option>
            </select>
        </div>
        <div class="opt-group" id="warningLevelGroup">
            <span class="opt-label" data-i18n="warningLevel" data-i18n-title="warningLevelTitle">Warn</span>
            <select id="warningLevelSelect" data-i18n-title="warningLevelTitle">
                <option value="none">none</option>
                <option value="-Wall">-Wall</option>
                <option value="-Wall -Wextra">-Wall -Wextra</option>
                <option value="-pedantic">-pedantic</option>
                <option value="-Werror">-Werror</option>
                <option value="custom">custom</option>
            </select>
        </div>
        <div class="sep"></div>
        <div class="opt-group" id="softTimeLimitGroup">
            <span class="opt-label" data-i18n="softTimeLimit" data-i18n-title="softTimeLimitTitle">Time</span>
            <input type="number" class="limit-input" id="softTimeLimit" value="0" min="0" data-i18n-title="softTimeLimitTitle" />
        </div>
        <div class="opt-group" id="softMemLimitGroup">
            <span class="opt-label" data-i18n="softMemoryLimit" data-i18n-title="softMemoryLimitTitle">Mem</span>
            <input type="number" class="limit-input" id="softMemLimit" value="0" min="0" data-i18n-title="softMemoryLimitTitle" />
        </div>
        <div class="spacer"></div>
        <span id="statusBadge" class="status-badge status-idle" data-i18n="ready">Ready</span>
    </div>

    <div class="main-content">
        <div class="column">
            <div class="column-header">
                <span data-i18n="input">Input</span>
                <div class="header-actions">
                    <button class="load-btn" id="loadInputBtn" data-i18n="loadInput" data-i18n-title="loadInputTitle">...</button>
                    <button class="load-btn clear-btn" id="clearInputBtn" data-i18n="clearFile" data-i18n-title="clearFileTitle" style="display:none;">&#10005;</button>
                    <span class="file-hint" id="inputFileHint"></span>
                </div>
            </div>
            <div class="editor-area" id="inputArea">
                <textarea id="inputEditor" data-i18n-placeholder="inputPlaceholder" placeholder="Enter input..." spellcheck="false"></textarea>
                <div class="drop-overlay" id="inputDropOverlay" data-i18n="dropInput">Drop input file</div>
            </div>
        </div>
        <div class="column">
            <div class="column-header">
                <span data-i18n="expectedOutput">Expected</span>
                <div class="header-actions">
                    <button class="load-btn" id="loadExpectedBtn" data-i18n="loadExpected" data-i18n-title="loadExpectedTitle">...</button>
                    <button class="load-btn clear-btn" id="clearExpectedBtn" data-i18n="clearFile" data-i18n-title="clearFileTitle" style="display:none;">&#10005;</button>
                    <span class="file-hint" id="expectedFileHint"></span>
                </div>
            </div>
            <div class="editor-area" id="expectedArea">
                <textarea id="expectedEditor" data-i18n-placeholder="expectedPlaceholder" placeholder="Enter expected..." spellcheck="false"></textarea>
                <div class="drop-overlay" id="expectedDropOverlay" data-i18n="dropExpected">Drop expected file</div>
            </div>
        </div>
        <div class="column">
            <div class="column-header"><span data-i18n="actualOutput">Actual</span></div>
            <div class="tabs">
                <div class="tab active" data-tab="output" data-i18n="output">Output</div>
                <div class="tab" data-tab="diff" data-i18n="diff">Diff</div>
                <div class="tab" data-tab="stderr" data-i18n="stderr">stderr<span class="stderr-badge">!</span></div>
            </div>
            <div class="tab-content active" id="tab-output">
                <textarea id="outputDisplay" readonly data-i18n-placeholder="outputPlaceholder" placeholder="Output..." spellcheck="false"></textarea>
            </div>
            <div class="tab-content" id="tab-diff">
                <div class="diff-view" id="diffView" data-i18n="diffPlaceholder">Diff...</div>
            </div>
            <div class="tab-content" id="tab-stderr">
                <textarea id="stderrDisplay" readonly data-i18n-placeholder="noStderr" placeholder="No stderr" spellcheck="false"></textarea>
            </div>
        </div>
    </div>

    <div class="result-bar">
        <div class="result-item" id="resultFileName" style="display:none;"><span class="value" id="resultFileNameValue"></span></div>
        <div class="result-item"><span class="label" data-i18n="time">Time:</span><span class="value" id="resultTime">-</span></div>
        <div class="result-item" id="resultPerformance" style="display:none;"><span class="label" id="resultPerfLabel"></span><span class="value" id="resultPerfValue"></span></div>
        <div class="result-item" id="resultPerfDetail" style="display:none; color:var(--vscode-descriptionForeground); font-size:10px;"></div>
        <div class="result-item"><span class="label" data-i18n="memory">Memory:</span><span class="value" id="resultMemory">-</span></div>
        <div class="result-item"><span class="label" data-i18n="exitCode">Exit:</span><span class="value" id="resultExitCode">-</span></div>
        <div class="result-item" id="resultMatch" style="display:none;"><span class="label" data-i18n="match">Match:</span><span class="value" id="resultMatchValue">-</span></div>
        <div class="result-item" id="resultFileIo" style="display:none;"><span class="label" data-i18n="fileIo">File I/O:</span><span class="value" id="resultFileIoValue" style="font-size:10px;"></span></div>
    </div>

    <div id="helpModal" style="display:none; position:fixed; inset:0; z-index:100; background-color:rgba(0,0,0,.5); align-items:center; justify-content:center;">
        <div style="background-color:var(--vscode-editor-background); border:1px solid var(--vscode-panel-border); border-radius:6px; padding:20px; max-width:720px; max-height:85vh; overflow:auto; font-size:12px; line-height:1.6;">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px; border-bottom:1px solid var(--vscode-panel-border); padding-bottom:8px;">
                <h2 style="margin:0; font-size:14px;" data-i18n="helpTitleModal">C++ Runner Help</h2>
                <button id="closeHelpBtn" style="background:none; border:none; color:var(--vscode-foreground); cursor:pointer; font-size:16px;" data-i18n-title="helpClose">&times;</button>
            </div>
            <div id="helpContent" style="color:var(--vscode-foreground);" data-i18n="helpLoading">Loading...</div>
        </div>
    </div>

    <script>
        const vscode = acquireVsCodeApi();
        const $ = (id) => document.getElementById(id);
        const runBtn = $('runBtn'), statusBadge = $('statusBadge');
        const inputEditor = $('inputEditor'), expectedEditor = $('expectedEditor');
        const outputDisplay = $('outputDisplay'), stderrDisplay = $('stderrDisplay'), diffView = $('diffView');
        const resultTime = $('resultTime'), resultMemory = $('resultMemory');
        const resultExitCode = $('resultExitCode'), resultMatch = $('resultMatch'), resultMatchValue = $('resultMatchValue');
        const resultPerformance = $('resultPerformance'), resultPerfLabel = $('resultPerfLabel'), resultPerfValue = $('resultPerfValue');
        const resultPerfDetail = $('resultPerfDetail');
        const resultFileIo = $('resultFileIo'), resultFileIoValue = $('resultFileIoValue');
        const resultFileName = $('resultFileName'), resultFileNameValue = $('resultFileNameValue');
        // 编译选项元素
        const cppStandardSelect = $('cppStandardSelect');
        const optLevelSelect = $('optLevelSelect');
        const warningLevelSelect = $('warningLevelSelect');
        const softTimeLimit = $('softTimeLimit');
        const softMemLimit = $('softMemLimit');
        const stderrBadge = document.querySelector('.tab[data-tab="stderr"] .stderr-badge');
        // 大文件路径状态：载入大文件时存储完整路径，运行时直接从文件读取（不经过 textarea）
        let inputFilePath = null;
        let expectedFilePath = null;
        // File API 拖拽的大文件内容缓存：File API 不暴露路径，完整内容保存在内存中
        let inputFileContent = null;
        let expectedFileContent = null;
        // 面板内运行快捷键（从设置 cppRunner.panelRunKey 读取，默认 ctrl+enter）
        let panelRunKey = 'ctrl+enter';
        let isRunning = false;
        // 多语言字符串
        let localeStrings = {};

        function t(key) { return localeStrings[key] || key; }

        function applyShowControls(controls) {
            const controlMap = {
                'cppStandard': 'cppStandardGroup',
                'optimizationLevel': 'optLevelGroup',
                'warningLevel': 'warningLevelGroup',
                'softTimeLimit': 'softTimeLimitGroup',
                'softMemoryLimit': 'softMemLimitGroup',
            };
            for (const [key, id] of Object.entries(controlMap)) {
                const el = $(id);
                if (el) {
                    el.style.display = controls.includes(key) ? '' : 'none';
                }
            }
        }

        function applyLocale(strings) {
            localeStrings = strings;
            document.querySelectorAll('[data-i18n]').forEach(el => {
                el.textContent = t(el.dataset.i18n);
            });
            document.querySelectorAll('[data-i18n-title]').forEach(el => {
                el.title = t(el.dataset.i18nTitle);
            });
            document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
                el.placeholder = t(el.dataset.i18nPlaceholder);
            });
        }

        // 警告级别与标志数组互转
        function warningLevelToFlags(level) {
            if (level === 'none' || level === 'custom') return [];
            return level.split(' ');
        }
        function flagsToWarningLevel(flags) {
            if (!flags || flags.length === 0) return 'none';
            var joined = flags.join(' ');
            if (joined === '-Wall') return '-Wall';
            if (joined === '-Wall -Wextra') return '-Wall -Wextra';
            if (joined === '-pedantic') return '-pedantic';
            if (joined === '-Werror') return '-Werror';
            return 'custom';
        }

        // 收集输入/预期/软限制并发送 run 消息
        // 大文件模式：
        //   - 有 filePath（按钮载入 / text/uri-list 拖拽）：扩展主进程直接从文件流式读取
        //   - 有 fileContent（File API 拖拽的大文件）：从 File 对象读取完整内容后发送
        async function doRun() {
            let inputVal = inputEditor.value;
            let expectedVal = expectedEditor.value;
            let inputPath = inputFilePath;
            let expectedPath = expectedFilePath;

            // File API 拖拽的大文件：读取完整内容后发送
            if (inputFileContent) {
                try {
                    inputVal = await inputFileContent.text();
                } catch (err) {
                    inputVal = inputEditor.value;
                }
                inputPath = null;
            }
            if (expectedFileContent) {
                try {
                    expectedVal = await expectedFileContent.text();
                } catch (err) {
                    expectedVal = expectedEditor.value;
                }
                expectedPath = null;
            }

            vscode.postMessage({
                command: 'run',
                input: inputPath ? '' : inputVal,
                expected: expectedPath ? '' : expectedVal,
                softLimits: {
                    timeMs: parseInt(softTimeLimit.value, 10) || 0,
                    memoryMB: parseInt(softMemLimit.value, 10) || 0
                },
                inputFilePath: inputPath,
                expectedFilePath: expectedPath
            });
        }

        // 运行按钮
        runBtn.addEventListener('click', () => { if (!isRunning) doRun(); });

        // 移除已加载文件按钮：清除内容、路径、缓存，恢复可编辑
        $('clearInputBtn').addEventListener('click', () => {
            inputEditor.value = '';
            inputEditor.readOnly = false;
            inputFilePath = null;
            inputFileContent = null;
            $('inputFileHint').textContent = '';
            $('clearInputBtn').style.display = 'none';
        });
        $('clearExpectedBtn').addEventListener('click', () => {
            expectedEditor.value = '';
            expectedEditor.readOnly = false;
            expectedFilePath = null;
            expectedFileContent = null;
            $('expectedFileHint').textContent = '';
            $('clearExpectedBtn').style.display = 'none';
        });
        $('closeHelpBtn').addEventListener('click', () => {
            $('helpModal').style.display = 'none';
        });
        // 点击模态框外部关闭
        $('helpModal').addEventListener('click', (e) => {
            if (e.target === $('helpModal')) $('helpModal').style.display = 'none';
        });

        // 载入文件按钮：交由扩展主进程打开原生文件选择器（支持大文件路径标记模式）
        $('loadInputBtn').addEventListener('click', () => { vscode.postMessage({ command: 'loadFileRequest', target: 'input' }); });
        $('loadExpectedBtn').addEventListener('click', () => { vscode.postMessage({ command: 'loadFileRequest', target: 'expected' }); });

        // 编译选项变更：发送到扩展主进程持久化
        function sendCompileOptionsChange() {
            vscode.postMessage({
                command: 'compileOptionsChange',
                cppStandard: cppStandardSelect.value,
                optimizationLevel: optLevelSelect.value,
                warningFlags: warningLevelToFlags(warningLevelSelect.value)
            });
        }
        cppStandardSelect.addEventListener('change', sendCompileOptionsChange);
        optLevelSelect.addEventListener('change', sendCompileOptionsChange);
        warningLevelSelect.addEventListener('change', sendCompileOptionsChange);

        // 标签切换
        document.querySelectorAll('.tab').forEach(tab => {
            tab.addEventListener('click', () => {
                document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
                document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
                tab.classList.add('active');
                $('tab-' + tab.dataset.tab)?.classList.add('active');
            });
        });

        // stderr 徽章更新：有 stderr 输出时显示红色感叹号
        function updateStderrBadge(text) {
            if (text && text.trim() && text !== '(' + t('noStderr') + ')') {
                stderrBadge.classList.add('show');
            } else {
                stderrBadge.classList.remove('show');
            }
        }

        // 拖拽支持：File API 为主，text/uri-list 为辅
        // VS Code Webview 中 File API 最可靠，但不暴露文件路径，因此：
        //   - 小文件（≤1MB）：完整读取内容填入 textarea（可编辑）
        //   - 大文件（>1MB）：仅读取前 64KB 作为预览（只读），完整内容保存在内存中
        // 这样无论拖拽与"载入文件"按钮的 UI 行为完全一致，用户无需区分加载方式。
        const BIG_FILE_THRESHOLD = 1024 * 1024; // 1MB，与扩展主进程阈值一致
        const PREVIEW_SIZE = 64 * 1024;       // 64KB 预览
        function setupDrop(areaId, overlayId) {
            const area = $(areaId);
            const editor = areaId === 'inputArea' ? inputEditor : expectedEditor;
            const hintEl = areaId === 'inputArea' ? $('inputFileHint') : $('expectedFileHint');
            const target = areaId === 'inputArea' ? 'input' : 'expected';
            // dragenter/dragover 必须阻止默认行为才能触发 drop
            area.addEventListener('dragenter', (e) => {
                e.preventDefault(); e.stopPropagation();
                area.classList.add('drag-over');
            });
            area.addEventListener('dragover', (e) => {
                e.preventDefault(); e.stopPropagation();
                e.dataTransfer.dropEffect = 'copy';
            });
            area.addEventListener('dragleave', (e) => {
                e.preventDefault(); e.stopPropagation();
                // 仅当离开 area 本身（而非子元素）时移除
                if (e.target === area) area.classList.remove('drag-over');
            });
            area.addEventListener('drop', async (e) => {
                e.preventDefault(); e.stopPropagation();
                area.classList.remove('drag-over');

                const uriList = e.dataTransfer.getData('text/uri-list');
                if (uriList && uriList.trim()) {
                    const uri = uriList.trim().split('\\n')[0].trim();
                    if (uri) {
                        vscode.postMessage({ command: 'loadFileRequest', target: target, fileUri: uri });
                        hintEl.textContent = t('loading');
                        return;
                    }
                }

                // 2. 尝试 File API（Webview 内直接读取）：无路径，UI 行为与按钮载入保持一致
                const files = e.dataTransfer.files;
                if (files && files.length > 0) {
                    const file = files[0];
                    try {
                        if (file.size > BIG_FILE_THRESHOLD) {
                            // 大文件：仅读取前 64KB 作为预览（只读）
                            const slice = file.slice(0, PREVIEW_SIZE);
                            const preview = await slice.text();
                            editor.value = preview;
                            editor.readOnly = true;
                            // 保存完整 File 对象，运行时读取完整内容
                            if (areaId === 'inputArea') {
                                inputFileContent = file;
                            } else {
                                expectedFileContent = file;
                            }
                            hintEl.textContent = file.name + ' (' + t('largeFilePreview') + ')';
                            const clearBtn = areaId === 'inputArea' ? $('clearInputBtn') : $('clearExpectedBtn');
                            if (clearBtn) clearBtn.style.display = '';
                        } else {
                            // 小文件：完整读取，可编辑
                            const content = await file.text();
                            editor.value = content;
                            editor.readOnly = false;
                            if (areaId === 'inputArea') {
                                inputFileContent = null;
                            } else {
                                expectedFileContent = null;
                            }
                            hintEl.textContent = file.name;
                            const clearBtn = areaId === 'inputArea' ? $('clearInputBtn') : $('clearExpectedBtn');
                            if (clearBtn) clearBtn.style.display = '';
                        }
                    } catch (err) {
                        hintEl.textContent = t('loadingFail') + ': ' + err.message;
                    }
                    return;
                }

                // 3. 尝试 text/plain（文件路径）
                const plainText = e.dataTransfer.getData('text/plain');
                if (plainText && plainText.trim()) {
                    vscode.postMessage({ command: 'loadFileRequest', target: target, fileUri: plainText.trim() });
                    hintEl.textContent = '正在载入...';
                    return;
                }

                // 4. 所有方法均失败：显示提示
                hintEl.textContent = t('dropUnknown');
            });
        }
        setupDrop('inputArea', 'inputDropOverlay');
        setupDrop('expectedArea', 'expectedDropOverlay');

        // 用户手动编辑 textarea 时清除大文件路径标记和 File API 缓存，恢复可编辑模式
        // 大文件预览是只读的，此监听主要处理小文件模式下用户编辑后的状态更新
        inputEditor.addEventListener('input', () => {
            if (!inputEditor.readOnly) {
                if (inputFilePath) {
                    inputFilePath = null;
                }
                if (inputFileContent) {
                    inputFileContent = null;
                }
                $('inputFileHint').textContent = '';
            }
        });
        expectedEditor.addEventListener('input', () => {
            if (!expectedEditor.readOnly) {
                if (expectedFilePath) {
                    expectedFilePath = null;
                }
                if (expectedFileContent) {
                    expectedFileContent = null;
                }
                $('expectedFileHint').textContent = '';
            }
        });

        // 接收主进程消息
        window.addEventListener('message', (event) => {
            const msg = event.data;
            switch (msg.command) {
                case 'triggerRun':
                    doRun();
                    break;
                case 'sourceFile':
                    if (msg.fileName) {
                        resultFileName.style.display = 'flex';
                        resultFileNameValue.textContent = msg.fileName;
                    } else {
                        resultFileName.style.display = 'none';
                    }
                    break;
                case 'helpContent':
                    // 从扩展主进程接收帮助文档（Markdown），转换为 HTML 后填充到帮助模态框
                    $('helpContent').innerHTML = markdownToHtml(msg.markdown);
                    break;
                case 'panelRunKey':
                    panelRunKey = (msg.key || '').toLowerCase().trim();
                    break;
                case 'showControls':
                    applyShowControls(msg.controls || []);
                    break;
                case 'locale':
                    applyLocale(msg.strings || {});
                    break;
                case 'initData':
                    if (msg.input !== undefined) inputEditor.value = msg.input;
                    if (msg.expected !== undefined) expectedEditor.value = msg.expected;
                    break;
                case 'fileContent':
                    {
                        const editor = msg.target === 'inputArea' ? inputEditor : expectedEditor;
                        const hintEl = msg.target === 'inputArea' ? $('inputFileHint') : $('expectedFileHint');
                        const clearBtn = msg.target === 'inputArea' ? $('clearInputBtn') : $('clearExpectedBtn');
                        editor.value = msg.content;
                        // 通过扩展主进程加载的文件，清除 File API 缓存
                        if (msg.target === 'inputArea') {
                            inputFileContent = null;
                        } else {
                            expectedFileContent = null;
                        }
                        if (msg.filePath) {
                            // 大文件模式：存储完整路径，textarea 只读显示预览
                            if (msg.target === 'inputArea') {
                                inputFilePath = msg.filePath;
                            } else {
                                expectedFilePath = msg.filePath;
                            }
                            editor.readOnly = true;
                            if (hintEl) hintEl.textContent = msg.fileName + ' (' + t('largeFilePreview') + ')';
                            if (clearBtn) clearBtn.style.display = '';
                        } else {
                            // 小文件模式：可编辑，清除文件路径标记
                            if (msg.target === 'inputArea') {
                                inputFilePath = null;
                            } else {
                                expectedFilePath = null;
                            }
                            editor.readOnly = false;
                            if (hintEl) hintEl.textContent = msg.truncated ? (msg.fileName + ' (已截断)') : msg.fileName;
                            if (clearBtn) clearBtn.style.display = '';
                        }
                    }
                    break;
                case 'fileError':
                    const eh = msg.target === 'inputArea' ? $('inputFileHint') : $('expectedFileHint');
                    if (eh) eh.textContent = '读取失败: ' + msg.error;
                    break;
                case 'showHelp':
                    $('helpModal').style.display = 'flex';
                    break;
                case 'compileOptions':
                    // 接收扩展主进程发送的编译选项，更新下拉菜单
                    if (msg.opts) {
                        if (msg.opts.cppStandard) cppStandardSelect.value = msg.opts.cppStandard;
                        if (msg.opts.optimizationLevel) optLevelSelect.value = msg.opts.optimizationLevel;
                        if (msg.opts.warningFlags) warningLevelSelect.value = flagsToWarningLevel(msg.opts.warningFlags);
                    }
                    break;
                case 'running':
                    isRunning = true;
                    runBtn.disabled = true;
                    statusBadge.className = 'status-badge status-running';
                    statusBadge.innerHTML = '<span class="spinner"></span> ' + t('running');
                    outputDisplay.value = ''; stderrDisplay.value = ''; diffView.innerHTML = t('runningElipsis');
                    updateStderrBadge('');
                    break;
                case 'compileWarning':
                    // 仅更新 stderr 显示，不改变状态，不切换标签，用于过编的情况
                    stderrDisplay.value = msg.stderr || '';
                    updateStderrBadge(stderrDisplay.value);
                    break;
                case 'compileError':
                    isRunning = false;
                    runBtn.disabled = false;
                    statusBadge.className = 'status-badge status-ce';
                    statusBadge.innerText = t('ce');
                    outputDisplay.value = '';
                    stderrDisplay.value = msg.stderr || t('compileError');
                    updateStderrBadge(stderrDisplay.value);
                    document.querySelector('.tab[data-tab="stderr"]').click();
                    resultTime.innerText = '-'; resultMemory.innerText = '-'; resultExitCode.innerText = '-';
                    resultMatch.style.display = 'none';
                    resultPerformance.style.display = 'none';
                    break;
                case 'runResult':
                    isRunning = false;
                    runBtn.disabled = false;
                    const r = msg.result;
                    outputDisplay.value = r.stdout || '(' + t('noOutput') + ')';
                    //不清除编译警告
                    if(stderrDisplay.value) {
                        stderrDisplay.value += '\\n';
                    }
                    stderrDisplay.value += "===== cerr / clog =====" + '\\n';
                    stderrDisplay.value += r.stderr || '(' + t('noStderr') + ')';
                    updateStderrBadge(r.stderr);

                    if (r.match === true) {
                        diffView.innerHTML = '<div style="color:#52C41A;padding:6px;">&#10004; ' + t('matchOk') + '</div>';
                    } else if (r.match === false) {
                        renderDiff(diffView, r);
                    } else {
                        diffView.innerHTML = '<div style="color:var(--vscode-descriptionForeground);padding:6px;">' + t('matchSkip') + '</div>';
                    }

                    let finalStatus = r.status;
                    if (finalStatus === 'OK' && r.match === false) {
                        finalStatus = 'WA';
                    }

                    const sm = {
                        'OK': { cls: 'status-ac', text: t('ac') },
                        'WA': { cls: 'status-wa', text: t('wa') },
                        'RE': { cls: 'status-re', text: t('re') },
                        'TLE': { cls: 'status-tle', text: t('tle') },
                        'MLE': { cls: 'status-mle', text: t('mle') },
                        'TLE_HARD': { cls: 'status-tle', text: t('tle') + '!' },
                        'MLE_HARD': { cls: 'status-mle', text: t('mle') + '!' },
                    };
                    const b = sm[finalStatus] || { cls: 'status-idle', text: finalStatus };
                    statusBadge.className = 'status-badge ' + b.cls;
                    statusBadge.innerText = b.text.toUpperCase();
                    resultTime.innerText = r.timeMs !== undefined ? r.timeMs.toFixed(1) + ' ms' : '-';
                    resultMemory.innerText = r.peakMemoryBytes !== undefined ? (r.peakMemoryBytes / 1048576).toFixed(2) + ' MB' : '-';
                    resultExitCode.innerText = r.exitCode !== null ? r.exitCode : '-';

                    // 性能换算显示（含评测机备注和分数来源）
                    if (r.performanceInfo) {
                        const pi = r.performanceInfo;
                        const localizedName = pi.baselineKey === 'ccf' ? t('baselineCcf') : (pi.baselineKey === 'luogu' ? t('baselineLuogu') : pi.baselineName);
                        resultPerfLabel.textContent = localizedName + ':';
                        resultPerfValue.textContent = pi.convertedTimeMs.toFixed(1) + ' ms';
                        resultPerformance.style.display = 'flex';
                        // 显示详情：用户分数、评测机分数、来源
                        const sourceText = pi.scoreSource === 'manual' ? t('manual') : (pi.scoreSource === 'auto' ? t('auto') : t('unknown'));
                        resultPerfDetail.textContent = t('deviceGB6') + ':' + pi.userScore + '(' + sourceText + ') / ' + t('judgeMachine') + ':' + pi.baselineScore;
                        resultPerfDetail.style.display = 'flex';
                        resultPerfDetail.title = pi.baselineNote;
                    } else {
                        resultPerformance.style.display = 'none';
                        resultPerfDetail.style.display = 'none';
                    }

                    // 文件 I/O 信息显示
                    if (r.fileIoInfo) {
                        const parts = [];
                        if (r.fileIoInfo.inputFile) parts.push('输入: ' + r.fileIoInfo.inputFile);
                        if (r.fileIoInfo.outputFile) parts.push('输出: ' + r.fileIoInfo.outputFile);
                        resultFileIoValue.textContent = parts.join(', ');
                        resultFileIo.style.display = 'flex';
                    } else {
                        resultFileIo.style.display = 'none';
                    }

                    if (r.match !== undefined) {
                        resultMatch.style.display = 'flex';
                        resultMatchValue.innerText = r.match ? t('consistent') : t('inconsistent');
                        resultMatchValue.style.color = r.match ? '#52C41A' : '#E74C3C';
                    } else {
                        resultMatch.style.display = 'none';
                    }
                    if (r.match === false) document.querySelector('.tab[data-tab="diff"]').click();
                    break;
            }
        });

        function renderDiff(container, result) {
            if (result.diffSummary) {
                const lines = result.diffSummary.split('\\n');
                container.innerHTML = lines.map(line => {
                    if (line.startsWith('  Line')) {
                        return '<div class="diff-line diff-expected" style="color:#E74C3C;">' + escapeHtml(line) + '</div>';
                    } else if (line.startsWith('    Expected:')) {
                        return '<div class="diff-line diff-expected">' + escapeHtml(line) + '</div>';
                    } else if (line.startsWith('    Actual:')) {
                        return '<div class="diff-line diff-actual">' + escapeHtml(line) + '</div>';
                    } else if (line.trim() === '') return '';
                    return '<div class="diff-line">' + escapeHtml(line) + '</div>';
                }).join('');
            } else {
                container.innerHTML = '<div style="color:var(--vscode-descriptionForeground);padding:6px;">' + t('matchDiff') + '</div>';
            }
        }
        function escapeHtml(text) {
            const d = document.createElement('div'); d.textContent = text; return d.innerHTML;
        }
        // 面板内运行快捷键（从设置 cppRunner.panelRunKey 读取，默认 ctrl+enter）
        // 将按键事件转换为与设置格式一致的字符串进行比较
        function eventToKeyString(e) {
            const parts = [];
            if (e.ctrlKey) parts.push('ctrl');
            if (e.metaKey) parts.push('cmd');
            if (e.shiftKey) parts.push('shift');
            if (e.altKey) parts.push('alt');
            // 规范化按键名称
            let key = e.key.toLowerCase();
            if (key === ' ') key = 'space';
            parts.push(key);
            return parts.join('+');
        }
        document.addEventListener('keydown', (e) => {
            if (!panelRunKey) return;
            const pressed = eventToKeyString(e);
            if (pressed === panelRunKey) { e.preventDefault(); runBtn.click(); }
        });

        // 简易 Markdown 转 HTML（支持标题、段落、列表、代码）
        function markdownToHtml(md) {
            if (!md) return '';
            const lines = md.split('\\n');
            let html = '';
            let inList = false;
            for (let line of lines) {
                const trimmed = line.trim();
                if (trimmed.startsWith('### ')) {
                    if (inList) { html += '</ul>'; inList = false; }
                    html += '<h3 style="font-size:13px; margin:10px 0 4px;">' + escapeHtml(trimmed.slice(4)) + '</h3>';
                } else if (trimmed.startsWith('## ')) {
                    if (inList) { html += '</ul>'; inList = false; }
                    html += '<h3 style="font-size:13px; margin:10px 0 4px;">' + escapeHtml(trimmed.slice(3)) + '</h3>';
                } else if (trimmed.startsWith('# ')) {
                    if (inList) { html += '</ul>'; inList = false; }
                    html += '<h3 style="font-size:13px; margin:10px 0 4px;">' + escapeHtml(trimmed.slice(2)) + '</h3>';
                } else if (trimmed.startsWith('- ') || trimmed.startsWith('  - ')) {
                    if (!inList) { html += '<ul style="margin:4px 0 4px 20px;">'; inList = true; }
                    html += '<li>' + escapeHtml(trimmed.replace(/^\\s*-\\s*/, '')) + '</li>';
                } else if (trimmed === '') {
                    if (inList) { html += '</ul>'; inList = false; }
                } else {
                    if (inList) { html += '</ul>'; inList = false; }
                    html += '<p style="margin:2px 0;">' + escapeHtml(trimmed) + '</p>';
                }
            }
            if (inList) html += '</ul>';
            return html;
        }
    </script>
</body>
</html>`;
    }
}
