import * as fs from 'fs';
import * as path from 'path';

/**
 * ============================================================================
 * 模块：文件 I/O 检测器 (File I/O Detector)
 * ============================================================================
 * 职责：检测 C++ 源文件中是否使用了文件读写（freopen / fopen / fstream），
 *       并提取输入/输出文件名。用于在面板上显示文件 I/O 的输入输出并支持比对。
 *
 * 支持的文件 I/O 模式：
 *   1. freopen("filename", "r", stdin)   → 输入文件
 *   2. freopen("filename", "w", stdout)  → 输出文件
 *   3. fopen("filename", "r")            → 输入文件
 *   4. fopen("filename", "w")            → 输出文件
 *   5. ifstream in("filename")           → 输入文件
 *   6. ofstream out("filename")          → 输出文件
 *
 * OI 题目常见模式：freopen("xxx.in", "r", stdin); freopen("xxx.out", "w", stdout);
 * ============================================================================
 */

/** 检测到的文件 I/O 信息 */
export interface FileIoInfo {
    /** 是否使用了文件 I/O */
    hasFileIo: boolean;
    /** 输入文件名（相对于程序工作目录），无则 undefined */
    inputFile?: string;
    /** 输出文件名（相对于程序工作目录），无则 undefined */
    outputFile?: string;
}

/**
 * 检测 C++ 源文件中的文件 I/O 使用情况。
 *
 * 通过正则匹配源代码中的 freopen / fopen / ifstream / ofstream 调用，
 * 提取输入和输出文件名。支持常见的 OI 文件 I/O 写法。
 *
 * @param sourceFile - C++ 源文件绝对路径
 * @returns 文件 I/O 检测结果
 */
export function detectFileIo(sourceFile: string): FileIoInfo {
    let code: string;
    try {
        code = fs.readFileSync(sourceFile, 'utf-8');
    } catch {
        return { hasFileIo: false };
    }

    // 移除注释（简单处理：移除单行 // 和多行 /* */ 注释）
    // Remove comments to avoid false positives from commented-out code
    const codeNoComments = code
        .replace(/\/\*[\s\S]*?\*\//g, '')   // 多行注释
        .replace(/\/\/[^\n]*/g, '');          // 单行注释

    let inputFile: string | undefined;
    let outputFile: string | undefined;

    // 模式 1: freopen("filename", "r", stdin) — 输入
    // Pattern 1: freopen with "r" mode for stdin
    const freopenInMatch = codeNoComments.match(
        /freopen\s*\(\s*["']([^"']+)["']\s*,\s*["']r["']\s*,\s*stdin\s*\)/
    );
    if (freopenInMatch) {
        inputFile = freopenInMatch[1];
    }

    // 模式 2: freopen("filename", "w", stdout) — 输出
    // Pattern 2: freopen with "w" mode for stdout
    const freopenOutMatch = codeNoComments.match(
        /freopen\s*\(\s*["']([^"']+)["']\s*,\s*["']w["']\s*,\s*stdout\s*\)/
    );
    if (freopenOutMatch) {
        outputFile = freopenOutMatch[1];
    }

    // 模式 3: fopen("filename", "r") — 输入（仅当未通过 freopen 检测到时）
    // Pattern 3: fopen with "r" mode
    if (!inputFile) {
        const fopenInMatch = codeNoComments.match(
            /fopen\s*\(\s*["']([^"']+)["']\s*,\s*["']r[^"']*["']\s*\)/
        );
        if (fopenInMatch) {
            inputFile = fopenInMatch[1];
        }
    }

    // 模式 4: fopen("filename", "w") — 输出
    // Pattern 4: fopen with "w" mode
    if (!outputFile) {
        const fopenOutMatch = codeNoComments.match(
            /fopen\s*\(\s*["']([^"']+)["']\s*,\s*["']w[^"']*["']\s*\)/
        );
        if (fopenOutMatch) {
            outputFile = fopenOutMatch[1];
        }
    }

    // 模式 5: ifstream in("filename") — 输入
    // Pattern 5: ifstream constructor
    if (!inputFile) {
        const ifstreamMatch = codeNoComments.match(
            /ifstream\s+\w+\s*\(\s*["']([^"']+)["']\s*\)/
        );
        if (ifstreamMatch) {
            inputFile = ifstreamMatch[1];
        }
    }

    // 模式 6: ofstream out("filename") — 输出
    // Pattern 6: ofstream constructor
    if (!outputFile) {
        const ofstreamMatch = codeNoComments.match(
            /ofstream\s+\w+\s*\(\s*["']([^"']+)["']\s*\)/
        );
        if (ofstreamMatch) {
            outputFile = ofstreamMatch[1];
        }
    }

    const hasFileIo = inputFile !== undefined || outputFile !== undefined;

    return { hasFileIo, inputFile, outputFile };
}

/**
 * 解析文件 I/O 文件名的绝对路径。
 * 文件名是相对于 C++ 程序运行时的工作目录（即源文件所在目录）。
 *
 * @param sourceFile - C++ 源文件绝对路径
 * @param fileName - 检测到的文件名（可能是相对路径）
 * @returns 绝对路径
 */
export function resolveFileIoPath(sourceFile: string, fileName: string): string {
    // 若已经是绝对路径则直接返回
    if (path.isAbsolute(fileName)) {
        return fileName;
    }
    // 相对于源文件所在目录解析
    return path.join(path.dirname(sourceFile), fileName);
}
