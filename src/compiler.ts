import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { spawn } from 'child_process';
import { ConfigManager } from './configManager';

/**
 * 编译结果数据结构 / Compilation result data structure.
 */
export interface CompileResult {
    /** 编译是否成功 / Whether compilation succeeded. */
    success: boolean;
    /** 生成的可执行文件绝对路径 / Absolute path of the generated executable. */
    executablePath: string;
    /** 解析后的诊断信息列表，用于填充 VSCode Problems 面板 / Parsed diagnostics for the VSCode Problems panel. */
    diagnostics: vscode.Diagnostic[];
    /** 编译器原始 stderr 输出（含完整错误/警告信息）/ Raw compiler stderr output. */
    stderr: string;
}

/**
 * 模块职责 / Module Responsibility:
 *   Compiler 负责调用外部 C++ 编译器（g++ / clang++）对源文件进行编译，
 *   并实时解析 stderr 中的诊断信息（warning / error / note），将其转换为 VSCode Diagnostic
 *   对象后推送到 Problems 面板，方便用户定位代码问题。
 *   Compiler invokes the external C++ compiler (g++ / clang++) to compile source files,
 *   parses diagnostics (warning / error / note) from stderr in real time, and pushes them
 *   to the VSCode Problems panel as Diagnostic objects for easy navigation.
 */
export class Compiler {
    private diagnosticCollection: vscode.DiagnosticCollection;
    /**
     * C++ 标准支持情况缓存（按 "compilerPath|standard" 键存储）。
     * 避免对同一编译器重复探测同一标准是否被支持。
     * Cache of C++ standard support flags keyed by "compilerPath|standard",
     * to avoid repeatedly probing the same compiler for the same standard.
     */
    private stdSupportCache: Map<string, boolean> = new Map();
    /**
     * 当前编译器已确认可用的最高 C++ 标准（避免每次编译都触发回退探测）。
     * The highest confirmed-working C++ standard for the current compiler.
     */
    private workingStandard: string | undefined;

    /**
     * @param configManager 配置管理器实例，用于获取编译参数 / ConfigManager instance for compiler options.
     * @param outputChannel VSCode 输出通道，用于打印编译日志 / VSCode output channel for compilation logs.
     */
    constructor(
        private configManager: ConfigManager,
        private outputChannel: vscode.OutputChannel
    ) {
        // 创建一个专属于 cppRunner 的诊断集合，生命周期与扩展一致
        // Create a diagnostic collection scoped to cppRunner, tied to extension lifecycle.
        this.diagnosticCollection = vscode.languages.createDiagnosticCollection('cppRunner');
    }

    /**
     * 探测编译器是否支持指定的 -std 标志 / Probe whether the compiler supports a given -std flag.
     *
     * 通过运行 `<compiler> -std=c++XX -x c++ -E -`（空输入预处理）来判定：
     *   - 退出码 0 → 支持 / supported
     *   - 非 0（通常 stderr 含 "unrecognized command-line option"）→ 不支持 / unsupported
     *
     * 结果会缓存到 stdSupportCache，避免重复探测开销。
     * Results are cached in stdSupportCache to avoid repeated probes.
     *
     * @param compilerPath 编译器可执行文件路径 / Compiler executable path.
     * @param standard C++ 标准字符串（如 'c++23'）/ C++ standard string (e.g. 'c++23').
     * @returns 是否支持 / Whether supported.
     */
    private async isStdSupported(compilerPath: string, standard: string): Promise<boolean> {
        const cacheKey = `${compilerPath}|${standard}`;
        const cached = this.stdSupportCache.get(cacheKey);
        if (cached !== undefined) {
            return cached;
        }

        return new Promise((resolve) => {
            // -x c++ 强制按 C++ 处理输入；-E 仅预处理（快速）；- 从 stdin 读取（空输入）
            // -x c++ forces C++ input; -E only preprocesses (fast); - reads from stdin (empty).
            const proc = spawn(compilerPath, [`-std=${standard}`, '-x', 'c++', '-E', '-'], {
                stdio: ['pipe', 'ignore', 'ignore']
            });
            proc.stdin.end();
            proc.on('close', (code) => {
                const supported = code === 0;
                this.stdSupportCache.set(cacheKey, supported);
                resolve(supported);
            });
            proc.on('error', () => {
                // 编译器不可用时记为不支持，让上层走错误处理流程
                // If the compiler itself cannot be spawned, treat as unsupported.
                this.stdSupportCache.set(cacheKey, false);
                resolve(false);
            });
        });
    }

    /**
     * 根据用户请求的 C++ 标准生成回退链 / Build a fallback chain for the requested C++ standard.
     *
     * 用于处理“编译器不支持 c++23”等情形：
     *   - c++23 → c++23, c++2b, c++20, c++2a, c++17
     *   - c++20 → c++20, c++2a, c++17
     *   - 其它 → 仅自身
     *
     * Used when the compiler does not support e.g. c++23:
     * the chain tries the standardized name first, then the pre-standardization alias.
     *
     * @param standard 用户配置的 C++ 标准 / The user-configured C++ standard.
     * @returns 按优先级排列的候选标准列表 / Ordered candidate standards.
     */
    private stdFallbackChain(standard: string): string[] {
        switch (standard) {
            case 'c++23':
                return ['c++23', 'c++2b', 'c++20', 'c++2a', 'c++17'];
            case 'c++20':
                return ['c++20', 'c++2a', 'c++17'];
            default:
                return [standard];
        }
    }

    /**
     * 解析实际可用的 C++ 标准（带自动回退）/ Resolve the effective C++ standard with auto-fallback.
     *
     * 若用户请求的标准不被编译器支持，则按回退链尝试更低的等价标准，
     * 并通过 OutputChannel 提示用户已发生回退。
     * If the requested standard is unsupported, tries lower equivalents in the fallback chain
     * and notifies the user via the OutputChannel.
     *
     * @param compilerPath 编译器路径 / Compiler path.
     * @param requested 用户请求的标准 / Requested standard.
     * @returns 实际可用的标准 / Effective standard.
     */
    private async resolveStandard(compilerPath: string, requested: string): Promise<string> {
        // 若此前已为该编译器找到可用标准，且请求值不低于该标准，则直接复用缓存
        // Reuse cached working standard when available to avoid repeated probing.
        const chain = this.stdFallbackChain(requested);
        for (const candidate of chain) {
            if (await this.isStdSupported(compilerPath, candidate)) {
                if (candidate !== requested) {
                    this.outputChannel.appendLine(
                        `⚠️ 编译器不支持 -std=${requested}，已自动回退到 -std=${candidate}。` +
                        `（c++23 需 g++ 13+ / clang++ 17+；可在设置 cppRunner.cppStandard 中调整。）`
                    );
                }
                this.workingStandard = candidate;
                return candidate;
            }
        }
        // 回退链全部不支持：返回原始请求，让编译器输出真实错误信息供用户排查
        // None supported: return the original so the compiler emits its real error message.
        return requested;
    }

    /**
     * 编译指定源文件 / Compile the given source file.
     *
     * @param sourceFile 源文件绝对路径 / Absolute path to the C++ source file.
     * @param debug 是否启用调试模式（-O0 -g）；默认 false / Whether to enable debug mode (-O0 -g); default false.
     * @returns CompileResult 包含成功状态、产物路径及诊断信息 / Result containing success status, executable path, and diagnostics.
     */
    async compile(sourceFile: string, debug: boolean = false): Promise<CompileResult> {
        const compilerPath = this.configManager.getCompilerPath();
        // 解析实际可用的 C++ 标准：若编译器不支持用户请求的标准（如 c++23）则自动回退
        // Resolve the effective standard: auto-fallback if the compiler doesn't support the requested one (e.g. c++23).
        const standard = await this.resolveStandard(compilerPath, this.configManager.getCppStandard());
        const optimization = debug ? '-O0' : this.configManager.getOptimizationLevel();
        const warningFlags = this.configManager.getWarningFlags();
        const outputDir = this.configManager.getOutputDirectory();

        // 根据源文件名推导产物文件名，并区分 Windows (.exe) 与 Unix / macOS
        // Derive executable name from source filename; differentiate Windows (.exe) vs Unix / macOS.
        const baseName = path.basename(sourceFile, path.extname(sourceFile));
        const isWindows = os.platform() === 'win32';
        const exeSuffix = isWindows ? '.exe' : '';
        const executablePath = outputDir
            ? path.join(outputDir, baseName + exeSuffix)
            : sourceFile.replace(/\.cpp$/i, '') + exeSuffix;

        // Ensure output directory exists
        // 若用户指定了输出目录但目录不存在，则递归创建，防止编译器因目录缺失而报错
        if (outputDir && !fs.existsSync(outputDir)) {
            fs.mkdirSync(outputDir, { recursive: true });
        }

        const args = [
            `-std=${standard}`,
            optimization,
            ...warningFlags,
            ...(debug ? ['-g'] : []),
            '-o', executablePath,
            sourceFile
        ];

        this.outputChannel.appendLine(`Compiling: ${compilerPath} ${args.join(' ')}`);

        return new Promise((resolve) => {
            const process = spawn(compilerPath, args);
            let stderr = '';

            // 聚合编译器标准错误输出，用于后续诊断解析
            // Aggregate compiler stderr for later diagnostic parsing.
            process.stderr.on('data', (data) => {
                stderr += data.toString();
            });

            process.on('close', (code) => {
                // 进程结束后立即解析诊断并更新 Problems 面板
                // Parse diagnostics and update the Problems panel immediately after the process exits.
                const diagnostics = this.parseDiagnostics(stderr, sourceFile);
                this.diagnosticCollection.set(vscode.Uri.file(sourceFile), diagnostics);

                if (code === 0) {
                    resolve({ success: true, executablePath, diagnostics, stderr });
                } else {
                    this.outputChannel.appendLine(stderr);
                    resolve({ success: false, executablePath, diagnostics, stderr });
                }
            });

            process.on('error', (err) => {
                this.outputChannel.appendLine(`Compiler error: ${err.message}`);
                resolve({ success: false, executablePath, diagnostics: [], stderr: err.message });
            });
        });
    }

    /**
     * 解析编译器 stderr 输出，提取诊断信息 / Parse compiler stderr to extract diagnostics.
     *
     * 匹配 GCC/Clang 风格的诊断格式：
     *   file.cpp:10:5: warning: ...
     *   file.cpp:10:5: error: ...
     * 并将其映射为 VSCode Diagnostic 对象。
     *
     * Matches GCC/Clang style diagnostic lines and maps them to VSCode Diagnostic objects.
     *
     * @param stderr 编译器标准错误输出 / Compiler stderr output.
     * @param sourceFile 源文件路径（用于与诊断中的文件名比对）/ Source file path for comparison.
     * @returns VSCode Diagnostic 数组 / Array of VSCode Diagnostics.
     */
    private parseDiagnostics(stderr: string, sourceFile: string): vscode.Diagnostic[] {
        const diagnostics: vscode.Diagnostic[] = [];
        // Match patterns like:
        // file.cpp:10:5: warning: ...
        // file.cpp:10:5: error: ...
        // Windows paths contain colons (C:\code\test.cpp), so we use a non-greedy
        // match for the filename that stops at the LAST colon before line:col:severity.
        // Strategy: match (anything):(digits):(digits):(severity):(message)
        // The filename part uses [\s\S]*? (non-greedy) to handle Windows drive letters.
        const regex = /(.+?):(\d+):(\d+):\s*(warning|error|note):\s*(.+)/g;
        let match;

        while ((match = regex.exec(stderr)) !== null) {
            const [, file, lineStr, colStr, severityStr, message] = match;
            // 行号/列号在 VSCode API 中从 0 开始，而编译器输出从 1 开始，因此减 1
            // VSCode API uses 0-based line/col, while compiler output is 1-based; subtract 1.
            const line = parseInt(lineStr, 10) - 1;
            const col = parseInt(colStr, 10) - 1;

            let severity = vscode.DiagnosticSeverity.Information;
            if (severityStr === 'error') severity = vscode.DiagnosticSeverity.Error;
            else if (severityStr === 'warning') severity = vscode.DiagnosticSeverity.Warning;

            const range = new vscode.Range(line, col, line, col + 1);
            const diagnostic = new vscode.Diagnostic(range, message, severity);
            diagnostic.source = 'C++ Runner';
            diagnostics.push(diagnostic);
        }

        return diagnostics;
    }
}
