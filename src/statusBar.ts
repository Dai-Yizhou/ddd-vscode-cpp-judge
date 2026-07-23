/**
 * @fileoverview 状态栏管理器 / Status Bar Manager
 *
 * 职责 (Responsibilities):
 * - 在 VSCode 右下角状态栏显示当前 C++ 编译选项（标准、优化级别、警告数量）
 *   Displays current C++ compile options (standard, optimization level, warning count) in the VSCode status bar.
 * - 显示与当前源文件关联的输入文件名
 *   Displays the associated input file name for the current source file.
 * - 监听编辑器切换事件，动态更新或隐藏状态栏项
 *   Listens to editor change events to dynamically update or hide status bar items.
 */

import * as vscode from 'vscode';
import { ConfigManager } from './configManager';
import { InputManager } from './inputManager';

/**
 * 状态栏管理器 / Status Bar Manager
 *
 * 实现 vscode.Disposable 接口，支持生命周期管理和自动释放资源。
 * Implements vscode.Disposable for lifecycle management and resource cleanup.
 */
export class StatusBarManager implements vscode.Disposable {
    private compileOptionsItem: vscode.StatusBarItem;
    private inputFileItem: vscode.StatusBarItem;

    /**
     * 创建状态栏管理器实例
     * Creates a new StatusBarManager instance.
     *
     * @param configManager - 配置管理器，用于读取 C++ 标准、优化级别和警告标志 / Config manager for C++ standard, optimization level, and warning flags
     * @param inputManager - 输入管理器，用于获取关联的输入文件信息 / Input manager for retrieving associated input file info
     */
    constructor(
        private configManager: ConfigManager,
        private inputManager: InputManager
    ) {
        // 创建编译选项状态栏项（靠右显示，优先级 100）
        // Create status bar item for compile options (right-aligned, priority 100)
        this.compileOptionsItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
        // 点击时触发设置编译选项命令
        // Clicking triggers the set compile options command
        this.compileOptionsItem.command = 'cppRunner.setCompileOptions';
        this.compileOptionsItem.tooltip = 'Click to set compile options';

        // 创建输入文件状态栏项（靠右显示，优先级 99）
        // Create status bar item for input file (right-aligned, priority 99)
        this.inputFileItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 99);
        // 点击时触发加载输入文件命令
        // Clicking triggers the load input file command
        this.inputFileItem.command = 'cppRunner.loadInputFile';
        this.inputFileItem.tooltip = 'Click to change input file';

        // 订阅编辑器切换事件，活动编辑器变化时自动更新状态栏
        // Subscribe to active editor change event to auto-update the status bar
        vscode.window.onDidChangeActiveTextEditor(() => this.update());
    }

    /**
     * 更新状态栏显示内容
     * Updates the status bar display.
     *
     * 当当前活动编辑器为 C++ 文件时，显示编译选项和关联输入文件；
     * 否则隐藏状态栏项。
     * Shows compile options and associated input file when the active editor is a C++ file;
     * hides the items otherwise.
     */
    update() {
        const editor = vscode.window.activeTextEditor;
        if (!editor || editor.document.languageId !== 'cpp') {
            // 非 C++ 文件时隐藏状态栏项
            // Hide status bar items when not editing a C++ file
            this.compileOptionsItem.hide();
            this.inputFileItem.hide();
            return;
        }

        // 从配置管理器读取编译选项并格式化显示
        // Read compile options from config manager and format for display
        const standard = this.configManager.getCppStandard();
        const optimization = this.configManager.getOptimizationLevel();
        const warnings = this.configManager.getWarningFlags();
        const warningSummary = warnings.length > 0 ? `W${warnings.length}` : 'W0';
        this.compileOptionsItem.text = `$(gear) ${standard} ${optimization} ${warningSummary}`;
        this.compileOptionsItem.show();

        // 获取当前源文件关联的输入文件名并显示
        // Get and display the associated input file name for the current source file
        const sourceFile = editor.document.fileName;
        const inputName = this.inputManager.getInputDisplayName(sourceFile);
        if (inputName) {
            this.inputFileItem.text = `$(file-text) ${inputName}`;
        } else {
            this.inputFileItem.text = `$(file-text) No input`;
        }
        this.inputFileItem.show();
    }

    /**
     * 释放状态栏资源
     * Disposes of the status bar items.
     *
     * 在扩展停用或上下文释放时调用，清理已创建的状态栏项。
     * Called when the extension deactivates or context is disposed to clean up created status bar items.
     */
    dispose() {
        this.compileOptionsItem.dispose();
        this.inputFileItem.dispose();
    }
}
