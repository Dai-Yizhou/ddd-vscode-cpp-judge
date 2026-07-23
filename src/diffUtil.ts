import * as fs from 'fs';

/**
 * ============================================================================
 * 模块：差异比对工具 (Diff Utility)
 * ============================================================================
 * 职责：提供程序实际输出与预期输出文件之间的逐行差异比对功能。
 *       针对普通文件采用一次性读取后逐行比对；
 *       针对超大文件（>10MB）采用流式逐行读取（stream-based line-by-line）
 *       以避免一次性加载大文件导致内存溢出问题。
 *       支持可选的“忽略行尾空白字符”（ignore trailing whitespace）模式。
 * ============================================================================
 */

/** 差异比对结果接口 */
export interface DiffResult {
    /** 是否完全匹配 */
    match: boolean;
    /** 差异摘要文本，包含前 10 行差异的详细信息 */
    summary: string;
    /** 差异行明细列表 */
    diffs: Array<{ line: number; expected: string; actual: string }>;
}

export class DiffUtil {
    /**
     * 比对实际输出字符串与预期输出文件的内容。
     * 若预期文件大小超过 10MB，则自动降级为流式比对（compareLargeFiles），
     * 以防止一次性读入大文件造成内存压力。
     * @param actualOutput - 程序实际输出的字符串
     * @param expectedFilePath - 预期输出文件（.expected.txt）的绝对路径
     * @param ignoreTrailingWhitespace - 是否忽略每行行尾空白字符（空格、制表符等）
     * @returns 包含匹配状态、摘要和差异明细的 DiffResult
     */
    static async compareOutputs(actualOutput: string, expectedFilePath: string, ignoreTrailingWhitespace: boolean): Promise<DiffResult> {
        const expectedStats = fs.statSync(expectedFilePath);
        // 统一换行符：将 \r\n 和 \r 都规范化为 \n，避免 Windows/Mac 换行符差异导致假阳性比对失败
        // Normalize line endings: convert \r\n and \r to \n to avoid false mismatches across platforms
        const actualLines = actualOutput.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');

        // 大文件阈值：10MB。超过此阈值时切换为流式比对，避免一次性加载超大文件到内存
        if (expectedStats.size > 10 * 1024 * 1024) {
            return this.compareLargeFiles(actualOutput, expectedFilePath, ignoreTrailingWhitespace);
        }

        const expectedOutput = fs.readFileSync(expectedFilePath, 'utf-8');
        // 规范化预期输出的换行符 / Normalize expected output line endings
        const expectedLines = expectedOutput.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');

        const diffs: Array<{ line: number; expected: string; actual: string }> = [];
        const maxLines = Math.max(actualLines.length, expectedLines.length);

        for (let i = 0; i < maxLines; i++) {
            let actual = actualLines[i] || '';
            let expected = expectedLines[i] || '';

            if (ignoreTrailingWhitespace) {
                actual = actual.trimEnd();
                expected = expected.trimEnd();
            }

            if (actual !== expected) {
                diffs.push({ line: i + 1, expected, actual });
            }
        }

        const match = diffs.length === 0;
        let summary = '';
        if (!match) {
            summary = `First ${Math.min(diffs.length, 10)} differing lines (total ${diffs.length}):\n`;
            diffs.slice(0, 10).forEach(d => {
                summary += `  Line ${d.line}:\n`;
                summary += `    Expected: ${d.expected}\n`;
                summary += `    Actual:   ${d.actual}\n`;
            });
        }

        return { match, summary, diffs };
    }

    /**
     * 比对两个字符串的逐行差异（不涉及文件 I/O，不产生临时文件）。
     * @param actualOutput - 程序实际输出字符串
     * @param expectedOutput - 预期输出字符串
     * @param ignoreTrailingWhitespace - 是否忽略行尾空白
     * @returns 包含匹配状态、摘要和差异明细的 DiffResult
     */
    static compareStringOutputs(actualOutput: string, expectedOutput: string, ignoreTrailingWhitespace: boolean): DiffResult {
        // 统一换行符 / Normalize line endings
        const actualLines = actualOutput.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
        const expectedLines = expectedOutput.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
        const diffs: Array<{ line: number; expected: string; actual: string }> = [];
        const maxLines = Math.max(actualLines.length, expectedLines.length);

        for (let i = 0; i < maxLines; i++) {
            let actual = actualLines[i] || '';
            let expected = expectedLines[i] || '';
            if (ignoreTrailingWhitespace) {
                actual = actual.trimEnd();
                expected = expected.trimEnd();
            }
            if (actual !== expected) {
                diffs.push({ line: i + 1, expected, actual });
            }
        }

        const match = diffs.length === 0;
        let summary = '';
        if (!match) {
            summary = `First ${Math.min(diffs.length, 10)} differing lines (total ${diffs.length}):\n`;
            diffs.slice(0, 10).forEach(d => {
                summary += `  Line ${d.line}:\n`;
                summary += `    Expected: ${d.expected}\n`;
                summary += `    Actual:   ${d.actual}\n`;
            });
        }
        return { match, summary, diffs };
    }

    /**
     * 针对超大文件的流式逐行比对。
     * 使用 fs.createReadStream 以流方式读取预期文件，分 chunk 处理并逐行比对，
     * 确保内存占用仅取决于单个 chunk 大小而非整个文件大小。
     * 仅收集前 10 条差异明细用于摘要展示，差异总数（diffCount）完整统计。
     * @param actualOutput - 程序实际输出的字符串
     * @param expectedFilePath - 预期输出文件（.expected.txt）的绝对路径
     * @param ignoreTrailingWhitespace - 是否忽略每行行尾空白字符
     * @returns 包含匹配状态、摘要和差异明细的 DiffResult（Promise）
     */
    private static compareLargeFiles(actualOutput: string, expectedFilePath: string, ignoreTrailingWhitespace: boolean): Promise<DiffResult> {
        const expectedStream = fs.createReadStream(expectedFilePath, { encoding: 'utf-8' });
        // 统一换行符 / Normalize line endings
        const actualLines = actualOutput.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');

        let remaining = '';
        let lineNum = 0;
        let diffCount = 0;
        const diffs: Array<{ line: number; expected: string; actual: string }> = [];
        let match = true;

        expectedStream.on('data', (chunk: string | Buffer) => {
            const chunkStr = typeof chunk === 'string' ? chunk : chunk.toString('utf-8');
            const lines = (remaining + chunkStr).split('\n');
            // 最后一个元素可能是未完结的行（没有尾随换行符），留到下一次 data 事件处理
            remaining = lines.pop() || '';

            for (const line of lines) {
                let expected = line;
                let actual = actualLines[lineNum] || '';

                if (ignoreTrailingWhitespace) {
                    expected = expected.trimEnd();
                    actual = actual.trimEnd();
                }

                if (expected !== actual) {
                    match = false;
                    diffCount++;
                    // 仅保留前 10 条差异明细，用于生成摘要；降低大文件比对时的内存占用
                    if (diffs.length < 10) {
                        diffs.push({ line: lineNum + 1, expected, actual });
                    }
                }
                lineNum++;
            }
        });

        return new Promise((resolve) => {
            expectedStream.on('end', () => {
                // 处理流结束后的最后一行（remaining 中可能残留未处理的尾部文本）
                // 同时处理实际输出比预期文件多出空行的情况（lineNum < actualLines.length）
                if (remaining !== '' || lineNum < actualLines.length) {
                    let expected = remaining;
                    let actual = actualLines[lineNum] || '';
                    if (ignoreTrailingWhitespace) {
                        expected = expected.trimEnd();
                        actual = actual.trimEnd();
                    }
                    if (expected !== actual) {
                        match = false;
                        diffCount++;
                        if (diffs.length < 10) {
                            diffs.push({ line: lineNum + 1, expected, actual });
                        }
                    }
                }

                let summary = '';
                if (!match) {
                    summary = `First ${diffs.length} differing lines (total ${diffCount}):\n`;
                    diffs.forEach(d => {
                        summary += `  Line ${d.line}:\n`;
                        summary += `    Expected: ${d.expected}\n`;
                        summary += `    Actual:   ${d.actual}\n`;
                    });
                }

                resolve({ match, summary, diffs });
            });

            expectedStream.on('error', () => {
                resolve({ match: false, summary: 'Error reading expected output file.', diffs: [] });
            });
        });
    }
}
