import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { ConfigManager } from './configManager';

/**
 * ============================================================================
 * 模块：输入管理器 (Input Manager)
 * ============================================================================
 * 职责：维护源文件（.cpp）与输入文件/输入内容之间的关联关系。
 *       支持两种输入模式：
 *         1) 文件模式 (file)：关联一个外部输入文件路径（支持 .txt、.in 等扩展名）；
 *         2) 内容模式 (content)：将用户在 Webview 面板中输入的多行文本
 *            持久化到临时文件，并关联该临时文件路径。
 *       支持自动检测同目录下与源文件同名的输入文件（如 hello.cpp → hello.in）。
 *       所有关联关系通过 vscode.ExtensionContext.workspaceState 进行跨会话
 *       持久化，确保用户在重启 VS Code 后仍能保留之前的输入配置。
 * ============================================================================
 */

interface InputAssociation {
    [sourceFile: string]: {
        type: 'file' | 'content';
        value: string;
    };
}

export class InputManager {
    private associations: InputAssociation = {};
    private context: vscode.ExtensionContext;
    private configManager: ConfigManager;

    /**
     * 创建 InputManager 实例，并从 workspaceState 恢复已保存的关联关系。
     * @param context - VS Code 扩展上下文，用于访问 workspaceState 持久化存储
     * @param configManager - 配置管理器，用于读取支持的输入文件扩展名配置
     */
    constructor(context: vscode.ExtensionContext, configManager: ConfigManager) {
        this.context = context;
        this.configManager = configManager;
        const saved = context.workspaceState.get<InputAssociation>('cppRunner.inputAssociations');
        if (saved) {
            this.associations = saved;
        }
    }

    /**
     * 将当前关联关系持久化保存到 workspaceState。
     * 私有方法，任何修改 associations 的操作后都应调用此方法。
     */
    private save() {
        this.context.workspaceState.update('cppRunner.inputAssociations', this.associations);
    }

    /**
     * 为指定源文件设置外部输入文件路径关联。
     * @param sourceFile - 源文件（.cpp）的绝对路径
     * @param inputFilePath - 输入文件（.txt）的绝对路径
     */
    setInputFile(sourceFile: string, inputFilePath: string) {
        this.associations[sourceFile] = { type: 'file', value: inputFilePath };
        this.save();
    }

    /**
     * 为指定源文件设置输入内容。
     * 若内容以 `[FILE:路径]` 标记开头（来自 Webview 拖拽文件时的特殊标记），
     * 则直接转为文件关联模式；否则将内容写入临时文件并关联该临时文件。
     * @param sourceFile - 源文件（.cpp）的绝对路径
     * @param content - 用户输入的文本内容，或文件标记字符串
     */
    setInputContent(sourceFile: string, content: string) {
        // 处理来自 Webview 拖拽的文件关联标记（如 "[FILE:/path/to/file.txt]"）
        const fileMarkerMatch = content.match(/^\[FILE:(.+)\]$/);
        if (fileMarkerMatch) {
            const filePath = fileMarkerMatch[1];
            if (fs.existsSync(filePath)) {
                this.associations[sourceFile] = { type: 'file', value: filePath };
                this.save();
                return;
            }
        }

        // 将内容写入临时文件，以便 Runner 通过标准输入重定向使用
        let tempDir: string;
        try {
            // 优先使用扩展全局存储目录（globalStorageUri），其生命周期由 VS Code 管理
            tempDir = path.join(this.context.globalStorageUri.fsPath, 'inputs');
        } catch {
            // 若 globalStorageUri 不可用（极少数情况），回退到系统临时目录
            tempDir = path.join(os.tmpdir(), 'vscode-cpp-runner-inputs');
        }
        if (!fs.existsSync(tempDir)) {
            fs.mkdirSync(tempDir, { recursive: true });
        }
        // 使用源文件路径的 Base64 哈希作为临时文件名，确保同一源文件始终映射到同一临时文件
        const hash = Buffer.from(sourceFile).toString('base64').replace(/[^a-zA-Z0-9]/g, '');
        const tempFile = path.join(tempDir, `${hash}.txt`);
        fs.writeFileSync(tempFile, content);
        this.associations[sourceFile] = { type: 'file', value: tempFile };
        this.save();
    }

    /**
     * 获取与源文件关联的输入文件路径。
     * 仅返回用户手动设置的关联文件，不自动检测同名文件（同一代码可能有多组样例）。
     * @param sourceFile - 源文件（.cpp）的绝对路径
     * @returns 输入文件的绝对路径，或 undefined
     */
    getInputFile(sourceFile: string): string | undefined {
        const assoc = this.associations[sourceFile];
        if (assoc && assoc.type === 'file' && fs.existsSync(assoc.value)) {
            return assoc.value;
        }
        return undefined;
    }

    /**
     * 获取与源文件关联的输入文件内容文本。
     * 若文件超过 1MB，则不读取完整内容，返回占位提示字符串以避免内存占用过大。
     * @param sourceFile - 源文件（.cpp）的绝对路径
     * @returns 文件内容的 UTF-8 字符串，或 undefined（无关联/读取出错），或过大提示
     */
    getInputContent(sourceFile: string): string | undefined {
        const filePath = this.getInputFile(sourceFile);
        if (!filePath) return undefined;
        try {
            const stats = fs.statSync(filePath);
            // 大文件阈值：1MB。超过此阈值时避免一次性读入内存
            if (stats.size > 1024 * 1024) {
                return `[File too large to display: ${filePath}]`;
            }
            return fs.readFileSync(filePath, 'utf-8');
        } catch {
            return undefined;
        }
    }

    /**
     * 清除指定源文件的输入关联。
     * @param sourceFile - 源文件（.cpp）的绝对路径
     */
    clearInputFile(sourceFile: string) {
        delete this.associations[sourceFile];
        this.save();
    }

    /**
     * 检查指定源文件是否存在有效的输入关联。
     * @param sourceFile - 源文件（.cpp）的绝对路径
     * @returns 若存在且输入文件可访问，返回 true；否则返回 false
     */
    hasInput(sourceFile: string): boolean {
        return this.getInputFile(sourceFile) !== undefined;
    }

    /**
     * 获取与源文件关联的输入文件的显示名称（即文件名）。
     * @param sourceFile - 源文件（.cpp）的绝对路径
     * @returns 输入文件的文件名（basename），或 undefined
     */
    getInputDisplayName(sourceFile: string): string | undefined {
        const filePath = this.getInputFile(sourceFile);
        if (!filePath) return undefined;
        return path.basename(filePath);
    }
}
