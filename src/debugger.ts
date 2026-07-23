/**
 * @fileoverview 调试管理器 / Debugger Manager
 *
 * 职责 (Responsibilities):
 * - 调用 Compiler 编译带调试信息（-g）的 C++ 程序
 *   Invokes the Compiler to compile C++ programs with debug info (-g).
 * - 自动生成或更新 workspace 的 .vscode/launch.json 配置
 *   Auto-generates or updates the workspace .vscode/launch.json configuration.
 * - 启动 VSCode C++ 调试会话（使用 cpptools / cppdbg）
 *   Launches a VSCode C++ debug session (using cpptools / cppdbg).
 */

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { ConfigManager } from './configManager';
import { Compiler } from './compiler';

/**
 * 调试管理器 / Debugger Manager
 *
 * 负责将源文件编译为带调试信息的可执行文件，并配置 launch.json 以支持 VSCode 内置调试器。
 * Responsible for compiling source files into debug-enabled executables and configuring launch.json
 * for the VSCode built-in debugger.
 */
export class DebuggerManager {
    /**
     * 创建调试管理器实例
     * Creates a new DebuggerManager instance.
     *
     * @param configManager - 配置管理器，用于获取编译与调试相关配置 / Config manager for compile and debug settings
     * @param compiler - 编译器实例，用于执行带调试信息的编译 / Compiler instance for debug-enabled compilation
     */
    constructor(
        private configManager: ConfigManager,
        private compiler: Compiler
    ) {}

    /**
     * 启动对指定源文件的调试会话
     * Starts a debug session for the given source file.
     *
     * 流程 (Workflow):
     * 1. 使用 Compiler 编译带 -g 的可执行文件；
     * 2. 确保 workspace 中存在 .vscode/launch.json，并写入/更新对应的 debug 配置；
     * 3. 调用 VSCode debug API 启动调试。
     *
     * @param sourceFile - 要调试的 C++ 源文件绝对路径 / Absolute path of the C++ source file to debug
     */
    async debug(sourceFile: string) {
        // 第一步：编译带调试信息的程序
        // Step 1: Compile the program with debug info
        const compileResult = await this.compiler.compile(sourceFile, true);
        if (!compileResult.success) {
            // 编译失败时提示用户并终止调试流程
            // Notify user and abort debugging if compilation fails
            vscode.window.showErrorMessage('Compilation failed. Cannot start debugging.');
            return;
        }

        // 第二步：确保 launch.json 存在并可写
        // Step 2: Ensure launch.json exists and is writable
        // 获取当前打开的第一个 workspace 文件夹
        // Get the first opened workspace folder
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            vscode.window.showErrorMessage('No workspace folder open.');
            return;
        }

        const vscodeDir = path.join(workspaceFolder.uri.fsPath, '.vscode');
        const launchPath = path.join(vscodeDir, 'launch.json');

        // 若 .vscode 目录不存在则递归创建
        // Create .vscode directory recursively if it doesn't exist
        if (!fs.existsSync(vscodeDir)) {
            fs.mkdirSync(vscodeDir, { recursive: true });
        }

        // 读取已有的 launch.json 配置，若解析失败则回退到默认空配置
        // Read existing launch.json config; fall back to default empty config on parse failure
        let launchConfig: any = { version: '0.2.0', configurations: [] };
        if (fs.existsSync(launchPath)) {
            try {
                launchConfig = JSON.parse(fs.readFileSync(launchPath, 'utf-8'));
            } catch {
                launchConfig = { version: '0.2.0', configurations: [] };
            }
        }

        // 根据源文件名生成唯一的 debug 配置名称
        // Generate a unique debug configuration name based on the source file name
        const configName = `Debug C++: ${path.basename(sourceFile)}`;
        const existingIndex = launchConfig.configurations.findIndex((c: any) => c.name === configName);

        // 根据操作系统选择对应的 MI 调试后端：macOS 使用 lldb，其他使用 gdb
        // Select the appropriate MI debugger backend based on OS: macOS uses lldb, others use gdb
        const platform = os.platform();
        const miMode = platform === 'darwin' ? 'lldb' : 'gdb';

        // 构造 debug 配置对象（适配 VSCode C/C++ 扩展的 cppdbg 类型）
        // Build the debug configuration object (for VSCode C/C++ extension cppdbg type)
        const debugConfig = {
            name: configName,
            type: 'cppdbg',
            request: 'launch',
            program: compileResult.executablePath,
            args: [],
            stopAtEntry: false,
            cwd: path.dirname(sourceFile),
            environment: [],
            externalConsole: false,
            MIMode: miMode,
            preLaunchTask: null
        };

        // 若已存在同名配置则替换，否则追加
        // Replace existing config with the same name, otherwise append
        if (existingIndex >= 0) {
            launchConfig.configurations[existingIndex] = debugConfig;
        } else {
            launchConfig.configurations.push(debugConfig);
        }

        // 写回 launch.json（格式化缩进为 4 个空格）
        // Write back to launch.json with 4-space indentation
        fs.writeFileSync(launchPath, JSON.stringify(launchConfig, null, 4));

        // 第三步：启动调试会话
        // Step 3: Start the debugging session
        await vscode.debug.startDebugging(workspaceFolder, debugConfig);
    }
}
