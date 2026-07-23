/**
 * ============================================================================
 * 模块：性能换算计算器 (Performance Calculator)
 * ============================================================================
 * 职责：根据用户设备上的运行时间，计算在标准评测机上的等效运行时间。
 *
 * 换算基准统一采用 GeekBench 6 单核分数（single-core score），
 * 原因：OI 程序通常为单线程，单核分数更能反映实际评测性能。
 *
 * 公开评测机基准配置（数据来源：洛谷官方文章 chen_zhe 2025-02-25）：
 *
 *   洛谷评测机 (Luogu):
 *     - 在线评测机: Intel Xeon Platinum 8369HC @ 3.30GHz
 *       GeekBench 6 单核: ~1472
 *     - 线下评测机: Intel Xeon Platinum 8336C @ 2.30GHz
 *       GeekBench 6 单核: ~1458
 *     （取在线评测机分数 1472 作为代表值）
 *
 *   CCF 评测机 (CCF) — 注意 CCF 曾多次更新评测机：
 *     - 2018-2024 NOIP/CSP-S: Intel Core i7-8700K @ 3.70GHz
 *       GeekBench 6 单核: ~1614
 *     - 2024 联合省选: Intel Core i7-4790 @ 3.60GHz
 *       GeekBench 6 单核: ~1242
 *     - 2025 联合省选: Intel Core i5-11500 @ 2.70GHz
 *       GeekBench 6 单核: ~2008
 *     - 2025 CSP-S（最新）: Intel Core Ultra 9 285K @ 3.70GHz
 *       （关闭睿频与能效核）
 *       GeekBench 6 单核: ~2150
 *     （默认使用 2025 CSP-S 最新评测机分数 2150，并标注版本）
 *
 * 换算公式：
 *   目标时间 = 实际时间 × (用户设备 GB6 单核分数 / 目标评测机 GB6 单核分数)
 *
 * 注意：这是基于 CPU 单核性能的粗略估算，实际运行时间可能因：
 *   - 内存带宽差异
 *   - 缓存命中率
 *   - 编译器版本和优化策略
 *   - 操作系统调度差异
 *   而有所不同。仅供参考。
 *
 * 数据来源：
 *   https://www.luogu.com/article/csoig4zt （2010-2025 年官方赛事评测机）
 * ============================================================================
 */

/** 评测机基准配置 */
export interface BenchmarkConfig {
    /** 评测机显示名称 */
    name: string;
    /** CPU 型号 */
    cpu: string;
    /** 主频描述 */
    clockSpeed: string;
    /** GeekBench 6 单核分数 */
    geekbench6SingleCore: number;
    /** 配置备注（如版本、特殊设置） */
    note: string;
}

/**
 * 已知评测机基准。
 * 使用 GeekBench 6 单核分数作为统一换算基准。
 *
 * 评测机参数来源（洛谷官方整理，2025-02-25 更新）：
 *   https://www.luogu.com/article/csoig4zt
 */
const BENCHMARKS: Record<string, BenchmarkConfig> = {
    /**
     * 洛谷在线评测机
     * CPU: Intel Xeon Platinum 8369HC @ 3.30GHz
     * GeekBench 6 单核: ~1472
     */
    luogu: {
        name: '洛谷评测机',
        cpu: 'Intel Xeon Platinum 8369HC',
        clockSpeed: '3.30 GHz',
        geekbench6SingleCore: 1472,
        note: '洛谷在线评测机（GeekBench 6 单核 ~1472）',
    },

    /**
     * CCF 最新评测机（2025 CSP-S 起）
     * CPU: Intel Core Ultra 9 285K @ 3.70GHz（关闭睿频与能效核）
     * GeekBench 6 单核: ~2150
     *
     * 注意：CCF 评测机已于 2025 年更新。
     *   - 2018-2024 NOIP/CSP-S: i7-8700K (GB6 ~1614)
     *   - 2025 CSP-S（当前）: Core Ultra 9 285K (GB6 ~2150)
     */
    ccf: {
        name: 'CCF评测机 (2025 CSP-S)',
        cpu: 'Intel Core Ultra 9 285K',
        clockSpeed: '3.70 GHz',
        geekbench6SingleCore: 2150,
        note: 'CCF 2025 CSP-S 最新评测机（关闭睿频与能效核，GB6 单核 ~2150）。'
            + '历史参考: 2018-2024 NOIP/CSP-S 用 i7-8700K (GB6 ~1614)',
    },
};

/**
 * 获取评测机配置信息。
 * @param baseline - 评测机类型 ('luogu' | 'ccf')
 * @returns 评测机配置，或 undefined
 */
export function getBenchmark(baseline: string): BenchmarkConfig | undefined {
    return BENCHMARKS[baseline];
}

/**
 * 用户设备性能检测模式：
 *   - 'auto': 通过本地基准测试估算（不够准确，仅供参考）
 *   - 'manual': 用户在设置中手动指定 GeekBench 6 单核分数（推荐）
 *   - 'none': 未检测（不进行换算）
 */
let userDeviceScore: number | undefined;
let userDeviceScoreSource: 'auto' | 'manual' | 'none' = 'none';

/**
 * 获取用户设备的 GeekBench 6 单核分数。
 *
 * 优先级：
 *   1. 手动指定（设置 cppRunner.userDeviceGeekbenchScore > 0 时使用）
 *   2. 自动检测（运行本地基准测试估算）
 *   3. 未检测（返回 0，表示无法换算）
 *
 * @param manualScore - 用户在设置中手动指定的分数（可选）
 * @returns GeekBench 6 单核分数，0 表示未检测
 */
export function getUserDeviceScore(manualScore?: number): number {
    // 优先使用手动指定的分数
    if (manualScore !== undefined && manualScore > 0) {
        if (userDeviceScoreSource !== 'manual' || userDeviceScore !== manualScore) {
            userDeviceScore = manualScore;
            userDeviceScoreSource = 'manual';
        }
        return userDeviceScore;
    }

    // 若已自动检测过，则复用缓存
    if (userDeviceScore !== undefined && userDeviceScoreSource === 'auto') {
        return userDeviceScore;
    }

    // 运行本地基准测试估算 GeekBench 6 单核分数
    // 说明：本地基准测试只能粗略估算，准确性有限。
    //       推荐用户在 https://browser.geekbench.com 查询自己设备的实测分数，
    //       并在设置 cppRunner.userDeviceGeekbenchScore 中手动指定以获得更准确的换算。
    const start = performance.now();

    // 使用计算密集型任务：素数筛法（Eratosthenes 筛）
    // 该任务主要考察 CPU 整数运算和缓存性能，与 OI 程序特征较接近
    const N = 2_000_000;
    const sieve = new Uint8Array(N);
    for (let i = 2; i * i < N; i++) {
        if (sieve[i] === 0) {
            for (let j = i * i; j < N; j += i) {
                sieve[j] = 1;
            }
        }
    }

    const elapsed = performance.now() - start;

    // 校准：在 GeekBench 6 单核 ~2000 分的设备上，此筛法约耗时 8-12ms
    // 使用反比关系估算分数
    const referenceTimeMs = 10; // 参考设备（~2000 分）的耗时
    const referenceScore = 2000;

    if (elapsed <= 0) {
        return 0;
    }

    userDeviceScore = Math.max(1, Math.round((referenceTimeMs / elapsed) * referenceScore));
    userDeviceScoreSource = 'auto';

    return userDeviceScore;
}

/**
 * 重置缓存的用户设备分数（用于设置变更后强制重新检测）。
 */
export function resetUserDeviceScoreCache(): void {
    userDeviceScore = undefined;
    userDeviceScoreSource = 'none';
}

/**
 * 根据用户设备上的运行时间，计算在目标评测机上的等效运行时间。
 * @param actualTimeMs - 用户设备上的实际运行时间（毫秒）
 * @param targetBaseline - 目标评测机类型 ('luogu' | 'ccf')
 * @param manualScore - 用户手动指定的 GeekBench 6 单核分数（可选）
 * @returns 换算后的运行时间（毫秒），若无法换算则返回原始时间
 */
export function convertToBenchmarkTime(
    actualTimeMs: number,
    targetBaseline: string,
    manualScore?: number
): number {
    const benchmark = BENCHMARKS[targetBaseline];
    if (!benchmark) {
        return actualTimeMs;
    }

    const userScore = getUserDeviceScore(manualScore);
    if (userScore <= 0) {
        return actualTimeMs;
    }

    // 换算公式：目标时间 = 实际时间 × (用户设备分数 / 目标设备分数)
    return actualTimeMs * (userScore / benchmark.geekbench6SingleCore);
}

/**
 * 性能换算信息摘要
 */
export interface PerformanceInfo {
    /** 用户设备上的实际运行时间（毫秒） */
    actualTimeMs: number;
    /** 换算后的运行时间（毫秒） */
    convertedTimeMs: number;
    /** 目标评测机名称 */
    baselineName: string;
    /** 目标评测机 CPU 型号 */
    baselineCpu: string;
    /** 用户设备 GeekBench 6 单核分数 */
    userScore: number;
    /** 目标评测机 GeekBench 6 单核分数 */
    baselineScore: number;
    /** 分数来源：'auto'（自动检测）或 'manual'（手动指定） */
    scoreSource: 'auto' | 'manual' | 'none';
    /** 评测机备注信息 */
    baselineNote: string;
}

/**
 * 获取性能换算信息摘要。
 * @param actualTimeMs - 用户设备上的实际运行时间（毫秒）
 * @param targetBaseline - 目标评测机类型 ('luogu' | 'ccf')
 * @param manualScore - 用户手动指定的 GeekBench 6 单核分数（可选）
 * @returns 包含换算结果的信息对象，若不支持则返回 undefined
 */
export function getPerformanceInfo(
    actualTimeMs: number,
    targetBaseline: string,
    manualScore?: number
): PerformanceInfo | undefined {
    const benchmark = BENCHMARKS[targetBaseline];
    if (!benchmark) {
        return undefined;
    }

    const userScore = getUserDeviceScore(manualScore);
    const convertedTimeMs = convertToBenchmarkTime(actualTimeMs, targetBaseline, manualScore);

    return {
        actualTimeMs,
        convertedTimeMs,
        baselineName: benchmark.name,
        baselineCpu: benchmark.cpu,
        userScore,
        baselineScore: benchmark.geekbench6SingleCore,
        scoreSource: userDeviceScoreSource,
        baselineNote: benchmark.note,
    };
}
