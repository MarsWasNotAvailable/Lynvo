/******/ (() => { // webpackBootstrap
/******/ 	"use strict";
/******/ 	var __webpack_modules__ = ({

/***/ "./src/extension.ts"
/*!**************************!*\
  !*** ./src/extension.ts ***!
  \**************************/
(__unused_webpack_module, exports, __webpack_require__) {


var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.activate = activate;
exports.deactivate = deactivate;
// src/extension.ts
const vscode = __importStar(__webpack_require__(/*! vscode */ "vscode"));
const DataManager_1 = __webpack_require__(/*! ./providers/DataManager */ "./src/providers/DataManager.ts");
const AuthProvider_1 = __webpack_require__(/*! ./providers/AuthProvider */ "./src/providers/AuthProvider.ts");
const LynvoPanel_1 = __webpack_require__(/*! ./providers/LynvoPanel */ "./src/providers/LynvoPanel.ts");
const SidebarProvider_1 = __webpack_require__(/*! ./providers/SidebarProvider */ "./src/providers/SidebarProvider.ts");
async function activate(context) {
    console.log('¡La extensión "Lynvo" se ha activado!');
    await DataManager_1.DataManager.initializeBoard();
    const sidebarProvider = new SidebarProvider_1.SidebarProvider();
    vscode.window.registerTreeDataProvider("lynvo.sidebarMenu", sidebarProvider);
    let testAuthCommand = vscode.commands.registerCommand("lynvo.testAuth", async () => {
        vscode.window.showInformationMessage("Lynvo: Conectando con GitHub...");
        const user = await AuthProvider_1.AuthProvider.getGitHubUser();
        if (user) {
            vscode.window.showInformationMessage(`¡Hola ${user.username}!`);
        }
    });
    let openBoardCommand = vscode.commands.registerCommand("lynvo.openBoard", () => {
        LynvoPanel_1.LynvoPanel.render(context.extensionUri);
    });
    // NUEVO: Comando para crear tareas seleccionando código
    let createFromCodeCommand = vscode.commands.registerCommand("lynvo.createTaskFromCode", async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showWarningMessage("No hay ningún archivo abierto para vincular.");
            return;
        }
        const selection = editor.selection;
        const text = editor.document.getText(selection);
        // Pedimos al usuario el título de la tarea
        const title = await vscode.window.showInputBox({
            prompt: "Título para la tarea de Lynvo",
            placeHolder: "Ej: Refactorizar esta función",
        });
        if (!title)
            return; // Si pulsa Escape, cancelamos
        // Calculamos la ruta del archivo relativa al proyecto
        const workspaceFolder = vscode.workspace.getWorkspaceFolder(editor.document.uri);
        const filePath = workspaceFolder
            ? vscode.workspace.asRelativePath(editor.document.uri)
            : editor.document.uri.fsPath;
        const codeRef = {
            filePath: filePath,
            lineStart: selection.start.line + 1, // Sumamos 1 porque las líneas empiezan en 0 en la API
            lineEnd: selection.end.line + 1,
        };
        const description = text.length > 0
            ? `Código vinculado:\n${text}`
            : "Tarea creada desde un archivo.";
        // Creamos la tarea y forzamos la actualización de la interfaz visual
        await DataManager_1.DataManager.createTask(title, description, codeRef);
        await LynvoPanel_1.LynvoPanel.refreshData();
        vscode.window.showInformationMessage("¡Tarea vinculada a Lynvo con éxito!");
    });
    context.subscriptions.push(testAuthCommand, openBoardCommand, createFromCodeCommand);
}
function deactivate() { }


/***/ },

/***/ "./src/providers/AuthProvider.ts"
/*!***************************************!*\
  !*** ./src/providers/AuthProvider.ts ***!
  \***************************************/
(__unused_webpack_module, exports, __webpack_require__) {


var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.AuthProvider = void 0;
// src/providers/AuthProvider.ts
const vscode = __importStar(__webpack_require__(/*! vscode */ "vscode"));
class AuthProvider {
    /**
     * Solicita la sesión de GitHub a través de VS Code.
     * Si el usuario no ha iniciado sesión, VS Code le mostrará un prompt nativo.
     */
    static async getGitHubUser() {
        try {
            // Solicitamos acceso de solo lectura al perfil de GitHub
            // 'createIfNone: true' hace que VS Code pregunte al usuario si aún no está logueado.
            const session = await vscode.authentication.getSession("github", ["read:user"], { createIfNone: true });
            if (session) {
                return {
                    githubId: session.account.id,
                    username: session.account.label, // El nombre de usuario de GitHub
                };
            }
        }
        catch (error) {
            console.error("Lynvo: Error al autenticar con GitHub", error);
            vscode.window.showErrorMessage("Lynvo: Se requiere iniciar sesión con GitHub para identificar los cambios.");
        }
        return undefined; // Retorna undefined si el usuario cancela o hay un error
    }
}
exports.AuthProvider = AuthProvider;


/***/ },

/***/ "./src/providers/DataManager.ts"
/*!**************************************!*\
  !*** ./src/providers/DataManager.ts ***!
  \**************************************/
(__unused_webpack_module, exports, __webpack_require__) {


var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.DataManager = void 0;
// src/providers/DataManager.ts
const vscode = __importStar(__webpack_require__(/*! vscode */ "vscode"));
const AuthProvider_1 = __webpack_require__(/*! ./AuthProvider */ "./src/providers/AuthProvider.ts");
class DataManager {
    static FILENAME = "lynvo.json";
    static FOLDER = ".vscode";
    static getFileUri() {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders || workspaceFolders.length === 0)
            return undefined;
        return vscode.Uri.joinPath(workspaceFolders[0].uri, this.FOLDER, this.FILENAME);
    }
    static async initializeBoard() {
        const fileUri = this.getFileUri();
        if (!fileUri)
            return;
        try {
            await vscode.workspace.fs.stat(fileUri);
            const board = await this.loadBoard();
            let changed = false;
            if (board && !board.columns) {
                board.columns = {
                    todo: {
                        id: "todo",
                        title: "📋 To Do",
                        color: "var(--vscode-charts-blue)",
                        position: 0,
                    },
                    "in-progress": {
                        id: "in-progress",
                        title: "⏳ In Progress",
                        color: "var(--vscode-charts-yellow)",
                        position: 1,
                    },
                    done: {
                        id: "done",
                        title: "✅ Done",
                        color: "var(--vscode-charts-green)",
                        position: 2,
                    },
                };
                changed = true;
            }
            if (board && !board.labels) {
                board.labels = {
                    bug: { id: "bug", name: "Bug", color: "#f85149" },
                    feat: { id: "feat", name: "Feature", color: "#a371f7" },
                };
                changed = true;
            }
            if (changed && board)
                await this.saveBoard(board);
        }
        catch (error) {
            const initialData = {
                version: "1.1.0",
                columns: {
                    todo: {
                        id: "todo",
                        title: "📋 To Do",
                        color: "var(--vscode-charts-blue)",
                        position: 0,
                    },
                    "in-progress": {
                        id: "in-progress",
                        title: "⏳ In Progress",
                        color: "var(--vscode-charts-yellow)",
                        position: 1,
                    },
                    done: {
                        id: "done",
                        title: "✅ Done",
                        color: "var(--vscode-charts-green)",
                        position: 2,
                    },
                },
                tasks: {},
                labels: {
                    bug: { id: "bug", name: "Bug", color: "#f85149" },
                    feat: { id: "feat", name: "Feature", color: "#a371f7" },
                },
            };
            await this.saveBoard(initialData);
        }
    }
    static async loadBoard() {
        const fileUri = this.getFileUri();
        if (!fileUri)
            return null;
        try {
            const fileData = await vscode.workspace.fs.readFile(fileUri);
            return JSON.parse(Buffer.from(fileData).toString("utf8"));
        }
        catch (error) {
            return null;
        }
    }
    static async saveBoard(board) {
        const fileUri = this.getFileUri();
        if (!fileUri)
            return;
        const data = Buffer.from(JSON.stringify(board, null, 2), "utf8");
        await vscode.workspace.fs.writeFile(fileUri, data);
    }
    static async updateTaskStatus(taskId, newStatus) {
        const board = await this.loadBoard();
        if (!board || !board.tasks[taskId])
            return;
        const user = await AuthProvider_1.AuthProvider.getGitHubUser();
        board.tasks[taskId].status = newStatus;
        board.tasks[taskId].updatedAt = Date.now();
        if (user)
            board.tasks[taskId].lastModifiedBy = user;
        await this.saveBoard(board);
    }
    static async reorderTasks(updates) {
        const board = await this.loadBoard();
        if (!board)
            return;
        const user = await AuthProvider_1.AuthProvider.getGitHubUser();
        updates.forEach((upd) => {
            if (board.tasks[upd.id]) {
                board.tasks[upd.id].status = upd.status;
                board.tasks[upd.id].position = upd.position;
                if (upd.isDraggedTask) {
                    board.tasks[upd.id].updatedAt = Date.now();
                    if (user)
                        board.tasks[upd.id].lastModifiedBy = user;
                }
            }
        });
        await this.saveBoard(board);
    }
    static async createTask(title, description, targetColId, labelIds = [], codeReference) {
        const board = await this.loadBoard();
        if (!board)
            return;
        const user = await AuthProvider_1.AuthProvider.getGitHubUser();
        const taskId = "task-" + Date.now();
        let status = targetColId;
        if (!status) {
            const sortedCols = Object.values(board.columns).sort((a, b) => a.position - b.position);
            status = sortedCols.length > 0 ? sortedCols[0].id : "todo";
        }
        board.tasks[taskId] = {
            id: taskId,
            title,
            description,
            status,
            createdBy: user || { githubId: "unknown", username: "Unknown" },
            lastModifiedBy: user || { githubId: "unknown", username: "Unknown" },
            createdAt: Date.now(),
            updatedAt: Date.now(),
            codeReference,
            position: Date.now(),
            labelIds: labelIds,
        };
        await this.saveBoard(board);
    }
    static async editTask(taskId, title, description, labelIds = []) {
        const board = await this.loadBoard();
        if (!board || !board.tasks[taskId])
            return;
        const user = await AuthProvider_1.AuthProvider.getGitHubUser();
        board.tasks[taskId].title = title;
        board.tasks[taskId].description = description;
        board.tasks[taskId].labelIds = labelIds;
        board.tasks[taskId].updatedAt = Date.now();
        if (user)
            board.tasks[taskId].lastModifiedBy = user;
        await this.saveBoard(board);
    }
    static async deleteTask(taskId) {
        const board = await this.loadBoard();
        if (!board)
            return;
        delete board.tasks[taskId];
        await this.saveBoard(board);
    }
    static async createColumn(title, color) {
        const board = await this.loadBoard();
        if (!board)
            return;
        const colId = "col-" + Date.now();
        const position = Object.keys(board.columns).length;
        board.columns[colId] = { id: colId, title, color, position };
        await this.saveBoard(board);
    }
    static async editColumn(id, title, color) {
        const board = await this.loadBoard();
        if (!board || !board.columns[id])
            return;
        board.columns[id].title = title;
        board.columns[id].color = color;
        await this.saveBoard(board);
    }
    static async deleteColumn(id) {
        const board = await this.loadBoard();
        if (!board || !board.columns[id])
            return;
        delete board.columns[id];
        for (const taskId in board.tasks) {
            if (board.tasks[taskId].status === id) {
                delete board.tasks[taskId];
            }
        }
        await this.saveBoard(board);
    }
    static async reorderColumns(updates) {
        const board = await this.loadBoard();
        if (!board)
            return;
        updates.forEach((upd) => {
            if (board.columns[upd.id]) {
                board.columns[upd.id].position = upd.position;
            }
        });
        await this.saveBoard(board);
    }
    static async createLabel(name, color) {
        const board = await this.loadBoard();
        if (!board)
            return;
        if (!board.labels)
            board.labels = {};
        const labelId = "label-" + Date.now();
        board.labels[labelId] = { id: labelId, name, color };
        await this.saveBoard(board);
    }
    static async deleteLabel(id) {
        const board = await this.loadBoard();
        if (!board || !board.labels)
            return;
        delete board.labels[id];
        for (const taskId in board.tasks) {
            if (board.tasks[taskId].labelIds) {
                board.tasks[taskId].labelIds = board.tasks[taskId].labelIds.filter((l) => l !== id);
            }
        }
        await this.saveBoard(board);
    }
}
exports.DataManager = DataManager;


/***/ },

/***/ "./src/providers/LynvoPanel.ts"
/*!*************************************!*\
  !*** ./src/providers/LynvoPanel.ts ***!
  \*************************************/
(__unused_webpack_module, exports, __webpack_require__) {


var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.LynvoPanel = void 0;
// src/providers/LynvoPanel.ts
const vscode = __importStar(__webpack_require__(/*! vscode */ "vscode"));
const DataManager_1 = __webpack_require__(/*! ./DataManager */ "./src/providers/DataManager.ts");
class LynvoPanel {
    static currentPanel;
    _panel;
    _disposables = [];
    constructor(panel, extensionUri) {
        this._panel = panel;
        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);
        this._panel.webview.html = this._getWebviewContent(this._panel.webview, extensionUri);
        this._setWebviewMessageListener(this._panel.webview);
    }
    static render(extensionUri) {
        if (LynvoPanel.currentPanel) {
            LynvoPanel.currentPanel._panel.reveal(vscode.ViewColumn.One);
        }
        else {
            const panel = vscode.window.createWebviewPanel("lynvoBoard", "Lynvo - Project Board", vscode.ViewColumn.One, {
                enableScripts: true,
                localResourceRoots: [vscode.Uri.joinPath(extensionUri, "dist")],
            });
            LynvoPanel.currentPanel = new LynvoPanel(panel, extensionUri);
        }
    }
    static async refreshData() {
        if (LynvoPanel.currentPanel) {
            const board = await DataManager_1.DataManager.loadBoard();
            LynvoPanel.currentPanel._panel.webview.postMessage({
                command: "loadData",
                data: board,
            });
        }
    }
    dispose() {
        LynvoPanel.currentPanel = undefined;
        this._panel.dispose();
        while (this._disposables.length) {
            const disposable = this._disposables.pop();
            if (disposable) {
                disposable.dispose();
            }
        }
    }
    _setWebviewMessageListener(webview) {
        webview.onDidReceiveMessage(async (message) => {
            switch (message.command) {
                case "requestData":
                    const board = await DataManager_1.DataManager.loadBoard();
                    webview.postMessage({ command: "loadData", data: board });
                    return;
                case "updateTaskStatus":
                    await DataManager_1.DataManager.updateTaskStatus(message.taskId, message.newStatus);
                    LynvoPanel.refreshData();
                    return;
                case "reorderTasks":
                    await DataManager_1.DataManager.reorderTasks(message.updates);
                    LynvoPanel.refreshData();
                    return;
                case "createTask":
                    await DataManager_1.DataManager.createTask(message.title, message.description, message.targetColId, message.labelIds);
                    LynvoPanel.refreshData();
                    return;
                case "editTask":
                    await DataManager_1.DataManager.editTask(message.taskId, message.title, message.description, message.labelIds);
                    LynvoPanel.refreshData();
                    return;
                case "deleteTask":
                    const confirmTask = await vscode.window.showWarningMessage("Delete task?", { modal: true }, "Delete");
                    if (confirmTask === "Delete") {
                        await DataManager_1.DataManager.deleteTask(message.taskId);
                        LynvoPanel.refreshData();
                    }
                    return;
                case "createColumn":
                    await DataManager_1.DataManager.createColumn(message.title, message.color);
                    LynvoPanel.refreshData();
                    return;
                case "editColumn":
                    await DataManager_1.DataManager.editColumn(message.colId, message.title, message.color);
                    LynvoPanel.refreshData();
                    return;
                case "deleteColumn":
                    const confirmCol = await vscode.window.showWarningMessage("Delete column? ALL TASKS inside will be deleted.", { modal: true }, "Delete");
                    if (confirmCol === "Delete") {
                        await DataManager_1.DataManager.deleteColumn(message.colId);
                        LynvoPanel.refreshData();
                    }
                    return;
                case "reorderColumns":
                    await DataManager_1.DataManager.reorderColumns(message.updates);
                    LynvoPanel.refreshData();
                    return;
                case "createLabel":
                    await DataManager_1.DataManager.createLabel(message.name, message.color);
                    LynvoPanel.refreshData();
                    return;
                case "deleteLabel":
                    await DataManager_1.DataManager.deleteLabel(message.labelId);
                    LynvoPanel.refreshData();
                    return;
                case "openCode":
                    const folders = vscode.workspace.workspaceFolders;
                    if (folders) {
                        const fileUri = vscode.Uri.joinPath(folders[0].uri, message.filePath);
                        const doc = await vscode.workspace.openTextDocument(fileUri);
                        const editor = await vscode.window.showTextDocument(doc, vscode.ViewColumn.Beside);
                        const pos = new vscode.Position(message.lineStart - 1, 0);
                        editor.selection = new vscode.Selection(pos, pos);
                        editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
                    }
                    return;
            }
        }, undefined, this._disposables);
    }
    _getWebviewContent(webview, extensionUri) {
        const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, "dist", "webview.js"));
        const nonce = getNonce();
        return `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>
            body { overflow-x: hidden; font-family: var(--vscode-font-family); }
            .icon-btn { cursor: pointer; opacity: 0.6; background: transparent; border: none; color: var(--vscode-foreground); font-size: 14px; }
            .icon-btn:hover { opacity: 1; }
            .icon-btn.delete:hover { color: var(--vscode-errorForeground); }
            input, textarea, select { background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border); border-radius: 2px; }
            input[type="color"] { -webkit-appearance: none; border: none; width: 25px; height: 25px; cursor: pointer; padding: 0; background: transparent; }
            input[type="color"]::-webkit-color-swatch-wrapper { padding: 0; }
            input[type="color"]::-webkit-color-swatch { border: 1px solid var(--vscode-widget-border); border-radius: 4px; }
        </style></head><body><div id="root"></div><script nonce="${nonce}" src="${scriptUri}"></script></body></html>`;
    }
}
exports.LynvoPanel = LynvoPanel;
function getNonce() {
    let t = "";
    const p = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    for (let i = 0; i < 32; i++)
        t += p.charAt(Math.floor(Math.random() * p.length));
    return t;
}


/***/ },

/***/ "./src/providers/SidebarProvider.ts"
/*!******************************************!*\
  !*** ./src/providers/SidebarProvider.ts ***!
  \******************************************/
(__unused_webpack_module, exports, __webpack_require__) {


var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.SidebarProvider = void 0;
// src/providers/SidebarProvider.ts
const vscode = __importStar(__webpack_require__(/*! vscode */ "vscode"));
// Creamos un proveedor de datos para una vista de árbol (TreeView) nativa de VS Code
class SidebarProvider {
    getTreeItem(element) {
        return element;
    }
    getChildren() {
        // Opción 1: Botón para abrir el tablero
        const openBoardItem = new vscode.TreeItem("🚀 Abrir Tablero Lynvo", vscode.TreeItemCollapsibleState.None);
        openBoardItem.tooltip = "Abre el panel Kanban en pantalla completa";
        openBoardItem.command = {
            command: "lynvo.openBoard",
            title: "Abrir Tablero",
        };
        // Opción 2: Botón para probar la conexión
        const authItem = new vscode.TreeItem("🔐 Conectar GitHub", vscode.TreeItemCollapsibleState.None);
        authItem.tooltip = "Verifica tu identidad en GitHub";
        authItem.command = {
            command: "lynvo.testAuth",
            title: "Conectar GitHub",
        };
        // Devolvemos los botones que aparecerán en la barra lateral
        return [openBoardItem, authItem];
    }
}
exports.SidebarProvider = SidebarProvider;


/***/ },

/***/ "vscode"
/*!*************************!*\
  !*** external "vscode" ***!
  \*************************/
(module) {

module.exports = require("vscode");

/***/ }

/******/ 	});
/************************************************************************/
/******/ 	// The module cache
/******/ 	var __webpack_module_cache__ = {};
/******/ 	
/******/ 	// The require function
/******/ 	function __webpack_require__(moduleId) {
/******/ 		// Check if module is in cache
/******/ 		var cachedModule = __webpack_module_cache__[moduleId];
/******/ 		if (cachedModule !== undefined) {
/******/ 			return cachedModule.exports;
/******/ 		}
/******/ 		// Create a new module (and put it into the cache)
/******/ 		var module = __webpack_module_cache__[moduleId] = {
/******/ 			// no module.id needed
/******/ 			// no module.loaded needed
/******/ 			exports: {}
/******/ 		};
/******/ 	
/******/ 		// Execute the module function
/******/ 		if (!(moduleId in __webpack_modules__)) {
/******/ 			delete __webpack_module_cache__[moduleId];
/******/ 			var e = new Error("Cannot find module '" + moduleId + "'");
/******/ 			e.code = 'MODULE_NOT_FOUND';
/******/ 			throw e;
/******/ 		}
/******/ 		__webpack_modules__[moduleId].call(module.exports, module, module.exports, __webpack_require__);
/******/ 	
/******/ 		// Return the exports of the module
/******/ 		return module.exports;
/******/ 	}
/******/ 	
/************************************************************************/
/******/ 	
/******/ 	// startup
/******/ 	// Load entry module and return exports
/******/ 	// This entry module is referenced by other modules so it can't be inlined
/******/ 	var __webpack_exports__ = __webpack_require__("./src/extension.ts");
/******/ 	var __webpack_export_target__ = exports;
/******/ 	for(var __webpack_i__ in __webpack_exports__) __webpack_export_target__[__webpack_i__] = __webpack_exports__[__webpack_i__];
/******/ 	if(__webpack_exports__.__esModule) Object.defineProperty(__webpack_export_target__, "__esModule", { value: true });
/******/ 	
/******/ })()
;
//# sourceMappingURL=extension.js.map