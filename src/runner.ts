import * as vscode from 'vscode';
import { spawn } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import { ConfigManager } from './configManager';

/**
 * 运行结果数据结构 / Execution result data structure.
 */
export interface RunResult {
    /** 标准输出内容 / Standard output content. */
    stdout: string;
    /** 标准错误内容 / Standard error content. */
    stderr: string;
    /** 进程退出码 / Process exit code. */
    exitCode: number | null;
    /** 终止信号字符串，若未被信号终止则为 null / Signal name if killed by signal, otherwise null. */
    signal: string | null;
    /** 实际运行耗时（毫秒）/ Actual execution time in milliseconds. */
    timeMs: number;
    /** 峰值内存占用（字节）；若无法采样则为 undefined / Peak memory usage in bytes; undefined if sampling unavailable. */
    peakMemoryBytes: number | undefined;
    /**
     * 运行状态 / Execution status:
     *   'OK'      – 正常结束 / Normal exit.
     *   'RE'      – 运行时错误（非零退出或崩溃）/ Runtime error (non-zero exit or crash).
     *   'TLE'     – 超出软时间限制（题目时限）/ Soft time limit exceeded (problem time limit).
     *   'MLE'     – 超出软内存限制（题目内存限制）/ Soft memory limit exceeded (problem memory limit).
     *   'TLE_HARD'– 超出硬时间限制（系统保护）/ Hard time limit exceeded (system protection).
     *   'MLE_HARD'– 超出硬内存限制（系统保护）/ Hard memory limit exceeded (system protection).
     *
     * 软限制由用户在面板上按程序设置，用于判定 TLE/MLE（不强制终止）。
     * 硬限制作为系统保护，超过时强制 SIGKILL。
     */
    status: 'OK' | 'RE' | 'TLE' | 'MLE' | 'TLE_HARD' | 'MLE_HARD';
}

/**
 * 运行选项：支持按程序设置软限制 / Run options with per-program soft limits.
 */
export interface RunOptions {
    /** 软时间限制（毫秒），超过标注 TLE 但不终止。0 表示不限制 / Soft time limit (ms), 0=unlimited. */
    softTimeLimitMs?: number;
    /** 软内存限制（字节），超过标注 MLE 但不终止。0 表示不限制 / Soft memory limit (bytes), 0=unlimited. */
    softMemoryLimitBytes?: number;
}

/**
 * 模块职责 / Module Responsibility:
 *   Runner 负责执行编译生成的可执行文件，支持从文件重定向 stdin，
 *   并在运行期间实时统计资源消耗（时间、内存）。
 *
 *   两层限制机制：
 *     - 软限制（soft limit）：由用户在面板上按程序设置，超过时标注 TLE/MLE 但不强制终止。
 *     - 硬限制（hard limit）：作为系统保护，超过时强制 SIGKILL，防止失控进程损害用户设备。
 *
 *   内存采样优化策略：
 *     - Linux: 直接同步读取 /proc/[pid]/status（无进程生成开销，精度高）
 *     - macOS: 异步 spawn ps 查询（不阻塞事件循环），后代 PID 带缓存避免重复 pgrep
 *     - 活动触发采样：stdout/stderr 有数据时额外采样，捕捉 I/O 附近的内存峰值
 *     - 防重入：samplingInProgress 标志防止异步采样重叠
 */
export class Runner {
    /** 采样进行中标志，防止异步采样重叠 */
    private samplingInProgress = false;
    /** 后代 PID 缓存：key=主 PID，value={pids, timestamp}，避免每次采样都 spawn pgrep */
    private descendantCache: Map<number, { pids: number[]; timestamp: number }> = new Map();
    /** 后代 PID 缓存有效期（毫秒），期间复用上次扫描结果 */
    private static readonly DESCENDANT_CACHE_TTL_MS = 50;

    constructor(
        private configManager: ConfigManager,
        private outputChannel: vscode.OutputChannel
    ) {}

    /**
     * 执行编译产物 / Run the compiled executable.
     *
     * @param executablePath 可执行文件绝对路径 / Absolute path to the executable.
     * @param inputFile 可选的输入文件路径，用于重定向 stdin / Optional input file for stdin redirection.
     * @param options 可选的运行选项（软限制）/ Optional run options (soft limits).
     * @returns RunResult 包含输出、资源统计及状态码 / Result with output, resource stats, and status.
     */
    async run(executablePath: string, inputFile: string | undefined, options?: RunOptions): Promise<RunResult> {
        const timeLimitHard = this.configManager.getTimeLimitHard();
        const memoryLimitHard = this.configManager.getMemoryLimitHard();
        const softTimeLimit = options?.softTimeLimitMs ?? 0;
        const softMemoryLimit = options?.softMemoryLimitBytes ?? 0;

        const startTime = process.hrtime.bigint();
        let peakMemoryBytes = 0;
        let killedByHardLimit = false;
        let killedByTimeHardLimit = false;
        let softTimeExceeded = false;
        let softMemoryExceeded = false;

        // 清理上一次运行的后代缓存，避免 PID 复用导致的误判
        this.descendantCache.clear();
        this.samplingInProgress = false;

        return new Promise((resolve) => {
            const child = spawn(executablePath, [], {
                stdio: ['pipe', 'pipe', 'pipe']
            });

            // 内存采样函数：防重入，异步获取进程树 RSS 并更新峰值
            // Memory sampling function: reentrant-safe, async fetches process tree RSS and updates peak
            const takeSample = () => {
                if (!child.pid) return;
                if (this.samplingInProgress) return;
                this.samplingInProgress = true;
                this.getProcessTreeMemory(child.pid).then((mem) => {
                    this.samplingInProgress = false;
                    if (mem > peakMemoryBytes) {
                        peakMemoryBytes = mem;
                    }
                    if (softMemoryLimit > 0 && mem > softMemoryLimit) {
                        softMemoryExceeded = true;
                    }
                    if (mem > memoryLimitHard) {
                        killedByHardLimit = true;
                        killedByTimeHardLimit = false;
                        child.kill('SIGKILL');
                    }
                }).catch(() => { this.samplingInProgress = false; });
            };

            // Setup input
            if (inputFile && fs.existsSync(inputFile)) {
                const inputStream = fs.createReadStream(inputFile);
                inputStream.pipe(child.stdin);
                // 输入管道完成后采样一次（程序通常在读入后分配内存）
                // Sample once after input pipe ends (programs usually allocate after reading input)
                inputStream.on('end', () => {
                    setTimeout(takeSample, 0);
                });
            } else {
                child.stdin.end();
            }

            // Capture output with streaming for large outputs
            let stdout = '';
            let stderr = '';
            const stdoutChunks: Buffer[] = [];
            const stderrChunks: Buffer[] = [];

            child.stdout.on('data', (chunk: Buffer) => {
                stdoutChunks.push(chunk);
                if (stdout.length < 1024 * 1024) {
                    stdout += chunk.toString();
                }
                // 活动触发采样：stdout 有数据时程序可能在分配内存，额外采样一次
                // Activity-triggered sample: program may allocate memory around I/O
                takeSample();
            });

            child.stderr.on('data', (chunk: Buffer) => {
                stderrChunks.push(chunk);
                if (stderr.length < 1024 * 1024) {
                    stderr += chunk.toString();
                }
                takeSample();
            });

            // 进程就绪后立即采样（不等第一个 interval），捕捉启动阶段的内存分配
            // Immediate sample right after spawn to catch startup allocations
            if (child.pid) {
                takeSample();
            }

            // 内存监控：定时采样
            // Linux: 通过 /proc/[pid]/status 直接读取（同步，无进程生成开销）
            // macOS: 异步 spawn ps 查询，使用 samplingInProgress 防止重叠
            // 采样间隔 10ms（平衡精度与开销）
            const memoryInterval = setInterval(takeSample, 10);

            // 硬时间限制定时器
            const hardTimeout = setTimeout(() => {
                killedByHardLimit = true;
                killedByTimeHardLimit = true;
                child.kill('SIGKILL');
            }, timeLimitHard);

            child.on('close', (code, signal) => {
                clearInterval(memoryInterval);
                clearTimeout(hardTimeout);

                const endTime = process.hrtime.bigint();
                const timeMs = Number(endTime - startTime) / 1e6;

                // 软时间限制检查
                if (softTimeLimit > 0 && timeMs > softTimeLimit) {
                    softTimeExceeded = true;
                }

                // 重建完整输出
                const totalStdoutLen = stdoutChunks.reduce((sum, c) => sum + c.length, 0);
                if (totalStdoutLen > stdout.length) {
                    stdout = Buffer.concat(stdoutChunks).toString('utf-8', 0, Math.min(totalStdoutLen, 10 * 1024 * 1024));
                }
                const totalStderrLen = stderrChunks.reduce((sum, c) => sum + c.length, 0);
                if (totalStderrLen > stderr.length) {
                    stderr = Buffer.concat(stderrChunks).toString('utf-8', 0, Math.min(totalStderrLen, 1024 * 1024));
                }

                // 状态判定逻辑 / Status determination logic:
                // 优先级：硬限制 > 软限制 > RE > OK
                let status: RunResult['status'] = 'OK';
                if (killedByHardLimit) {
                    status = killedByTimeHardLimit ? 'TLE_HARD' : 'MLE_HARD';
                } else if (softTimeExceeded) {
                    status = 'TLE';
                } else if (softMemoryExceeded) {
                    status = 'MLE';
                } else if (code !== 0) {
                    status = 'RE';
                }

                resolve({
                    stdout,
                    stderr,
                    exitCode: code,
                    signal: signal ? signal.toString() : null,
                    timeMs,
                    peakMemoryBytes: peakMemoryBytes > 0 ? peakMemoryBytes : undefined,
                    status,
                });
            });

            child.on('error', (err) => {
                clearInterval(memoryInterval);
                clearTimeout(hardTimeout);

                const endTime = process.hrtime.bigint();
                const timeMs = Number(endTime - startTime) / 1e6;

                resolve({
                    stdout: '',
                    stderr: err.message,
                    exitCode: null,
                    signal: null,
                    timeMs,
                    peakMemoryBytes: undefined,
                    status: 'RE',
                });
            });
        });
    }

    /**
     * 获取进程及其所有子进程的总物理内存占用（RSS）/
     * Get total RSS of a process and all its descendants.
     *
     * 优化策略：
     *   - Linux: 直接读取 /proc/[pid]/status（同步，无进程生成开销）
     *   - macOS: 异步 spawn ps 查询，后代 PID 带缓存（50ms TTL）避免重复 pgrep
     *   - 使用 samplingInProgress 标志防止异步采样重叠
     *
     * @param pid 目标进程 ID / Target process ID.
     * @returns 进程树总内存占用字节数 / Total memory usage in bytes.
     */
    private async getProcessTreeMemory(pid: number): Promise<number> {
        const platform = os.platform();

        if (platform === 'linux') {
            // Linux: 直接读取 /proc/[pid]/status，同步无进程生成开销，精度最高
            return this.getLinuxProcessTreeMemory(pid);
        }

        if (platform === 'darwin') {
            // macOS: 异步查询进程树 RSS
            return this.getMacosProcessTreeMemory(pid);
        }

        if (platform === 'win32') {
            // Windows: 使用 PowerShell 替代已弃用的 wmic
            // wmic 在 Windows 11 22H2+ 已被移除，PowerShell 的 Get-CimInstance 是官方替代方案
            // Windows: use PowerShell instead of deprecated wmic
            try {
                // 查询指定 PID 及其子进程的 WorkingSetSize（内存占用，单位字节）
                const ps = spawn('powershell', [
                    '-NoProfile', '-Command',
                    `Get-CimInstance Win32_Process -Filter "ProcessId=${pid} OR ParentProcessId=${pid}" | Select-Object -ExpandProperty WorkingSetSize`
                ]);
                let output = '';
                ps.stdout.on('data', (data) => { output += data.toString(); });
                return new Promise<number>((resolve) => {
                    ps.on('close', () => {
                        let totalBytes = 0;
                        const lines = output.trim().split(/\r?\n/);
                        for (const line of lines) {
                            const bytes = parseInt(line.trim(), 10);
                            if (!isNaN(bytes)) totalBytes += bytes;
                        }
                        resolve(totalBytes);
                    });
                    ps.on('error', () => resolve(0));
                });
            } catch {
                return 0;
            }
        }
        return 0;
    }

    /**
     * Linux 平台：直接读取 /proc/[pid]/status 获取进程树 RSS。
     * 同步读取，无进程生成开销，比 ps 快几个数量级。
     *
     * 注意：/proc/[pid]/status 中 VmRSS 行格式为 "VmRSS:    1234 kB"，
     * 正则中 \s+ 匹配空白字符（在正则字面量中单反斜杠即可，切勿写成 \\s）。
     */
    private getLinuxProcessTreeMemory(pid: number): number {
        let totalBytes = 0;
        const pids = this.getAllDescendantPidsSync(pid);
        for (const p of pids) {
            try {
                const status = fs.readFileSync(`/proc/${p}/status`, 'utf-8');
                // 正则字面量中 \s 匹配空白字符，\d 匹配数字
                // Regex literal: \s matches whitespace, \d matches digits
                const match = status.match(/VmRSS:\s+(\d+)\s+kB/);
                if (match) {
                    totalBytes += parseInt(match[1], 10) * 1024;
                }
            } catch {
                // 进程可能已退出
            }
        }
        return totalBytes;
    }

    /**
     * macOS 平台：异步查询进程树 RSS。
     *
     * 优化点：
     *   1. 后代 PID 带缓存（50ms TTL），避免每次采样都 spawn pgrep（pgrep 约需 3-8ms）
     *   2. 单次 ps 调用批量查询所有 PID 的 RSS，而非逐个查询
     *   3. 全程异步，不阻塞事件循环，不影响程序运行
     */
    private async getMacosProcessTreeMemory(pid: number): Promise<number> {
        // 获取后代 PID（带缓存）
        const allPids = await this.getCachedDescendantPids(pid);
        if (allPids.length === 0) return 0;

        // 单次 ps 调用批量查询所有 PID 的 RSS（单位 KB）
        const pidArgs = allPids.flatMap(p => ['-p', p.toString()]);
        return new Promise<number>((resolve) => {
            const ps = spawn('ps', ['-o', 'rss=', ...pidArgs]);
            let output = '';
            ps.stdout.on('data', (data) => { output += data.toString(); });
            ps.on('close', () => {
                // 使用 \r?\n 兼容 Windows 风格换行 / Use \r?\n for cross-platform line splitting
                const lines = output.trim().split(/\r?\n/);
                let totalKb = 0;
                for (const line of lines) {
                    const kb = parseInt(line.trim(), 10);
                    if (!isNaN(kb)) totalKb += kb;
                }
                resolve(totalKb * 1024);
            });
            ps.on('error', () => resolve(0));
        });
    }

    /**
     * 获取后代 PID（带缓存），避免每次采样都 spawn pgrep。
     * 缓存有效期 50ms，期间复用上次扫描结果。
     * 对于单进程 C++ 竞赛程序，首次扫描后即返回 [pid]，后续采样直接命中缓存。
     */
    private async getCachedDescendantPids(pid: number): Promise<number[]> {
        const cached = this.descendantCache.get(pid);
        const now = Date.now();
        if (cached && now - cached.timestamp < Runner.DESCENDANT_CACHE_TTL_MS) {
            return cached.pids;
        }

        const pids = await this.getDescendantPidsAsync(pid);
        this.descendantCache.set(pid, { pids, timestamp: now });
        return pids;
    }

    /**
     * 异步递归获取进程的所有后代 PID（包含自身）/
     * Async recursively get all descendant PIDs (including self).
     *
     * 使用 spawn('pgrep', ...) 异步查询，不阻塞事件循环。
     */
    private async getDescendantPidsAsync(pid: number): Promise<number[]> {
        const result: number[] = [pid];
        try {
            const childPids = await this.queryChildPids(pid);
            for (const childPid of childPids) {
                const grandchildren = await this.getDescendantPidsAsync(childPid);
                result.push(...grandchildren);
            }
        } catch {
            // pgrep 不可用时仅返回自身
        }
        return result;
    }

    /**
     * 异步查询指定 PID 的直接子进程列表。
     * 使用 spawn('pgrep', ['-P', pid]) 异步执行，不阻塞事件循环。
     */
    private queryChildPids(pid: number): Promise<number[]> {
        return new Promise<number[]>((resolve) => {
            const p = spawn('pgrep', ['-P', pid.toString()]);
            let out = '';
            p.stdout.on('data', (d) => { out += d.toString(); });
            p.on('close', () => {
                const arr = out.trim().split(/\r?\n/)
                    .filter(s => s.trim())
                    .map(s => parseInt(s.trim(), 10))
                    .filter(n => !isNaN(n));
                resolve(arr);
            });
            p.on('error', () => resolve([]));
        });
    }

    /**
     * 同步递归获取进程的所有后代 PID（仅用于 Linux /proc 读取）/
     * Synchronously get all descendant PIDs (Linux /proc only).
     *
     * Linux 上 /proc/[pid]/task/[tid]/children 可同步读取子进程列表，
     * 但为兼容性仍使用 pgrep。由于 Linux 上读取 /proc 本身极快，
     * 这里的同步开销可接受。
     */
    private getAllDescendantPidsSync(pid: number): number[] {
        const result: number[] = [pid];
        try {
            // 优先尝试读取 /proc/[pid]/task/[pid]/children（Linux 特有，无进程生成）
            const childrenFile = `/proc/${pid}/task/${pid}/children`;
            if (fs.existsSync(childrenFile)) {
                const content = fs.readFileSync(childrenFile, 'utf-8').trim();
                if (content) {
                    const childPids = content.split(/\s+/)
                        .map(s => parseInt(s, 10))
                        .filter(n => !isNaN(n));
                    for (const childPid of childPids) {
                        result.push(...this.getAllDescendantPidsSync(childPid));
                    }
                }
                return result;
            }
        } catch {
            // /proc/.../children 不可用时回退到返回自身
        }
        return result;
    }
}
