import * as vscode from 'vscode';

/**
 * ============================================================================
 * 模块：Webview 输入面板 (Webview Input Panel)
 * ============================================================================
 * 职责：提供基于 VS Code Webview 的多行文本编辑面板，用于让用户输入或编辑
 *       C++ 程序的输入数据（input）或预期输出数据（expected output）。
 *       支持以下核心功能：
 *         - 多行文本编辑（textarea）
 *         - 文件拖拽读取：用户可将 .txt 文件拖入面板，自动读取内容；
 *           若文件超过 1MB，则提示用户选择“加载内容到编辑器”或“直接关联文件路径”
 *         - 提交回调：用户点击 Save 后将内容通过消息机制传回扩展主逻辑
 *         - HTML 转义：将用户内容安全地嵌入 HTML，防止 XSS 注入
 * ============================================================================
 */

export class WebviewInputPanel {
    private panel: vscode.WebviewPanel;
    private mode: 'input' | 'expected';
    private initialContent: string;
    private submitCallback: ((content: string) => void) | undefined;

    /**
     * 创建 WebviewInputPanel 实例，初始化面板并设置消息监听。
     * @param panel - VS Code WebviewPanel 实例
     * @param mode - 面板模式：'input' 表示输入数据面板，'expected' 表示预期输出面板
     * @param initialContent - 面板打开时预填充的初始文本内容，默认为空字符串
     */
    constructor(panel: vscode.WebviewPanel, mode: 'input' | 'expected', initialContent: string = '') {
        this.panel = panel;
        this.mode = mode;
        this.initialContent = initialContent;
        this.panel.webview.html = this.getHtml();

        // 监听来自 Webview 的消息：处理提交（submit）和文件拖拽（fileDrop）事件
        this.panel.webview.onDidReceiveMessage((message) => {
            if (message.command === 'submit' && this.submitCallback) {
                this.submitCallback(message.content);
                this.panel.dispose();
            } else if (message.command === 'fileDrop') {
                this.handleFileDrop(message.filePath);
            }
        });
    }

    /**
     * 注册内容提交后的回调函数。
     * 当用户在 Webview 中点击 Save 按钮时，回调会被触发并传入当前编辑器内容。
     * @param callback - 接收字符串内容的回调函数
     */
    onDidSubmit(callback: (content: string) => void) {
        this.submitCallback = callback;
    }

    /**
     * 处理从 Webview 拖拽文件后发送的文件路径消息。
     * 根据文件大小执行不同策略：
     *   - 若文件 ≤ 1MB：直接读取完整内容并发送到 Webview 编辑器中展示；
     *   - 若文件 > 1MB：弹出提示让用户选择“加载到编辑器”或“直接关联文件路径”。
     *     若选择关联路径，则通过特殊标记 `[FILE:路径]` 提交，由 InputManager 识别处理。
     * @param filePath - 用户拖拽的文件的绝对路径
     */
    private async handleFileDrop(filePath: string) {
        const fs = require('fs');
        try {
            const stats = fs.statSync(filePath);
            // 大文件阈值：1MB。超过此阈值时不再自动加载完整内容，防止 Webview 内存占用过高
            const largeThreshold = 1024 * 1024; // 1MB

            if (stats.size > largeThreshold) {
                const choice = await vscode.window.showInformationMessage(
                    `File is large (${(stats.size / 1024 / 1024).toFixed(1)} MB). Load content into editor or associate file path directly?`,
                    'Load into editor',
                    'Associate file path'
                );
                if (choice === 'Associate file path') {
                    if (this.submitCallback) {
                        // 使用 [FILE:路径] 标记通知调用方直接关联文件路径，而非加载内容
                        this.submitCallback(`[FILE:${filePath}]`);
                    }
                    this.panel.dispose();
                    return;
                }
            }

            const content = fs.readFileSync(filePath, 'utf-8');
            // 将读取到的文件内容回送到 Webview，填充到 textarea 中供用户预览或编辑
            this.panel.webview.postMessage({ command: 'setContent', content });
        } catch (err: any) {
            vscode.window.showErrorMessage(`Failed to read file: ${err.message}`);
        }
    }

    /**
     * 生成 Webview 的完整 HTML 内容。
     * 包含样式（使用 VS Code CSS 变量以适配主题）、拖拽区域、文本编辑器、
     * 操作按钮，以及用于与扩展主进程通信的 JavaScript 逻辑。
     * @returns HTML 字符串
     */
    private getHtml(): string {
        const title = this.mode === 'input' ? 'Input' : 'Expected Output';
        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${title}</title>
    <style>
        body {
            font-family: var(--vscode-font-family);
            padding: 20px;
            color: var(--vscode-foreground);
            background-color: var(--vscode-editor-background);
        }
        h2 { margin-top: 0; }
        #dropZone {
            border: 2px dashed var(--vscode-panel-border);
            border-radius: 6px;
            padding: 20px;
            text-align: center;
            margin-bottom: 16px;
            color: var(--vscode-descriptionForeground);
            transition: border-color 0.2s;
        }
        #dropZone.dragover {
            border-color: var(--vscode-focusBorder);
            background-color: var(--vscode-list-hoverBackground);
        }
        textarea {
            width: 100%;
            height: 400px;
            font-family: var(--vscode-editor-font-family);
            font-size: var(--vscode-editor-font-size);
            background-color: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border: 1px solid var(--vscode-input-border);
            border-radius: 4px;
            padding: 8px;
            resize: vertical;
            box-sizing: border-box;
        }
        .buttons {
            margin-top: 12px;
            display: flex;
            gap: 8px;
        }
        button {
            padding: 8px 16px;
            background-color: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            border-radius: 4px;
            cursor: pointer;
            font-size: 13px;
        }
        button:hover {
            background-color: var(--vscode-button-hoverBackground);
        }
        .hint {
            font-size: 12px;
            color: var(--vscode-descriptionForeground);
            margin-top: 8px;
        }
    </style>
</head>
<body>
    <h2>C++ Runner: ${title}</h2>
    <div id="dropZone">Drop a .txt file here, or type below</div>
    <textarea id="editor" placeholder="Enter content here...">${this.escapeHtml(this.initialContent)}</textarea>
    <div class="buttons">
        <button id="submitBtn">Save</button>
        <button id="clearBtn">Clear</button>
    </div>
    <div class="hint">Tip: You can drag and drop a .txt file onto the drop zone above.</div>
    <script>
        const vscode = acquireVsCodeApi();
        const dropZone = document.getElementById('dropZone');
        const editor = document.getElementById('editor');

        // 文件拖拽事件监听： dragover / dragleave / drop
        dropZone.addEventListener('dragover', (e) => {
            e.preventDefault();
            dropZone.classList.add('dragover');
        });
        dropZone.addEventListener('dragleave', () => {
            dropZone.classList.remove('dragover');
        });
        dropZone.addEventListener('drop', (e) => {
            e.preventDefault();
            dropZone.classList.remove('dragover');
            const files = e.dataTransfer.files;
            if (files.length > 0) {
                const file = files[0];
                if (file.path) {
                    // 将文件路径发送到扩展主进程，由主进程负责读取文件内容
                    vscode.postMessage({ command: 'fileDrop', filePath: file.path });
                }
            }
        });

        // 按钮事件：提交内容 / 清空编辑器
        document.getElementById('submitBtn').addEventListener('click', () => {
            vscode.postMessage({ command: 'submit', content: editor.value });
        });
        document.getElementById('clearBtn').addEventListener('click', () => {
            editor.value = '';
        });

        // 接收来自扩展主进程的消息（如文件读取后的内容回写）
        window.addEventListener('message', (event) => {
            const message = event.data;
            if (message.command === 'setContent') {
                editor.value = message.content;
            }
        });
    </script>
</body>
</html>`;
    }

    /**
     * 对文本进行 HTML 实体转义，防止用户输入内容破坏 HTML 结构或引发 XSS。
     * 转义字符：& < > " '
     * @param text - 原始文本字符串
     * @returns 转义后的安全 HTML 字符串
     */
    private escapeHtml(text: string): string {
        return text
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }
}
