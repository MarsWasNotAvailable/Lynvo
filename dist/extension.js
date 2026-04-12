/******/ (() => { // webpackBootstrap
/******/ 	"use strict";
/******/ 	var __webpack_modules__ = ({

/***/ "./src/providers/AuthProvider.ts"
/*!***************************************!*\
  !*** ./src/providers/AuthProvider.ts ***!
  \***************************************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   AuthProvider: () => (/* binding */ AuthProvider)
/* harmony export */ });
/* harmony import */ var vscode__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! vscode */ "vscode");
/* harmony import */ var vscode__WEBPACK_IMPORTED_MODULE_0___default = /*#__PURE__*/__webpack_require__.n(vscode__WEBPACK_IMPORTED_MODULE_0__);

class AuthProvider {
    static async getGitHubUser(options = {}) {
        const { createIfNone = false } = options;
        try {
            const session = await vscode__WEBPACK_IMPORTED_MODULE_0__.authentication.getSession("github", ["read:user"], { createIfNone });
            if (session) {
                return {
                    githubId: session.account.id,
                    username: session.account.label,
                };
            }
        }
        catch (error) {
            console.error("Lynvo: Error al autenticar con GitHub", error);
            if (createIfNone) {
                vscode__WEBPACK_IMPORTED_MODULE_0__.window.showErrorMessage("Lynvo: Se requiere iniciar sesión con GitHub para identificar los cambios.");
            }
        }
        return undefined;
    }
}


/***/ },

/***/ "./src/providers/DataManager.ts"
/*!**************************************!*\
  !*** ./src/providers/DataManager.ts ***!
  \**************************************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   DataManager: () => (/* binding */ DataManager)
/* harmony export */ });
/* harmony import */ var vscode__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! vscode */ "vscode");
/* harmony import */ var vscode__WEBPACK_IMPORTED_MODULE_0___default = /*#__PURE__*/__webpack_require__.n(vscode__WEBPACK_IMPORTED_MODULE_0__);
/* harmony import */ var _AuthProvider__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! ./AuthProvider */ "./src/providers/AuthProvider.ts");


class DataManager {
    static FILENAME = "lynvo.json";
    static FOLDER = ".vscode";
    static getWorkspaceUri() {
        const workspaceFolders = vscode__WEBPACK_IMPORTED_MODULE_0__.workspace.workspaceFolders;
        if (!workspaceFolders || workspaceFolders.length === 0)
            return undefined;
        return workspaceFolders[0].uri;
    }
    static getFolderUri() {
        const workspace = this.getWorkspaceUri();
        if (!workspace)
            return undefined;
        return vscode__WEBPACK_IMPORTED_MODULE_0__.Uri.joinPath(workspace, this.FOLDER);
    }
    static getFileUri() {
        const folderUri = this.getFolderUri();
        if (!folderUri)
            return undefined;
        return vscode__WEBPACK_IMPORTED_MODULE_0__.Uri.joinPath(folderUri, this.FILENAME);
    }
    static getDefaultBoard() {
        return {
            version: "1.2.0",
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
    }
    static ensureBoardIntegrity(board) {
        if (!board.columns || Object.keys(board.columns).length === 0) {
            board.columns = this.getDefaultBoard().columns;
        }
        if (!board.labels) {
            board.labels = this.getDefaultBoard().labels;
        }
        if (!board.tasks) {
            board.tasks = {};
        }
        const sortedColumns = Object.values(board.columns).sort((a, b) => a.position - b.position);
        const fallbackColumnId = sortedColumns[0]?.id ?? "todo";
        Object.values(board.tasks).forEach((task) => {
            if (!board.columns[task.status]) {
                task.status = fallbackColumnId;
            }
            if (!task.lastModifiedBy) {
                task.lastModifiedBy = task.createdBy;
            }
            if (!task.labelIds) {
                task.labelIds = [];
            }
        });
        return board;
    }
    static async initializeBoard() {
        const fileUri = this.getFileUri();
        const folderUri = this.getFolderUri();
        if (!fileUri || !folderUri)
            return;
        try {
            await vscode__WEBPACK_IMPORTED_MODULE_0__.workspace.fs.createDirectory(folderUri);
            await vscode__WEBPACK_IMPORTED_MODULE_0__.workspace.fs.stat(fileUri);
            const board = await this.loadBoard();
            if (board) {
                await this.saveBoard(this.ensureBoardIntegrity(board));
            }
        }
        catch {
            await this.saveBoard(this.getDefaultBoard());
        }
    }
    static async loadBoard() {
        const fileUri = this.getFileUri();
        if (!fileUri)
            return null;
        try {
            const fileData = await vscode__WEBPACK_IMPORTED_MODULE_0__.workspace.fs.readFile(fileUri);
            const parsed = JSON.parse(Buffer.from(fileData).toString("utf8"));
            return this.ensureBoardIntegrity(parsed);
        }
        catch {
            return null;
        }
    }
    static async saveBoard(board) {
        const fileUri = this.getFileUri();
        const folderUri = this.getFolderUri();
        if (!fileUri || !folderUri)
            return;
        await vscode__WEBPACK_IMPORTED_MODULE_0__.workspace.fs.createDirectory(folderUri);
        const data = Buffer.from(JSON.stringify(this.ensureBoardIntegrity(board), null, 2), "utf8");
        await vscode__WEBPACK_IMPORTED_MODULE_0__.workspace.fs.writeFile(fileUri, data);
    }
    static async updateTaskStatus(taskId, newStatus) {
        const board = await this.loadBoard();
        if (!board || !board.tasks[taskId] || !board.columns[newStatus])
            return;
        const user = await _AuthProvider__WEBPACK_IMPORTED_MODULE_1__.AuthProvider.getGitHubUser();
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
        const user = await _AuthProvider__WEBPACK_IMPORTED_MODULE_1__.AuthProvider.getGitHubUser();
        updates.forEach((upd) => {
            if (!board.tasks[upd.id] || !board.columns[upd.status])
                return;
            board.tasks[upd.id].status = upd.status;
            board.tasks[upd.id].position = upd.position;
            if (upd.isDraggedTask) {
                board.tasks[upd.id].updatedAt = Date.now();
                if (user)
                    board.tasks[upd.id].lastModifiedBy = user;
            }
        });
        await this.saveBoard(board);
    }
    static async createTask(title, description, targetColId, labelIds = [], codeReference, priority = "medium", dueDate) {
        const board = await this.loadBoard();
        if (!board)
            return;
        const user = await _AuthProvider__WEBPACK_IMPORTED_MODULE_1__.AuthProvider.getGitHubUser();
        const taskId = `task-${Date.now()}`;
        let status = targetColId;
        if (!status || !board.columns[status]) {
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
            labelIds,
            priority,
            dueDate,
        };
        await this.saveBoard(board);
    }
    static async editTask(taskId, title, description, labelIds = [], priority = "medium", dueDate) {
        const board = await this.loadBoard();
        if (!board || !board.tasks[taskId])
            return;
        const user = await _AuthProvider__WEBPACK_IMPORTED_MODULE_1__.AuthProvider.getGitHubUser();
        board.tasks[taskId].title = title;
        board.tasks[taskId].description = description;
        board.tasks[taskId].labelIds = labelIds;
        board.tasks[taskId].priority = priority;
        board.tasks[taskId].dueDate = dueDate;
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
        const colId = `col-${Date.now()}`;
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
        const columnsCount = Object.keys(board.columns).length;
        if (columnsCount <= 1) {
            vscode__WEBPACK_IMPORTED_MODULE_0__.window.showWarningMessage("No puedes eliminar la última columna del tablero.");
            return;
        }
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
        const labelId = `label-${Date.now()}`;
        board.labels[labelId] = { id: labelId, name, color };
        await this.saveBoard(board);
    }
    static async deleteLabel(labelId) {
        const board = await this.loadBoard();
        if (!board || !board.labels || !board.labels[labelId])
            return;
        delete board.labels[labelId];
        Object.values(board.tasks).forEach((task) => {
            task.labelIds = (task.labelIds || []).filter((id) => id !== labelId);
        });
        await this.saveBoard(board);
    }
}


/***/ },

/***/ "./src/providers/GitService.ts"
/*!*************************************!*\
  !*** ./src/providers/GitService.ts ***!
  \*************************************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   GitService: () => (/* binding */ GitService)
/* harmony export */ });
/* harmony import */ var vscode__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! vscode */ "vscode");
/* harmony import */ var vscode__WEBPACK_IMPORTED_MODULE_0___default = /*#__PURE__*/__webpack_require__.n(vscode__WEBPACK_IMPORTED_MODULE_0__);
/* harmony import */ var child_process__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! child_process */ "child_process");
/* harmony import */ var child_process__WEBPACK_IMPORTED_MODULE_1___default = /*#__PURE__*/__webpack_require__.n(child_process__WEBPACK_IMPORTED_MODULE_1__);
/* harmony import */ var _DataManager__WEBPACK_IMPORTED_MODULE_2__ = __webpack_require__(/*! ./DataManager */ "./src/providers/DataManager.ts");
// src/providers/GitService.ts



class GitService {
    static getWorkspacePath() {
        const folders = vscode__WEBPACK_IMPORTED_MODULE_0__.workspace.workspaceFolders;
        return folders && folders.length > 0 ? folders[0].uri.fsPath : null;
    }
    static execPromise(command, cwd) {
        return new Promise((resolve, reject) => {
            child_process__WEBPACK_IMPORTED_MODULE_1__.exec(command, { cwd }, (error, stdout, stderr) => {
                if (error) {
                    console.warn(`Lynvo Git Warn: ${stderr}`);
                    reject(error);
                }
                else {
                    resolve(stdout.trim());
                }
            });
        });
    }
    static async syncBoard() {
        const cwd = this.getWorkspacePath();
        if (!cwd)
            return { success: false, message: "No se encontró el workspace." };
        try {
            // 1. Descargamos la info de la nube de forma invisible
            await this.execPromise("git fetch origin", cwd);
            const branch = await this.execPromise("git rev-parse --abbrev-ref HEAD", cwd);
            // 2. Extraemos el tablero remoto directamente de la memoria de Git
            let remoteBoardStr = "";
            try {
                remoteBoardStr = await this.execPromise(`git show origin/${branch}:.vscode/lynvo.json`, cwd);
            }
            catch (e) {
                // Es normal si el archivo aún no existe en el repositorio remoto
            }
            const localBoard = await _DataManager__WEBPACK_IMPORTED_MODULE_2__.DataManager.loadBoard();
            if (!localBoard)
                return {
                    success: false,
                    message: "No hay tablero local que sincronizar.",
                };
            // 3. FUSIÓN MATEMÁTICA INTELIGENTE (Anti-Pérdida de Datos)
            if (remoteBoardStr) {
                const remoteBoard = JSON.parse(remoteBoardStr);
                const mergedTasks = { ...remoteBoard.tasks };
                for (const taskId in localBoard.tasks) {
                    const localTask = localBoard.tasks[taskId];
                    const remoteTask = mergedTasks[taskId];
                    // Regla de oro: Gana la tarea que se haya modificado más recientemente
                    if (!remoteTask || localTask.updatedAt >= remoteTask.updatedAt) {
                        mergedTasks[taskId] = localTask;
                    }
                }
                // Mezclamos la estructura (columnas y etiquetas)
                localBoard.tasks = mergedTasks;
                localBoard.columns = { ...remoteBoard.columns, ...localBoard.columns };
                if (remoteBoard.labels) {
                    localBoard.labels = {
                        ...remoteBoard.labels,
                        ...(localBoard.labels || {}),
                    };
                }
                await _DataManager__WEBPACK_IMPORTED_MODULE_2__.DataManager.saveBoard(localBoard);
            }
            // 4. Aseguramos la fusión perfecta creando un commit local
            await this.execPromise("git add .vscode/lynvo.json", cwd);
            const status = await this.execPromise("git status --porcelain .vscode/lynvo.json", cwd);
            if (status) {
                await this.execPromise('git commit -m "(Lynvo): auto-merge team board [skip ci]"', cwd);
            }
            // 5. Unimos los historiales. Si Git detecta conflicto de texto, le obligamos a usar nuestra fusión (-X ours)
            try {
                await this.execPromise(`git merge origin/${branch} -X ours -m "(Lynvo): integrate remote changes"`, cwd);
            }
            catch (mergeErr) {
                await this.execPromise("git merge --abort", cwd).catch(() => { });
                return {
                    success: false,
                    message: "Hay conflictos en el código de tu proyecto que bloquean la sincronización de Lynvo. Haz commit o pull de tus archivos primero.",
                };
            }
            // 6. Subimos todo a GitHub
            await this.execPromise(`git push origin ${branch}`, cwd);
            return {
                success: true,
                message: "¡Sincronización Total! Datos fusionados inteligentemente y subidos a GitHub.",
            };
        }
        catch (error) {
            console.error("Lynvo Git Error:", error);
            return {
                success: false,
                message: "Error al hacer push. Revisa tu consola de Git.",
            };
        }
    }
}


/***/ },

/***/ "./src/providers/LynvoMenuProvider.ts"
/*!********************************************!*\
  !*** ./src/providers/LynvoMenuProvider.ts ***!
  \********************************************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   LynvoMenuProvider: () => (/* binding */ LynvoMenuProvider)
/* harmony export */ });
/* harmony import */ var vscode__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! vscode */ "vscode");
/* harmony import */ var vscode__WEBPACK_IMPORTED_MODULE_0___default = /*#__PURE__*/__webpack_require__.n(vscode__WEBPACK_IMPORTED_MODULE_0__);

class LynvoMenuProvider {
    menuItems = [
        {
            label: "🚀 Open Board",
            command: "lynvo.openBoard",
            tooltip: "Abre el tablero principal de Kanban",
        },
        {
            label: "📊 Open Insights",
            command: "lynvo.openInsights",
            tooltip: "Muestra métricas y salud del proyecto",
        },
        {
            label: "🏷️ Manage Labels",
            command: "lynvo.openLabels",
            tooltip: "Administra etiquetas del tablero",
        },
        {
            label: "➕ New Task",
            command: "lynvo.quickCreateTask",
            tooltip: "Crea una tarea rápida desde un asistente",
        },
        {
            label: "🧩 New Task from Code",
            command: "lynvo.createTaskFromCode",
            tooltip: "Crea una tarea usando la selección actual de código",
        },
        {
            label: "☁️ Sync Team Board",
            command: "lynvo.syncBoard",
            tooltip: "Sincroniza .vscode/lynvo.json con GitHub",
        },
        {
            label: "🔐 Connect GitHub",
            command: "lynvo.connectGitHub",
            tooltip: "Conecta y valida tu identidad de GitHub",
        },
    ];
    getTreeItem(element) {
        return element;
    }
    getChildren(element) {
        if (element) {
            return Promise.resolve([]);
        }
        return Promise.resolve(this.menuItems.map((item) => this.createMenuItem(item.label, item.command, item.tooltip)));
    }
    createMenuItem(label, command, tooltip) {
        const item = new vscode__WEBPACK_IMPORTED_MODULE_0__.TreeItem(label, vscode__WEBPACK_IMPORTED_MODULE_0__.TreeItemCollapsibleState.None);
        item.command = { command, title: label };
        item.tooltip = tooltip;
        return item;
    }
}


/***/ },

/***/ "./src/providers/LynvoPanel.ts"
/*!*************************************!*\
  !*** ./src/providers/LynvoPanel.ts ***!
  \*************************************/
(__unused_webpack_module, __webpack_exports__, __webpack_require__) {

__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   LynvoPanel: () => (/* binding */ LynvoPanel)
/* harmony export */ });
/* harmony import */ var vscode__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! vscode */ "vscode");
/* harmony import */ var vscode__WEBPACK_IMPORTED_MODULE_0___default = /*#__PURE__*/__webpack_require__.n(vscode__WEBPACK_IMPORTED_MODULE_0__);
/* harmony import */ var _DataManager__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! ./DataManager */ "./src/providers/DataManager.ts");
/* harmony import */ var _GitService__WEBPACK_IMPORTED_MODULE_2__ = __webpack_require__(/*! ./GitService */ "./src/providers/GitService.ts");



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
    static render(extensionUri, initialView = "board") {
        if (LynvoPanel.currentPanel) {
            LynvoPanel.currentPanel._panel.reveal(vscode__WEBPACK_IMPORTED_MODULE_0__.ViewColumn.One);
            LynvoPanel.currentPanel._panel.webview.postMessage({
                command: "switchView",
                view: initialView,
            });
        }
        else {
            const panel = vscode__WEBPACK_IMPORTED_MODULE_0__.window.createWebviewPanel("lynvoBoard", "Lynvo - Project Board", vscode__WEBPACK_IMPORTED_MODULE_0__.ViewColumn.One, {
                enableScripts: true,
                localResourceRoots: [vscode__WEBPACK_IMPORTED_MODULE_0__.Uri.joinPath(extensionUri, "dist")],
            });
            LynvoPanel.currentPanel = new LynvoPanel(panel, extensionUri);
            LynvoPanel.currentPanel._panel.webview.postMessage({
                command: "switchView",
                view: initialView,
            });
        }
    }
    static async refreshData() {
        if (LynvoPanel.currentPanel) {
            const board = await _DataManager__WEBPACK_IMPORTED_MODULE_1__.DataManager.loadBoard();
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
            disposable?.dispose();
        }
    }
    _setWebviewMessageListener(webview) {
        webview.onDidReceiveMessage(async (message) => {
            switch (message.command) {
                case "requestData": {
                    const board = await _DataManager__WEBPACK_IMPORTED_MODULE_1__.DataManager.loadBoard();
                    webview.postMessage({ command: "loadData", data: board });
                    return;
                }
                case "updateTaskStatus":
                    await _DataManager__WEBPACK_IMPORTED_MODULE_1__.DataManager.updateTaskStatus(message.taskId, message.newStatus);
                    LynvoPanel.refreshData();
                    return;
                case "reorderTasks":
                    await _DataManager__WEBPACK_IMPORTED_MODULE_1__.DataManager.reorderTasks(message.updates);
                    LynvoPanel.refreshData();
                    return;
                case "createTask":
                    await _DataManager__WEBPACK_IMPORTED_MODULE_1__.DataManager.createTask(message.title, message.description, message.targetColId, message.labelIds, message.codeReference, message.priority, message.dueDate);
                    LynvoPanel.refreshData();
                    return;
                case "editTask":
                    await _DataManager__WEBPACK_IMPORTED_MODULE_1__.DataManager.editTask(message.taskId, message.title, message.description, message.labelIds, message.priority, message.dueDate);
                    LynvoPanel.refreshData();
                    return;
                case "deleteTask": {
                    const confirmTask = await vscode__WEBPACK_IMPORTED_MODULE_0__.window.showWarningMessage("Delete task?", { modal: true }, "Delete");
                    if (confirmTask === "Delete") {
                        await _DataManager__WEBPACK_IMPORTED_MODULE_1__.DataManager.deleteTask(message.taskId);
                        LynvoPanel.refreshData();
                    }
                    return;
                }
                case "createColumn":
                    await _DataManager__WEBPACK_IMPORTED_MODULE_1__.DataManager.createColumn(message.title, message.color);
                    LynvoPanel.refreshData();
                    return;
                case "editColumn":
                    await _DataManager__WEBPACK_IMPORTED_MODULE_1__.DataManager.editColumn(message.colId, message.title, message.color);
                    LynvoPanel.refreshData();
                    return;
                case "deleteColumn": {
                    const confirmCol = await vscode__WEBPACK_IMPORTED_MODULE_0__.window.showWarningMessage("Delete column? ALL TASKS inside will be deleted.", { modal: true }, "Delete");
                    if (confirmCol === "Delete") {
                        await _DataManager__WEBPACK_IMPORTED_MODULE_1__.DataManager.deleteColumn(message.colId);
                        LynvoPanel.refreshData();
                    }
                    return;
                }
                case "reorderColumns":
                    await _DataManager__WEBPACK_IMPORTED_MODULE_1__.DataManager.reorderColumns(message.updates);
                    LynvoPanel.refreshData();
                    return;
                case "createLabel":
                    await _DataManager__WEBPACK_IMPORTED_MODULE_1__.DataManager.createLabel(message.name, message.color);
                    LynvoPanel.refreshData();
                    return;
                case "deleteLabel":
                    await _DataManager__WEBPACK_IMPORTED_MODULE_1__.DataManager.deleteLabel(message.labelId);
                    LynvoPanel.refreshData();
                    return;
                case "syncBoard": {
                    const result = await _GitService__WEBPACK_IMPORTED_MODULE_2__.GitService.syncBoard();
                    if (result.success) {
                        vscode__WEBPACK_IMPORTED_MODULE_0__.window.showInformationMessage(result.message);
                    }
                    else {
                        vscode__WEBPACK_IMPORTED_MODULE_0__.window.showWarningMessage(result.message);
                    }
                    LynvoPanel.refreshData();
                    return;
                }
                case "openCode": {
                    const folders = vscode__WEBPACK_IMPORTED_MODULE_0__.workspace.workspaceFolders;
                    if (!folders || folders.length === 0)
                        return;
                    const fileUri = vscode__WEBPACK_IMPORTED_MODULE_0__.Uri.joinPath(folders[0].uri, message.filePath);
                    const doc = await vscode__WEBPACK_IMPORTED_MODULE_0__.workspace.openTextDocument(fileUri);
                    const editor = await vscode__WEBPACK_IMPORTED_MODULE_0__.window.showTextDocument(doc, vscode__WEBPACK_IMPORTED_MODULE_0__.ViewColumn.Beside);
                    const pos = new vscode__WEBPACK_IMPORTED_MODULE_0__.Position(message.lineStart - 1, 0);
                    editor.selection = new vscode__WEBPACK_IMPORTED_MODULE_0__.Selection(pos, pos);
                    editor.revealRange(new vscode__WEBPACK_IMPORTED_MODULE_0__.Range(pos, pos), vscode__WEBPACK_IMPORTED_MODULE_0__.TextEditorRevealType.InCenter);
                    return;
                }
            }
        }, undefined, this._disposables);
    }
    _getWebviewContent(webview, extensionUri) {
        const scriptUri = webview.asWebviewUri(vscode__WEBPACK_IMPORTED_MODULE_0__.Uri.joinPath(extensionUri, "dist", "webview.js"));
        const nonce = getNonce();
        return `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>
            body { overflow-x: hidden; font-family: var(--vscode-font-family); }
            .icon-btn { cursor: pointer; opacity: 0.7; background: transparent; border: none; color: var(--vscode-foreground); font-size: 14px; }
            .icon-btn:hover { opacity: 1; }
            .icon-btn.delete:hover { color: var(--vscode-errorForeground); }
            input, textarea, select { background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border); border-radius: 4px; }
            button { border-radius: 4px; }
            input[type="color"] { -webkit-appearance: none; border: none; width: 25px; height: 25px; cursor: pointer; padding: 0; background: transparent; }
            input[type="color"]::-webkit-color-swatch-wrapper { padding: 0; }
            input[type="color"]::-webkit-color-swatch { border: 1px solid var(--vscode-widget-border); border-radius: 4px; }
        </style></head><body><div id="root"></div><script nonce="${nonce}" src="${scriptUri}"></script></body></html>`;
    }
}
function getNonce() {
    let t = "";
    const p = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    for (let i = 0; i < 32; i++) {
        t += p.charAt(Math.floor(Math.random() * p.length));
    }
    return t;
}


/***/ },

/***/ "vscode"
/*!*************************!*\
  !*** external "vscode" ***!
  \*************************/
(module) {

module.exports = require("vscode");

/***/ },

/***/ "child_process"
/*!********************************!*\
  !*** external "child_process" ***!
  \********************************/
(module) {

module.exports = require("child_process");

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
/******/ 		__webpack_modules__[moduleId](module, module.exports, __webpack_require__);
/******/ 	
/******/ 		// Return the exports of the module
/******/ 		return module.exports;
/******/ 	}
/******/ 	
/************************************************************************/
/******/ 	/* webpack/runtime/compat get default export */
/******/ 	(() => {
/******/ 		// getDefaultExport function for compatibility with non-harmony modules
/******/ 		__webpack_require__.n = (module) => {
/******/ 			var getter = module && module.__esModule ?
/******/ 				() => (module['default']) :
/******/ 				() => (module);
/******/ 			__webpack_require__.d(getter, { a: getter });
/******/ 			return getter;
/******/ 		};
/******/ 	})();
/******/ 	
/******/ 	/* webpack/runtime/define property getters */
/******/ 	(() => {
/******/ 		// define getter functions for harmony exports
/******/ 		__webpack_require__.d = (exports, definition) => {
/******/ 			for(var key in definition) {
/******/ 				if(__webpack_require__.o(definition, key) && !__webpack_require__.o(exports, key)) {
/******/ 					Object.defineProperty(exports, key, { enumerable: true, get: definition[key] });
/******/ 				}
/******/ 			}
/******/ 		};
/******/ 	})();
/******/ 	
/******/ 	/* webpack/runtime/hasOwnProperty shorthand */
/******/ 	(() => {
/******/ 		__webpack_require__.o = (obj, prop) => (Object.prototype.hasOwnProperty.call(obj, prop))
/******/ 	})();
/******/ 	
/******/ 	/* webpack/runtime/make namespace object */
/******/ 	(() => {
/******/ 		// define __esModule on exports
/******/ 		__webpack_require__.r = (exports) => {
/******/ 			if(typeof Symbol !== 'undefined' && Symbol.toStringTag) {
/******/ 				Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' });
/******/ 			}
/******/ 			Object.defineProperty(exports, '__esModule', { value: true });
/******/ 		};
/******/ 	})();
/******/ 	
/************************************************************************/
var __webpack_exports__ = {};
// This entry needs to be wrapped in an IIFE because it needs to be isolated against other modules in the chunk.
(() => {
/*!**************************!*\
  !*** ./src/extension.ts ***!
  \**************************/
__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   activate: () => (/* binding */ activate),
/* harmony export */   deactivate: () => (/* binding */ deactivate)
/* harmony export */ });
/* harmony import */ var vscode__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! vscode */ "vscode");
/* harmony import */ var vscode__WEBPACK_IMPORTED_MODULE_0___default = /*#__PURE__*/__webpack_require__.n(vscode__WEBPACK_IMPORTED_MODULE_0__);
/* harmony import */ var _providers_AuthProvider__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! ./providers/AuthProvider */ "./src/providers/AuthProvider.ts");
/* harmony import */ var _providers_LynvoPanel__WEBPACK_IMPORTED_MODULE_2__ = __webpack_require__(/*! ./providers/LynvoPanel */ "./src/providers/LynvoPanel.ts");
/* harmony import */ var _providers_DataManager__WEBPACK_IMPORTED_MODULE_3__ = __webpack_require__(/*! ./providers/DataManager */ "./src/providers/DataManager.ts");
/* harmony import */ var _providers_LynvoMenuProvider__WEBPACK_IMPORTED_MODULE_4__ = __webpack_require__(/*! ./providers/LynvoMenuProvider */ "./src/providers/LynvoMenuProvider.ts");
/* harmony import */ var _providers_GitService__WEBPACK_IMPORTED_MODULE_5__ = __webpack_require__(/*! ./providers/GitService */ "./src/providers/GitService.ts");






async function quickCreateTask() {
    const board = await _providers_DataManager__WEBPACK_IMPORTED_MODULE_3__.DataManager.loadBoard();
    if (!board) {
        vscode__WEBPACK_IMPORTED_MODULE_0__.window.showWarningMessage("No se encontró el tablero de Lynvo. Abre una carpeta de proyecto primero.");
        return;
    }
    const title = await vscode__WEBPACK_IMPORTED_MODULE_0__.window.showInputBox({
        prompt: "Título de la tarea",
        validateInput: (value) => value.trim().length === 0 ? "El título no puede estar vacío." : null,
    });
    if (!title)
        return;
    const description = (await vscode__WEBPACK_IMPORTED_MODULE_0__.window.showInputBox({
        prompt: "Descripción (opcional)",
        placeHolder: "Contexto breve de la tarea...",
    })) || "";
    const sortedColumns = Object.values(board.columns).sort((a, b) => a.position - b.position);
    const selectedColumn = await vscode__WEBPACK_IMPORTED_MODULE_0__.window.showQuickPick(sortedColumns.map((column) => ({
        label: column.title,
        description: column.id,
        columnId: column.id,
    })), {
        title: "Selecciona la columna inicial",
        placeHolder: "¿En qué columna quieres crear la tarea?",
    });
    if (!selectedColumn)
        return;
    await _providers_DataManager__WEBPACK_IMPORTED_MODULE_3__.DataManager.createTask(title.trim(), description, selectedColumn.columnId);
    vscode__WEBPACK_IMPORTED_MODULE_0__.window.showInformationMessage("Tarea creada correctamente en Lynvo.");
    _providers_LynvoPanel__WEBPACK_IMPORTED_MODULE_2__.LynvoPanel.refreshData();
}
function activate(context) {
    const lynvoMenuProvider = new _providers_LynvoMenuProvider__WEBPACK_IMPORTED_MODULE_4__.LynvoMenuProvider();
    const treeDataRegistration = vscode__WEBPACK_IMPORTED_MODULE_0__.window.registerTreeDataProvider("lynvo.sidebarMenu", lynvoMenuProvider);
    _providers_DataManager__WEBPACK_IMPORTED_MODULE_3__.DataManager.initializeBoard().catch((err) => console.error("Lynvo Init Error:", err));
    context.subscriptions.push(treeDataRegistration);
    context.subscriptions.push(vscode__WEBPACK_IMPORTED_MODULE_0__.commands.registerCommand("lynvo.connectGitHub", async () => {
        const user = await _providers_AuthProvider__WEBPACK_IMPORTED_MODULE_1__.AuthProvider.getGitHubUser({ createIfNone: true });
        if (user) {
            vscode__WEBPACK_IMPORTED_MODULE_0__.window.showInformationMessage(`Conectado como: ${user.username}`);
        }
    }));
    context.subscriptions.push(vscode__WEBPACK_IMPORTED_MODULE_0__.commands.registerCommand("lynvo.testAuth", async () => {
        const user = await _providers_AuthProvider__WEBPACK_IMPORTED_MODULE_1__.AuthProvider.getGitHubUser({ createIfNone: true });
        if (user) {
            vscode__WEBPACK_IMPORTED_MODULE_0__.window.showInformationMessage(`Conectado como: ${user.username}`);
        }
    }));
    context.subscriptions.push(vscode__WEBPACK_IMPORTED_MODULE_0__.commands.registerCommand("lynvo.openBoard", () => {
        _providers_LynvoPanel__WEBPACK_IMPORTED_MODULE_2__.LynvoPanel.render(context.extensionUri, "board");
    }));
    context.subscriptions.push(vscode__WEBPACK_IMPORTED_MODULE_0__.commands.registerCommand("lynvo.openInsights", () => {
        _providers_LynvoPanel__WEBPACK_IMPORTED_MODULE_2__.LynvoPanel.render(context.extensionUri, "insights");
    }));
    context.subscriptions.push(vscode__WEBPACK_IMPORTED_MODULE_0__.commands.registerCommand("lynvo.openLabels", () => {
        _providers_LynvoPanel__WEBPACK_IMPORTED_MODULE_2__.LynvoPanel.render(context.extensionUri, "labels");
    }));
    context.subscriptions.push(vscode__WEBPACK_IMPORTED_MODULE_0__.commands.registerCommand("lynvo.syncBoard", async () => {
        const result = await _providers_GitService__WEBPACK_IMPORTED_MODULE_5__.GitService.syncBoard();
        if (result.success) {
            vscode__WEBPACK_IMPORTED_MODULE_0__.window.showInformationMessage(result.message);
        }
        else {
            vscode__WEBPACK_IMPORTED_MODULE_0__.window.showWarningMessage(result.message);
        }
        _providers_LynvoPanel__WEBPACK_IMPORTED_MODULE_2__.LynvoPanel.refreshData();
    }));
    context.subscriptions.push(vscode__WEBPACK_IMPORTED_MODULE_0__.commands.registerCommand("lynvo.quickCreateTask", async () => {
        await quickCreateTask();
    }));
    context.subscriptions.push(vscode__WEBPACK_IMPORTED_MODULE_0__.commands.registerCommand("lynvo.createTaskFromCode", async () => {
        const editor = vscode__WEBPACK_IMPORTED_MODULE_0__.window.activeTextEditor;
        if (!editor) {
            vscode__WEBPACK_IMPORTED_MODULE_0__.window.showErrorMessage("No hay ningún archivo abierto.");
            return;
        }
        const selection = editor.selection;
        const text = editor.document.getText(selection).trim();
        if (!text) {
            vscode__WEBPACK_IMPORTED_MODULE_0__.window.showErrorMessage("Selecciona un fragmento de código primero.");
            return;
        }
        const title = await vscode__WEBPACK_IMPORTED_MODULE_0__.window.showInputBox({
            prompt: "Título de la tarea",
            validateInput: (value) => value.trim().length === 0 ? "El título no puede estar vacío." : null,
        });
        if (!title)
            return;
        const codeRef = {
            filePath: vscode__WEBPACK_IMPORTED_MODULE_0__.workspace.asRelativePath(editor.document.uri),
            lineStart: selection.start.line + 1,
            lineEnd: selection.end.line + 1,
        };
        await _providers_DataManager__WEBPACK_IMPORTED_MODULE_3__.DataManager.createTask(title.trim(), text, undefined, [], codeRef);
        vscode__WEBPACK_IMPORTED_MODULE_0__.window.showInformationMessage("Tarea creada en Lynvo.");
        _providers_LynvoPanel__WEBPACK_IMPORTED_MODULE_2__.LynvoPanel.refreshData();
    }));
}
function deactivate() { }

})();

var __webpack_export_target__ = exports;
for(var __webpack_i__ in __webpack_exports__) __webpack_export_target__[__webpack_i__] = __webpack_exports__[__webpack_i__];
if(__webpack_exports__.__esModule) Object.defineProperty(__webpack_export_target__, "__esModule", { value: true });
/******/ })()
;
//# sourceMappingURL=extension.js.map