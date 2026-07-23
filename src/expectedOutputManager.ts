import * as fs from 'fs';
import * as path from 'path';
import { ConfigManager } from './configManager';

/**
 * ============================================================================
 * 模块：预期输出管理器 (Expected Output Manager)
 * ============================================================================
 * 职责：负责与源文件（.cpp）同目录下的预期输出文件的创建、读取、更新和删除操作。
 *       支持多种扩展名（如 .expected.txt、.expected.out），并能自动检测同目录下
 *       与源文件同名的输出文件（如 hello.cpp → hello.out）。
 *       预期输出文件用于在运行 C++ 程序后与实际输出进行比对（diff），
 *       以验证程序行为是否符合期望。
 * ============================================================================
 */

export class ExpectedOutputManager {
    private configManager: ConfigManager;

    /**
     * 创建 ExpectedOutputManager 实例。
     * @param configManager - 配置管理器，用于读取支持的预期输出文件扩展名配置
     */
    constructor(configManager: ConfigManager) {
        this.configManager = configManager;
    }

    /**
     * 根据源文件路径生成对应的预期输出文件路径。
     * 规则：将源文件路径末尾的 `.cpp` 替换为 `.expected.<ext>`，其中 ext 为配置中第一个扩展名。
     * @param sourceFile - 源文件（.cpp）的绝对路径
     * @returns 预期输出文件的绝对路径（使用配置的第一个扩展名）
     */
    getExpectedFilePath(sourceFile: string): string {
        const extensions = this.configManager.getExpectedOutputFileExtensions();
        const ext = extensions.length > 0 ? extensions[0] : 'txt';
        // 大小写不敏感匹配 .cpp / Case-insensitive .cpp match
        return sourceFile.replace(/\.cpp$/i, `.expected.${ext}`);
    }

    /**
     * 获取实际使用的预期输出文件路径。
     * 仅返回用户手动设置的文件，不自动检测同名文件（同一代码可能有多组样例）。
     * @param sourceFile - 源文件（.cpp）的绝对路径
     * @returns 实际存在的预期输出文件路径，或 undefined
     */
    getActualExpectedFilePath(sourceFile: string): string | undefined {
        const expectedPath = this.getExpectedFilePath(sourceFile);
        return fs.existsSync(expectedPath) ? expectedPath : undefined;
    }

    /**
     * 将预期输出内容写入到与源文件对应的预期输出文件中。
     * 文件名格式为 <basename>.expected.<ext>，其中 ext 使用配置的第一个扩展名。
     * 若文件不存在则创建，存在则覆盖。
     * @param sourceFile - 源文件（.cpp）的绝对路径
     * @param content - 要写入的预期输出文本内容
     */
    setExpectedOutput(sourceFile: string, content: string) {
        const filePath = this.getExpectedFilePath(sourceFile);
        fs.writeFileSync(filePath, content);
    }

    /**
     * 读取与源文件对应的预期输出文件内容。
     * 优先读取用户手动设置的文件，其次自动检测同目录下的预期输出文件。
     * @param sourceFile - 源文件（.cpp）的绝对路径
     * @returns 预期输出文件的 UTF-8 内容，若文件不存在则返回 undefined
     */
    getExpectedOutput(sourceFile: string): string | undefined {
        const filePath = this.getActualExpectedFilePath(sourceFile);
        if (!filePath) return undefined;
        return fs.readFileSync(filePath, 'utf-8');
    }

    /**
     * 删除与源文件对应的预期输出文件。
     * 删除所有可能存在的预期输出文件变体（如 .expected.txt、.expected.out、.out 等）。
     * 若文件不存在，则静默跳过，不抛出异常。
     * @param sourceFile - 源文件（.cpp）的绝对路径
     */
    clearExpectedOutput(sourceFile: string) {
        // 使用正则提取 baseName 以支持大小写不敏感的 .cpp 扩展名
        // Use regex to extract baseName for case-insensitive .cpp extension
        const baseName = path.basename(sourceFile).replace(/\.cpp$/i, '');
        const dirName = path.dirname(sourceFile);
        const extensions = this.configManager.getExpectedOutputFileExtensions();
        
        for (const ext of extensions) {
            const expectedPath = path.join(dirName, `${baseName}.expected.${ext}`);
            if (fs.existsSync(expectedPath)) {
                fs.unlinkSync(expectedPath);
            }
            const outputPath = path.join(dirName, `${baseName}.${ext}`);
            if (fs.existsSync(outputPath)) {
                fs.unlinkSync(outputPath);
            }
        }
    }

    /**
     * 检查与源文件对应的预期输出文件是否存在。
     * @param sourceFile - 源文件（.cpp）的绝对路径
     * @returns 若预期输出文件存在则返回 true，否则返回 false
     */
    hasExpectedOutput(sourceFile: string): boolean {
        return this.getActualExpectedFilePath(sourceFile) !== undefined;
    }
}
