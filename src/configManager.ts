import * as vscode from 'vscode';

/**
 * 模块职责 / Module Responsibility:
 *   ConfigManager 负责读写 VSCode settings.json 中 cppRunner 命名空间下的所有配置项，
 *   包括编译器路径、C++ 标准、优化级别、警告标志、输出目录、运行限制阈值（时间/内存）等。
 *   ConfigManager reads and writes all cppRunner configuration entries in VSCode settings.json,
 *   including compiler path, C++ standard, optimization level, warning flags, output directory,
 *   and runtime limit thresholds (time / memory).
 */
export class ConfigManager {
    /**
     * 通用配置读取辅助方法 / Generic config reader helper.
     * @param key 配置项键名 / Configuration key.
     * @param defaultValue 默认值 / Default value if not set.
     * @returns 配置项值 / The configuration value.
     */
    private getConfig<T>(key: string, defaultValue: T): T {
        const config = vscode.workspace.getConfiguration('cppRunner');
        return config.get<T>(key, defaultValue);
    }

    /**
     * 获取编译器可执行文件路径 / Get the compiler executable path.
     * @returns 编译器路径，默认为 'g++' / Compiler path, default 'g++'.
     */
    getCompilerPath(): string {
        return this.getConfig('compilerPath', 'g++');
    }

    /**
     * 获取 C++ 语言标准 / Get the C++ language standard.
     * @returns 标准版本字符串，默认为 'c++17' / Standard version string, default 'c++17'.
     */
    getCppStandard(): string {
        return this.getConfig('cppStandard', 'c++17');
    }

    /**
     * 获取编译优化级别 / Get the compilation optimization level.
     * @returns 优化标志，默认为 '-O2' / Optimization flag, default '-O2'.
     */
    getOptimizationLevel(): string {
        return this.getConfig('optimizationLevel', '-O2');
    }

    /**
     * 获取警告标志列表 / Get the list of warning flags.
     * @returns 警告标志数组，默认 ['-Wall', '-Wextra'] / Warning flags array, default ['-Wall', '-Wextra'].
     */
    getWarningFlags(): string[] {
        return this.getConfig('warningFlags', ['-Wall', '-Wextra']);
    }

    /**
     * 获取编译产物输出目录 / Get the output directory for compiled executables.
     * @returns 输出目录路径，默认为空字符串（与源文件同目录）/ Output directory path, default '' (same as source).
     */
    getOutputDirectory(): string {
        return this.getConfig('outputDirectory', '');
    }

    /**
     * 获取“是否保存实际输出”的行为策略 / Get the 'save actual output' behavior policy.
     * @returns 'always' | 'never' | 'ask'，默认 'never' / Policy, default 'never'.
     */
    getSaveActualOutputBehavior(): 'always' | 'never' | 'ask' {
        return this.getConfig('saveActualOutput', 'never');
    }

    /**
     * 获取性能换算基准评测机 / Get the performance baseline benchmark machine.
     *
     * 评测机版本说明（数据来源：洛谷官方 chen_zhe 2025-02-25）：
     *   - luogu: 洛谷在线评测机 (Intel Xeon Platinum 8369HC, GB6 单核 ~1472)
     *   - ccf: CCF 2025 CSP-S 最新评测机 (Intel Core Ultra 9 285K, GB6 单核 ~2150)
     *     注意 CCF 曾更新评测机：2018-2024 用 i7-8700K (GB6 ~1614)，2025 起用 Core Ultra 9 285K
     *
     * @returns 'none' | 'luogu' | 'ccf'，默认 'luogu' / Baseline, default 'luogu'.
     */
    getPerformanceBaseline(): 'none' | 'luogu' | 'ccf' {
        return this.getConfig('performanceBaseline', 'luogu');
    }

    /**
     * 获取用户手动指定的设备 GeekBench 6 单核分数 /
     * Get the user-specified device GeekBench 6 single-core score.
     *
     * 推荐用户在 https://browser.geekbench.com 查询自己设备的实测分数并填入此处，
     * 以获得更准确的性能换算结果。设为 0 或不设则使用自动基准测试估算。
     *
     * @returns 手动分数，0 表示未指定（使用自动检测）/ Manual score, 0 = auto-detect.
     */
    getUserDeviceGeekbenchScore(): number {
        return this.getConfig('userDeviceGeekbenchScore', 0);
    }

    /**
     * 获取大文件检测阈值（字节）/ Get the large file detection threshold in bytes.
     * @returns 阈值，默认 1 MiB (1048576 bytes) / Threshold, default 1 MiB.
     */
    getLargeFileThreshold(): number {
        return this.getConfig('largeFileThreshold', 1048576);
    }

    /**
     * 获取硬时间限制（毫秒）/ Get the hard time limit in milliseconds.
     *
     * 仅作为系统保护：超过将强制终止并标注 TLE，保护用户设备其他进程不受损害。
     * 注意：软时间限制已按用户要求移除，题目级时限应由程序内部或评测逻辑处理。
     *
     * Only used as system protection: exceeding it forcibly terminates the process
     * (TLE) to safeguard the host. Soft time limit removed per user request.
     *
     * @returns 硬时间限制，默认 60000 ms / Hard time limit, default 60000 ms.
     */
    getTimeLimitHard(): number {
        return this.getConfig('timeLimitHard', 60000);
    }

    /**
     * 获取硬内存限制（字节）/ Get the hard memory limit in bytes.
     *
     * 仅作为系统保护：超过将强制终止并标注 MLE。
     * 软内存限制已按用户要求移除。
     *
     * Only used as system protection: exceeding it forcibly terminates the process (MLE).
     * Soft memory limit removed per user request.
     *
     * @returns 硬内存限制，默认 4 GiB (4294967296 bytes) / Hard memory limit, default 4 GiB.
     */
    getMemoryLimitHard(): number {
        return this.getConfig('memoryLimitHard', 4294967296);
    }

    /**
     * 获取是否忽略行尾空白字符 / Get whether to ignore trailing whitespace.
     * @returns 是否忽略，默认 true / Whether to ignore, default true.
     */
    getIgnoreTrailingWhitespace(): boolean {
        return this.getConfig('ignoreTrailingWhitespace', true);
    }

    /**
     * 获取输入文件支持的扩展名列表 / Get supported input file extensions.
     * @returns 扩展名数组（不带前导点号），默认 ['txt', 'in'] / Extensions array, default ['txt', 'in'].
     */
    getInputFileExtensions(): string[] {
        return this.getConfig('inputFileExtensions', ['txt', 'in']);
    }

    /**
     * 获取预期输出文件支持的扩展名列表 / Get supported expected output file extensions.
     * @returns 扩展名数组（不带前导点号），默认 ['txt', 'out'] / Extensions array, default ['txt', 'out'].
     */
    getExpectedOutputFileExtensions(): string[] {
        return this.getConfig('expectedOutputFileExtensions', ['txt', 'out']);
    }

    /**
     * 获取实际输出文件的扩展名 / Get the extension for actual output files.
     * @returns 扩展名（不带前导点号），默认 'txt' / Extension, default 'txt'.
     */
    getActualOutputExtension(): string {
        return this.getConfig('actualOutputExtension', 'txt');
    }

    /**
     * 通过交互式 QuickPick 设置 C++ 标准和优化级别 /
     * Set C++ standard and optimization level interactively via QuickPick.
     *
     * 该方法会依次弹出两个选择框：C++ 标准（c++11 ~ c++23）和优化级别（-O0 ~ -Os），
     * 并将用户选择持久化到当前 Workspace 的 settings.json 中。
     * It sequentially prompts for C++ standard and optimization level, then persists
     * the choices to the current Workspace settings.json.
     */
    async setCompileOptions() {
        const standard = await vscode.window.showQuickPick(
            ['c++11', 'c++14', 'c++17', 'c++20', 'c++23'],
            { placeHolder: 'Select C++ standard' }
        );
        if (!standard) return;

        const optimization = await vscode.window.showQuickPick(
            ['-O0', '-O1', '-O2', '-O3', '-Os'],
            { placeHolder: 'Select optimization level' }
        );
        if (!optimization) return;

        const config = vscode.workspace.getConfiguration('cppRunner');
        await config.update('cppStandard', standard, vscode.ConfigurationTarget.Workspace);
        await config.update('optimizationLevel', optimization, vscode.ConfigurationTarget.Workspace);
        vscode.window.showInformationMessage(`Compile options set: ${standard}, ${optimization}`);
    }

    /**
     * 通过交互式多选框设置警告标志 / Set warning flags interactively via multi-select QuickPick.
     *
     * 允许用户从预设列表中多选常用警告标志，并可追加自定义标志；结果持久化到 Workspace settings.json。
     * Allows multi-select from a preset list of common warning flags, plus optional custom flags;
     * results are persisted to Workspace settings.json.
     */
    async setWarningLevel() {
        const presets = [
            '-Wall',
            '-Wextra',
            '-Wpedantic',
            '-Werror',
            '-Wshadow',
            '-Wconversion',
            '-Wsign-conversion',
            '-Wunused',
            '-Wnull-dereference',
            '-Wdouble-promotion',
            '-Wformat=2',
            '-Wimplicit-fallthrough',
            '-Wreturn-type',
            '-Wuninitialized'
        ];

        const selected = await vscode.window.showQuickPick(presets, {
            canPickMany: true,
            placeHolder: 'Select warning flags (multi-select)'
        });
        if (selected === undefined) return;

        const custom = await vscode.window.showInputBox({
            placeHolder: 'Additional custom warning flags (space separated, optional)'
        });

        const flags = [...selected];
        if (custom) {
            flags.push(...custom.trim().split(/\s+/));
        }

        const config = vscode.workspace.getConfiguration('cppRunner');
        await config.update('warningFlags', flags, vscode.ConfigurationTarget.Workspace);
        vscode.window.showInformationMessage(`Warning flags set: ${flags.join(' ')}`);
    }
}
