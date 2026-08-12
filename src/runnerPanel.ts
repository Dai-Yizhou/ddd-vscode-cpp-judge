import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { RunResult } from './runner';
import { ConfigManager } from './configManager';
import { getStrings, LocaleCode, LocaleStrings, setLocale } from './locale';

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
    private extensionPath: string;
    private htmlCache: string | undefined;
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
    private lastLocale: { locale: LocaleCode; strings: LocaleStrings } | undefined;
    private lastCompileOptions: CompileOptionsInfo | undefined;
    private lastInitialData: { input: string; expected: string } | undefined;
    private lastPanelRunKey: string | undefined;
    private lastShowControls: string[] | undefined;
    private lastShowResultFields: string[] | undefined;
    private lastHelpContent: string | undefined;

    static getInstance(): RunnerPanelProvider {
        return RunnerPanelProvider.instance;
    }

    constructor(configManager: ConfigManager, extensionPath: string) {
        this.configManager = configManager;
        this.extensionPath = extensionPath;
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
            const locale: LocaleCode = vscode.env.language.startsWith('zh') ? 'zh-CN' : 'en-US';
            setLocale(locale);
            const strings = getStrings();
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

        if (!this.lastShowResultFields) {
            this.lastShowResultFields = this.configManager.getShowResultFields();
            this.post({ command: 'showResultFields', fields: this.lastShowResultFields });
        } else {
            this.post({ command: 'showResultFields', fields: this.lastShowResultFields });
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
        this.lastFileName = fileName || '-';
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
    setLocale(locale: LocaleCode, strings: LocaleStrings) {
        this.lastLocale = { locale, strings };
        this.post({ command: 'locale', locale, strings });
    }

    /** 发送控件显示配置到 Webview */
    setShowControls(controls: string[]) {
        this.lastShowControls = controls;
        this.post({ command: 'showControls', controls });
    }

    /** 发送结果栏显示字段配置到 Webview */
    setShowResultFields(fields: string[]) {
        this.lastShowResultFields = fields;
        this.post({ command: 'showResultFields', fields });
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
        if (this.htmlCache) {
            return this.htmlCache;
        }
        try {
            const templatePath = path.join(this.extensionPath, 'templates', 'runnerPanel.html');
            this.htmlCache = fs.readFileSync(templatePath, 'utf-8');
            return this.htmlCache;
        } catch {
            // 模板文件读取失败时回退到硬编码 HTML（保持兼容性）
            this.htmlCache = this.getFallbackHtml();
            return this.htmlCache;
        }
    }
    /**
     * 回退 HTML：当模板文件读取失败时使用最小化的硬编码 HTML
     */
    private getFallbackHtml(): string {
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
            align-items: center;
            justify-content: center;
            padding: 20px;
        }
        .fallback-error {
            color: var(--vscode-errorForeground);
            text-align: center;
        }
        .fallback-error h2 {
            margin-bottom: 10px;
        }
        .fallback-error p {
            color: var(--vscode-descriptionForeground);
        }
    </style>
</head>
<body>
    <div class="fallback-error">
        <h2>Template Load Failed</h2>
        <p>Could not load runnerPanel.html from templates/ directory.</p>
        <p>Please check the extension installation or reinstall the extension.</p>
    </div>
</body>
</html>`;
    }
}
