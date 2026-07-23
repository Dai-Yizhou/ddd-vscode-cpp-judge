/**
 * @fileoverview 扩展入口 / Extension Entry Point
 *
 * 职责 (Responsibilities):
 * - 注册所有 C++ Runner 命令（编译运行、调试、设置编译选项、加载输入文件等）
 *   Registers all C++ Runner commands (compile & run, debug, set compile options, load input file, etc.).
 * - 初始化各模块实例（ConfigManager、Compiler、Runner、InputManager 等）
 *   Initializes module instances (ConfigManager, Compiler, Runner, InputManager, etc.).
 * - 协调各模块完成“编译 → 运行 → 输出比对 → 保存实际输出”的完整流程
 *   Orchestrates modules to complete the full workflow: compile → run → output comparison → save actual output.
 */

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { ConfigManager } from './configManager';
import { Compiler } from './compiler';
import { Runner, RunResult } from './runner';
import { InputManager } from './inputManager';
import { ExpectedOutputManager } from './expectedOutputManager';
import { DiffUtil } from './diffUtil';
import { DebuggerManager } from './debugger';
import { WebviewInputPanel } from './webviewInputPanel';
import { RunnerPanelProvider, TestCaseResult } from './runnerPanel';
import { getPerformanceInfo } from './performanceCalculator';
import { detectFileIo, resolveFileIoPath } from './fileIoDetector';

let outputChannel: vscode.OutputChannel;
let configManager: ConfigManager;
let compiler: Compiler;
let runner: Runner;
let inputManager: InputManager;
let expectedOutputManager: ExpectedOutputManager;
let debuggerManager: DebuggerManager;
let webviewPanel: WebviewInputPanel | undefined;
let runnerPanelProvider: RunnerPanelProvider | undefined;
let extensionContext: vscode.ExtensionContext;

/**
 * 激活扩展
 * Activates the extension.
 *
 * VSCode 在检测到本扩展被激活时调用此函数。
 * 负责初始化所有模块、创建 OutputChannel、注册命令订阅以及刷新状态栏。
 *
 * @param context - VSCode 扩展上下文，用于注册可自动释放的资源订阅 / VSCode extension context for registering disposable subscriptions
 */
export function activate(context: vscode.ExtensionContext) {
    outputChannel = vscode.window.createOutputChannel('C++ Runner');
    configManager = new ConfigManager();
    compiler = new Compiler(configManager, outputChannel);
    runner = new Runner(configManager, outputChannel);
    inputManager = new InputManager(context, configManager);
    expectedOutputManager = new ExpectedOutputManager(configManager);
    debuggerManager = new DebuggerManager(configManager, compiler);
    extensionContext = context;

    // 将 OutputChannel 加入上下文的订阅列表，实现自动释放
    // Add OutputChannel to context subscriptions for auto-disposal
    context.subscriptions.push(outputChannel);

    // 注册所有命令到 VSCode 命令系统
    // Register all commands into the VSCode command system
    context.subscriptions.push(
        // 编译并运行当前 C++ 文件（从编辑器触发）
        vscode.commands.registerCommand('cppRunner.compileAndRun', compileAndRun),
        // 启动调试会话
        vscode.commands.registerCommand('cppRunner.debug', debug),
        // 在运行面板中触发运行（从面板按钮/快捷键触发）
        vscode.commands.registerCommand('cppRunner.runFromPanel', () => {
            runnerPanelProvider?.triggerRun();
        }),
        // 在运行面板中触发调试
        vscode.commands.registerCommand('cppRunner.debugFromPanel', () => {
            runnerPanelProvider?.triggerDebug();
        }),
        // 设置编译选项（标准、优化级别等）
        vscode.commands.registerCommand('cppRunner.setCompileOptions', setCompileOptions),
        // 设置警告级别
        vscode.commands.registerCommand('cppRunner.setWarningLevel', setWarningLevel),
        // 打开设置页面
        vscode.commands.registerCommand('cppRunner.openSettings', () => {
            vscode.commands.executeCommand('workbench.action.openSettings', 'cppRunner');
        }),
        // 打开 settings.json 配置文件
        vscode.commands.registerCommand('cppRunner.openSettingsJson', () => {
            vscode.commands.executeCommand('workbench.action.openSettingsJson');
        }),
        // 加载外部输入文件
        vscode.commands.registerCommand('cppRunner.loadInputFile', loadInputFile),
        // 设置期望输出
        vscode.commands.registerCommand('cppRunner.setExpectedOutput', setExpectedOutput),
        // 清空输入和期望输出
        vscode.commands.registerCommand('cppRunner.clearInputAndExpected', clearInputAndExpected),
        // 打开输入面板
        vscode.commands.registerCommand('cppRunner.openInputPanel', openInputPanel),
        // 打开可视化运行面板
        vscode.commands.registerCommand('cppRunner.openRunnerPanel', openRunnerPanel)
    );

    // 注册底部面板 WebviewViewProvider
    // Register the bottom panel WebviewViewProvider
    runnerPanelProvider = new RunnerPanelProvider(configManager);
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider('cppRunner.runnerView', runnerPanelProvider)
    );
}

/**
 * 停用扩展
 * Deactivates the extension.
 *
 * VSCode 在扩展被停用时调用，当前无需额外清理（资源已通过 subscriptions 自动释放）。
 * Called by VSCode when the extension is deactivated; no extra cleanup needed since resources are auto-disposed via subscriptions.
 */
export function deactivate() {}

/**
 * 编译并运行当前活动 C++ 文件
 * Compiles and runs the currently active C++ file.
 *
 * 完整流程 (Full workflow):
 * 1. 检查当前活动编辑器是否为 C++ 文件；
 * 2. 调用 Compiler 编译源文件；
 * 3. 调用 Runner 运行生成的可执行文件（如有输入文件则重定向 stdin）；
 * 4. 若存在期望输出文件，则使用 DiffUtil 进行比对；
 * 5. 根据配置策略保存实际输出到 .actual.txt。
 */
async function compileAndRun() {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.languageId !== 'cpp') {
        // 未打开 C++ 文件时提示用户
        // Prompt user when no C++ file is open
        vscode.window.showWarningMessage('Please open a C++ file first.');
        return;
    }

    const sourceFile = editor.document.fileName;
    const inputFile = inputManager.getInputFile(sourceFile);

    // 清空并显示 OutputChannel，准备输出本次运行日志
    // Clear and show the OutputChannel to prepare for this run's logs
    outputChannel.clear();
    outputChannel.show(true);
    outputChannel.appendLine(`=== C++ Runner: ${sourceFile} ===\n`);

    // 编译阶段
    // Compilation phase
    const compileResult = await compiler.compile(sourceFile);
    if (!compileResult.success) {
        outputChannel.appendLine('Compilation failed.');
        return;
    }

    outputChannel.appendLine('Compilation successful.\n');

    // 运行阶段
    // Execution phase
    const runResult = await runner.run(compileResult.executablePath, inputFile);
    displayRunResult(runResult);

    // 与期望输出比对阶段
    // Comparison phase with expected output
    const expectedFile = expectedOutputManager.getExpectedFilePath(sourceFile);
    if (runResult.stdout && expectedFile && fs.existsSync(expectedFile)) {
        const diff = await DiffUtil.compareOutputs(runResult.stdout, expectedFile, configManager.getIgnoreTrailingWhitespace());
        if (diff.match) {
            outputChannel.appendLine('\n✅ Output matches expected output.');
        } else {
            outputChannel.appendLine('\n❌ Output does not match expected output.');
            outputChannel.appendLine(diff.summary);
        }
    }

    // 保存实际输出阶段
    // Save actual output phase
    if (runResult.stdout) {
        await handleSaveOutput(sourceFile, runResult.stdout);
    }
}

/**
 * 在 OutputChannel 中展示运行结果
 * Displays the run result in the OutputChannel.
 *
 * 输出内容包括 stdout、stderr、退出状态码、信号、运行时间及峰值内存。
 * Outputs stdout, stderr, exit status code, signal, execution time, and peak memory.
 *
 * @param result - Runner 返回的运行结果对象 / Run result object returned by the Runner
 */
function displayRunResult(result: RunResult) {
    if (result.stdout) {
        outputChannel.appendLine('--- stdout ---');
        outputChannel.appendLine(result.stdout);
    }
    if (result.stderr) {
        outputChannel.appendLine('--- stderr ---');
        outputChannel.appendLine(result.stderr);
    }

    outputChannel.appendLine(`\n--- Status: ${result.status} ---`);
    if (result.exitCode !== undefined && result.exitCode !== 0) {
        outputChannel.appendLine(`Exit code: ${result.exitCode}`);
    }
    if (result.signal) {
        outputChannel.appendLine(`Signal: ${result.signal}`);
    }
    if (result.timeMs !== undefined) {
        outputChannel.appendLine(`Time: ${result.timeMs.toFixed(2)} ms`);
    }
    if (result.peakMemoryBytes !== undefined) {
        const mb = result.peakMemoryBytes / (1024 * 1024);
        outputChannel.appendLine(`Peak Memory: ${mb.toFixed(2)} MB`);
    }
}

/**
 * 保存程序的实际输出到文件
 * Saves the program's actual output to a file.
 *
 * 根据用户配置（always / ask / never）决定是否保存，以及是否弹窗询问。
 * 保存路径为与源文件同目录下的 .actual.<ext> 文件，扩展名由配置决定。
 *
 * @param sourceFile - 当前 C++ 源文件路径 / Current C++ source file path
 * @param output - 程序的标准输出内容 / Standard output content of the program
 */
async function handleSaveOutput(sourceFile: string, output: string) {
    const behavior = configManager.getSaveActualOutputBehavior();
    if (behavior === 'never') return;

    const ext = configManager.getActualOutputExtension();
    // 大小写不敏感匹配 .cpp（Windows 文件系统大小写不敏感）
    // Case-insensitive .cpp match (Windows filesystem is case-insensitive)
    const actualFile = sourceFile.replace(/\.cpp$/i, `.actual.${ext}`);

    fs.writeFileSync(actualFile, output);
    outputChannel.appendLine(`\nActual output saved to: ${actualFile}`);
}

/**
 * 调试命令处理函数
 * Debug command handler.
 *
 * 检查当前活动编辑器是否为 C++ 文件，然后交由 DebuggerManager 启动调试流程。
 * Checks if the active editor is a C++ file, then delegates to DebuggerManager to start debugging.
 */
async function debug() {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.languageId !== 'cpp') {
        vscode.window.showWarningMessage('Please open a C++ file first.');
        return;
    }
    await debuggerManager.debug(editor.document.fileName);
}

/**
 * 设置编译选项命令处理函数
 * Set compile options command handler.
 *
 * 调用 ConfigManager 弹窗让用户选择 C++ 标准和优化级别，完成后刷新状态栏。
 * Invokes ConfigManager to let the user select C++ standard and optimization level, then refreshes the status bar.
 */
async function setCompileOptions() {
    await configManager.setCompileOptions();
}

/**
 * 设置警告级别命令处理函数
 * Set warning level command handler.
 *
 * 调用 ConfigManager 弹窗让用户选择警告级别，完成后刷新状态栏。
 * Invokes ConfigManager to let the user select the warning level, then refreshes the status bar.
 */
async function setWarningLevel() {
    await configManager.setWarningLevel();
}

/**
 * 加载输入文件命令处理函数
 * Load input file command handler.
 *
 * 打开文件选择对话框（限定 .txt 文件），将选中的文件与当前源文件关联，并更新状态栏。
 * Opens a file picker dialog (restricted to .txt files), associates the selected file with the current source file, and updates the status bar.
 */
async function loadInputFile() {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
        vscode.window.showWarningMessage('Please open a file first.');
        return;
    }

    const inputExtensions = configManager.getInputFileExtensions();
    const uris = await vscode.window.showOpenDialog({
        canSelectMany: false,
        filters: { 'Input Files': inputExtensions }
    });
    if (!uris || uris.length === 0) return;

    const sourceFile = editor.document.fileName;
    inputManager.setInputFile(sourceFile, uris[0].fsPath);
    vscode.window.showInformationMessage(`Input file set: ${uris[0].fsPath}`);
}

/**
 * 设置期望输出命令处理函数
 * Set expected output command handler.
 *
 * 提供两种方式：通过 Webview 面板手动输入，或从外部 .txt 文件加载。
 * 保存的期望输出会在后续 compileAndRun 时自动与实际输出比对。
 *
 * Offers two ways: type via Webview panel or load from an external .txt file.
 * The saved expected output will be automatically compared with actual output in subsequent compileAndRun calls.
 */
async function setExpectedOutput() {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
        vscode.window.showWarningMessage('Please open a file first.');
        return;
    }

    // 让用户选择设置方式
    // Let user choose how to set expected output
    const choice = await vscode.window.showQuickPick(
        ['Type expected output', 'Load from file'],
        { placeHolder: 'How do you want to set expected output?' }
    );
    if (!choice) return;

    const sourceFile = editor.document.fileName;

    if (choice === 'Type expected output') {
        // 创建 Webview 面板供用户输入期望输出
        // Create a Webview panel for user to type expected output
        webviewPanel = new WebviewInputPanel(
            vscode.window.createWebviewPanel(
                'cppRunnerInput',
                'C++ Runner: Expected Output',
                vscode.ViewColumn.One,
                { enableScripts: true, retainContextWhenHidden: true }
            ),
            'expected'
        );
        webviewPanel.onDidSubmit((content) => {
            expectedOutputManager.setExpectedOutput(sourceFile, content);
            vscode.window.showInformationMessage('Expected output saved.');
        });
    } else {
        const outputExtensions = configManager.getExpectedOutputFileExtensions();
        const uris = await vscode.window.showOpenDialog({
            canSelectMany: false,
            filters: { 'Output Files': outputExtensions }
        });
        if (!uris || uris.length === 0) return;

        const content = fs.readFileSync(uris[0].fsPath, 'utf-8');
        expectedOutputManager.setExpectedOutput(sourceFile, content);
        vscode.window.showInformationMessage('Expected output loaded from file.');
    }
}

/**
 * 清空输入与期望输出命令处理函数
 * Clear input and expected output command handler.
 *
 * 清空当前源文件关联的输入文件和期望输出，并刷新状态栏。
 * Clears the associated input file and expected output for the current source file, then refreshes the status bar.
 */
function clearInputAndExpected() {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;
    const sourceFile = editor.document.fileName;
    inputManager.clearInputFile(sourceFile);
    expectedOutputManager.clearExpectedOutput(sourceFile);
    vscode.window.showInformationMessage('Input and expected output cleared.');
}

/**
 * 打开输入面板命令处理函数
 * Open input panel command handler.
 *
 * 打开 Webview 输入面板，允许用户编辑与当前源文件关联的输入数据。
 * 保存后会通过 InputManager 持久化，并触发状态栏更新。
 *
 * Opens a Webview input panel allowing the user to edit input data associated with the current source file.
 * After saving, the input is persisted via InputManager and the status bar is updated.
 */
async function openInputPanel() {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
        vscode.window.showWarningMessage('Please open a file first.');
        return;
    }

    const sourceFile = editor.document.fileName;
    const existingInput = inputManager.getInputContent(sourceFile);

    // 创建 Webview 面板用于编辑输入数据
    // Create a Webview panel for editing input data
    webviewPanel = new WebviewInputPanel(
        vscode.window.createWebviewPanel(
            'cppRunnerInput',
            'C++ Runner: Input',
            vscode.ViewColumn.One,
            { enableScripts: true, retainContextWhenHidden: true }
        ),
        'input',
        existingInput
    );
    webviewPanel.onDidSubmit((content) => {
        inputManager.setInputContent(sourceFile, content);
        vscode.window.showInformationMessage('Input saved.');
    });
}

/**
 * 打开可视化运行面板（底部栏）
 * Opens the visual runner panel in the bottom panel area.
 *
 * 使用 WebviewViewProvider 将面板注册到 VS Code 底部栏，
 * 用户可在面板内直接编辑输入和预期输出，点击"运行"按钮触发编译运行，
 * 运行结果（时间、内存、状态、差异）实时展示在面板中。
 */
async function openRunnerPanel() {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.languageId !== 'cpp') {
        vscode.window.showWarningMessage('请先打开一个 C++ 文件 / Please open a C++ file first.');
        return;
    }

    const sourceFile = editor.document.fileName;
    // 使用 path.basename 跨平台提取文件名（Windows 用 \，Unix 用 /）
    // Use path.basename for cross-platform filename extraction
    const fileName = path.basename(sourceFile);

    // 确保底部面板可见
    vscode.commands.executeCommand('workbench.view.extension.cppRunnerPanel');

    // 显示当前编译目标文件名
    runnerPanelProvider?.setSourceFile(fileName);

    // 发送当前编译选项到面板
    runnerPanelProvider?.sendCompileOptions({
        compilerPath: configManager.getCompilerPath(),
        cppStandard: configManager.getCppStandard(),
        optimizationLevel: configManager.getOptimizationLevel(),
        warningFlags: configManager.getWarningFlags(),
    });

    // 加载已有的输入和预期输出数据并发送到面板
    const existingInput = inputManager.getInputContent(sourceFile);
    const expectedOutput = expectedOutputManager.getExpectedOutput(sourceFile);
    runnerPanelProvider?.setInitialData(existingInput || '', expectedOutput || '');

    // 从 docs/panel-help.md 读取帮助文档并发送到面板（避免硬编码）
    try {
        const helpPath = path.join(extensionContext.extensionPath, 'docs', 'panel-help.md');
        const helpContent = fs.readFileSync(helpPath, 'utf-8');
        runnerPanelProvider?.setHelpContent(helpContent);
    } catch {
        runnerPanelProvider?.setHelpContent('# 帮助文档加载失败\n\n请确认 docs/panel-help.md 文件存在。');
    }

    // 发送面板内运行快捷键设置到 Webview
    const panelRunKey = vscode.workspace.getConfiguration('cppRunner').get<string>('panelRunKey', 'ctrl+enter');
    runnerPanelProvider?.setPanelRunKey(panelRunKey || '');

    // 注册"载入文件"回调：支持点击按钮（打开文件选择器）和拖拽文件（直接读取路径）
    runnerPanelProvider?.onLoadFile(async (target: 'input' | 'expected', fileUri?: string) => {
        let filePath: string;

        if (fileUri) {
            // 拖拽文件：从 fileUri 解析文件路径
            // fileUri 可能是 file:/// URI 或纯路径字符串
            if (fileUri.startsWith('file://')) {
                try {
                    // 使用 vscode.Uri.parse 正确解析所有平台的 file URI
                    // Windows: file:///C:/path → C:\path
                    // Unix: file:///path → /path
                    const uri = vscode.Uri.parse(fileUri);
                    filePath = uri.fsPath;
                } catch {
                    // URI 解析失败时回退：去掉 file:/// 或 file:// 前缀
                    // Fallback: strip file:/// or file:// prefix
                    filePath = fileUri.replace(/^file:\/{2,3}/, '');
                }
            } else {
                filePath = fileUri;
            }
        } else {
            // 点击"载入文件"按钮：打开原生文件选择器
            const extensions = target === 'input'
                ? configManager.getInputFileExtensions()
                : configManager.getExpectedOutputFileExtensions();
            const uris = await vscode.window.showOpenDialog({
                canSelectMany: false,
                filters: { 'Files': extensions }
            });
            if (!uris || uris.length === 0) return;
            filePath = uris[0].fsPath;
        }

        // 使用 path.basename 跨平台提取文件名
        const fileName = path.basename(filePath);
        try {
            const stats = fs.statSync(filePath);
            // 大文件（>1MB）：只读取前 64KB 作为预览，运行时从文件流式读取完整内容
            // 避免 50MB 文件一次性加载到 textarea 导致面板卡顿
            if (stats.size > 1024 * 1024) {
                const previewSize = 64 * 1024;
                const fd = fs.openSync(filePath, 'r');
                const buffer = Buffer.alloc(previewSize);
                const bytesRead = fs.readSync(fd, buffer, 0, previewSize, 0);
                fs.closeSync(fd);
                const preview = buffer.toString('utf-8', 0, bytesRead);
                runnerPanelProvider?.setFileContent(target, preview, fileName, true, filePath);
            } else {
                const content = fs.readFileSync(filePath, 'utf-8');
                runnerPanelProvider?.setFileContent(target, content, fileName, false);
            }
        } catch (err: any) {
            vscode.window.showErrorMessage(`读取文件失败: ${err.message}`);
        }
    });

    // 注册编译选项变更回调：用户在面板上修改编译选项时，持久化到 settings.json
    runnerPanelProvider?.onCompileOptionsChange(async (opts: { cppStandard: string; optimizationLevel: string; warningFlags: string[] }) => {
        const config = vscode.workspace.getConfiguration('cppRunner');
        await config.update('cppStandard', opts.cppStandard, vscode.ConfigurationTarget.Workspace);
        await config.update('optimizationLevel', opts.optimizationLevel, vscode.ConfigurationTarget.Workspace);
        await config.update('warningFlags', opts.warningFlags, vscode.ConfigurationTarget.Workspace);
    });

    // 注册运行回调（含软限制参数和大文件路径）
    runnerPanelProvider?.onRun(async (input: string, expected: string, softLimits?: { timeMs: number; memoryMB: number }, inputFilePath?: string, expectedFilePath?: string) => {
        // 保存用户在面板中编辑的输入（大文件模式下 input 为空，使用文件路径）
        if (inputFilePath) {
            inputManager.setInputFile(sourceFile, inputFilePath);
        } else {
            inputManager.setInputContent(sourceFile, input);
        }

        runnerPanelProvider?.setRunning();

        // 编译阶段
        const compileResult = await compiler.compile(sourceFile);
        if (!compileResult.success) {
            runnerPanelProvider?.showCompileError(compileResult.stderr || '编译失败（无 stderr 输出）');
            try { fs.unlinkSync(compileResult.executablePath); } catch {}
            return;
        }

        // 文件 I/O 检测：检测源程序是否使用了 freopen/fopen/fstream
        // 若使用文件 I/O，则将面板输入写入程序期望的输入文件，运行后从输出文件读取结果
        const fileIoInfo = detectFileIo(sourceFile);
        let stdinInputFile: string | undefined;
        let fileOutputPath: string | undefined;

        if (fileIoInfo.hasFileIo) {
            // 若检测到输入文件，将输入内容写入该文件
            if (fileIoInfo.inputFile) {
                const targetInputPath = resolveFileIoPath(sourceFile, fileIoInfo.inputFile);
                if (inputFilePath) {
                    // 大文件：直接复制文件，避免一次性读取到内存
                    fs.copyFileSync(inputFilePath, targetInputPath);
                } else if (input.trim()) {
                    fs.writeFileSync(targetInputPath, input);
                }
                stdinInputFile = undefined;
            }
            // 记录输出文件路径，运行后读取
            if (fileIoInfo.outputFile) {
                fileOutputPath = resolveFileIoPath(sourceFile, fileIoInfo.outputFile);
            }
        } else {
            // 无文件 I/O：通过 stdin 管道传入输入
            // 大文件模式下直接用文件路径作为 stdin 源（Runner 内部用 createReadStream 流式读取）
            if (inputFilePath) {
                stdinInputFile = inputFilePath;
            } else {
                stdinInputFile = inputManager.getInputFile(sourceFile);
            }
        }

        // 运行阶段（传入面板上设置的软限制）
        const runOptions = softLimits && (softLimits.timeMs > 0 || softLimits.memoryMB > 0) ? {
            softTimeLimitMs: softLimits.timeMs > 0 ? softLimits.timeMs : undefined,
            softMemoryLimitBytes: softLimits.memoryMB > 0 ? softLimits.memoryMB * 1024 * 1024 : undefined,
        } : undefined;
        const runResult = await runner.run(compileResult.executablePath, stdinInputFile, runOptions);

        // 若程序使用文件 I/O 输出，从输出文件读取实际输出
        let actualOutput = runResult.stdout;
        if (fileOutputPath && fs.existsSync(fileOutputPath)) {
            try {
                const fileContent = fs.readFileSync(fileOutputPath, 'utf-8');
                actualOutput = fileContent;
            } catch {
                // 读取失败时回退到 stdout
            }
        }

        // 运行后清理可执行文件
        try { fs.unlinkSync(compileResult.executablePath); } catch {}

        // 比对阶段：内存中字符串比对，不产生临时文件
        let match: boolean | undefined;
        let diffSummary: string | undefined;

        // 大文件预期输出：从文件完整读取（50MB 可接受内存占用）
        const expectedContent = expectedFilePath ? fs.readFileSync(expectedFilePath, 'utf-8') : expected;
        if (expectedContent.trim()) {
            const diff = DiffUtil.compareStringOutputs(
                actualOutput,
                expectedContent,
                configManager.getIgnoreTrailingWhitespace()
            );
            match = diff.match;
            if (!diff.match) {
                diffSummary = diff.summary;
            }
        }

        // 性能换算（使用 GeekBench 6 单核分数，支持用户手动指定设备分数）
        const baseline = configManager.getPerformanceBaseline();
        const userScore = configManager.getUserDeviceGeekbenchScore();
        const performanceInfo = baseline !== 'none' && runResult.timeMs !== undefined
            ? getPerformanceInfo(runResult.timeMs, baseline, userScore > 0 ? userScore : undefined)
            : undefined;

        const testCaseResult: TestCaseResult = {
            status: runResult.status,
            timeMs: runResult.timeMs,
            peakMemoryBytes: runResult.peakMemoryBytes,
            exitCode: runResult.exitCode,
            stdout: actualOutput,
            stderr: runResult.stderr,
            diffSummary,
            match,
            performanceInfo,
            fileIoInfo: fileIoInfo.hasFileIo ? {
                inputFile: fileIoInfo.inputFile,
                outputFile: fileIoInfo.outputFile,
            } : undefined,
        };
        runnerPanelProvider?.showRunResult(testCaseResult);

        outputChannel.clear();
        outputChannel.appendLine(`=== C++ Runner: ${sourceFile} ===\n`);
        // 文件 I/O 模式下 stdout 可能不含实际输出，用 actualOutput 替代显示
        const displayResult = { ...runResult, stdout: actualOutput };
        displayRunResult(displayResult);

        if (actualOutput) {
            await handleSaveOutput(sourceFile, actualOutput);
        }
    });

    // 注册调试回调
    runnerPanelProvider?.onDebug(async () => {
        await debuggerManager.debug(sourceFile);
    });
}
