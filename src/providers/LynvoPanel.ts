import * as vscode from "vscode";
import { DataManager } from "./DataManager";
import { GitService } from "./GitService";
import { getWebviewBundle, t } from "../l10n";
import { LynvoBoard, LynvoTaskRelationType } from "../types";
import {
  findMarkerLineIndex,
  isInCodeEditingEnabled,
  readTodoComment,
  removeMarkerFromFile,
  removeTodoCommentFromFile,
  replaceTodoComment,
} from "./TodoTracker";
import type { TodoBodyChecklistItem, TodoCommentPayload } from "./TodoTracker";

/** State of a promoted task's link to its in-code TODO comment. */
type CodeLinkState = "synced" | "diverged" | "broken";

/**
 * For every linked task, read the linked file (live buffer or disk)
 * and classify the link:
 * `synced` (file matches the board),
 * `diverged` (marker present but text differs),
 * `broken` (file or marker no longer found).
 */
async function computeCodeLinkStates(
  board: LynvoBoard | null,
): Promise<Record<string, CodeLinkState>> {
  const states: Record<string, CodeLinkState> = {};
  if (!board) {return states;}
  const linked = Object.values(board.tasks).filter(
    (task) =>
      task.codeReference?.todoId &&
      task.codeReference?.filePath &&
      isSafeWorkspaceRelativePath(task.codeReference.filePath),
  );
  await Promise.all(
    linked.map(async (task) => {
      const parsed = await readTodoComment(
        task.codeReference!.filePath!,
        task.codeReference!.todoId!,
      );
      if (!parsed) {
        states[task.id] = "broken";
        return;
      }
      states[task.id] =
        parsed.title === task.title && parsed.description === task.description
          ? "synced"
          : "diverged";
    }),
  );
  return states;
}

type LynvoView =
  | "board"
  | "table"
  | "activity"
  | "conflicts"
  | "insights"
  | "labels";

type WebviewMessage = {
  command?: string;
  [key: string]: unknown;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const asString = (value: unknown): string | undefined =>
  typeof value === "string" ? value : undefined;

const asStringArray = (value: unknown): string[] | undefined =>
  Array.isArray(value) && value.every((item) => typeof item === "string")
    ? value
    : undefined;

const asNumber = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;

const asBoolean = (value: unknown): boolean | undefined =>
  typeof value === "boolean" ? value : undefined;

const asRelationType = (value: unknown): LynvoTaskRelationType | undefined =>
  value === "blocks" ||
  value === "blocked-by" ||
  value === "related" ||
  value === "duplicates"
    ? value
    : undefined;

const asPriority = (value: unknown): "low" | "medium" | "high" | undefined =>
  value === "low" || value === "medium" || value === "high" ? value : undefined;

const asResolution = (value: unknown): "local" | "remote" | undefined =>
  value === "local" || value === "remote" ? value : undefined;

const asCodeReference = (
  value: unknown,
): {
  filePath: string;
  todoId?: string;
  lineStart?: number;
  lineEnd?: number;
} | undefined => {
  if (!isRecord(value)) {
    return undefined;
  }
  const filePath = asString(value.filePath);
  if (!filePath) {
    return undefined;
  }
  const result: {
    filePath: string;
    todoId?: string;
    lineStart?: number;
    lineEnd?: number;
  } = { filePath };
  const todoId = asString(value.todoId);
  if (todoId) {
    result.todoId = todoId;
  }
  const lineStart = asNumber(value.lineStart);
  if (lineStart !== undefined) {
    result.lineStart = lineStart;
  }
  const lineEnd = asNumber(value.lineEnd);
  if (lineEnd !== undefined) {
    result.lineEnd = lineEnd;
  }
  return result;
};

const isSafeWorkspaceRelativePath = (filePath: string): boolean =>
  !filePath.startsWith("/") &&
  !filePath.startsWith("\\") &&
  !filePath.includes("..") &&
  !/^[a-zA-Z]:[\\/]/.test(filePath);

/** Board-side relation (type + target task id). */
type BoardRelation = { type: LynvoTaskRelationType; targetTaskId: string };

const CODE_SYNC_ERROR =
  "Could not write to the linked code file. The board was not updated — fix the file and try again.";

/**
 * Propagate a linked task's comment content (title, description,
 * and the given or current checklist/relations) to the in-code TODO comment,
 * writing the live/unsaved buffer when available (never forcing a save).
 * Returns false when the file could not be written, so the caller can abort.
 * Note : Also returns true (after doing nothing) when the task is not code-linked.
 */
async function syncLinkedTaskToCode(
  board: LynvoBoard,
  taskId: string,
  override?: {
    title?: string;
    description?: string;
    checklist?: TodoBodyChecklistItem[];
    relations?: BoardRelation[];
  },
): Promise<boolean> {
  const task = board.tasks[taskId];
  const { todoId, filePath } = task?.codeReference || {};
  if (!todoId || !filePath || !isSafeWorkspaceRelativePath(filePath)) {
    return true;
  }
  if (!isInCodeEditingEnabled()) {
    return true;
  }
  const checklist =
    override?.checklist ??
    (task.checklist || []).map((entry) => ({ text: entry.text, done: entry.done }));
  const relations = override?.relations ?? (task.relations || []);
  const payload: TodoCommentPayload = {
    title: override?.title ?? task.title,
    description: override?.description ?? task.description,
    checklist,
    relations: relations.map((relation) => ({
      type: relation.type,
      target: `${relation.targetTaskId} {${board.tasks[relation.targetTaskId]?.title || relation.targetTaskId}}`,
    })),
  };
  return await replaceTodoComment(filePath, todoId, payload);
}

const asTaskReorderUpdates = (
  value: unknown,
): Array<{
  id: string;
  status: string;
  position: number;
  isDraggedTask?: boolean;
}> => {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((item) => {
    if (!isRecord(item)) {
      return [];
    }
    const id = asString(item.id);
    const status = asString(item.status);
    const position = asNumber(item.position);
    if (!id || !status || position === undefined) {
      return [];
    }
    return [
      { id, status, position, isDraggedTask: asBoolean(item.isDraggedTask) },
    ];
  });
};

const asColumnReorderUpdates = (
  value: unknown,
): Array<{ id: string; position: number }> => {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((item) => {
    if (!isRecord(item)) {
      return [];
    }
    const id = asString(item.id);
    const position = asNumber(item.position);
    if (!id || position === undefined) {
      return [];
    }
    return [{ id, position }];
  });
};

export class LynvoPanel {
  public static currentPanel: LynvoPanel | undefined;
  private readonly _panel: vscode.WebviewPanel;
  private _disposables: vscode.Disposable[] = [];

  private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
    this._panel = panel;
    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);
    this._panel.webview.html = this._getWebviewContent(
      this._panel.webview,
      extensionUri,
    );
    this._setWebviewMessageListener(this._panel.webview);
  }

  public static render(
    extensionUri: vscode.Uri,
    initialView: LynvoView = "board",
  ) {
    if (LynvoPanel.currentPanel) {
      LynvoPanel.currentPanel._panel.reveal(vscode.ViewColumn.One);
      LynvoPanel.currentPanel._panel.webview.postMessage({
        command: "switchView",
        view: initialView,
      });
    } else {
      const panel = vscode.window.createWebviewPanel(
        "lynvoBoard",
        t("Lynvo - Project Board"),
        vscode.ViewColumn.One,
        {
          enableScripts: true,
          localResourceRoots: [vscode.Uri.joinPath(extensionUri, "dist")],
        },
      );
      LynvoPanel.currentPanel = new LynvoPanel(panel, extensionUri);
      LynvoPanel.currentPanel._panel.webview.postMessage({
        command: "switchView",
        view: initialView,
      });
    }
  }

  public static async refreshData() {
    if (LynvoPanel.currentPanel) {
      const board = await DataManager.loadBoard();
      const codeLinkStates = await computeCodeLinkStates(board);
      LynvoPanel.currentPanel._panel.webview.postMessage({
        command: "loadData",
        data: board,
        codeLinkStates,
        remotePending: GitService.getRemotePending(),
      });
    }
  }

  private static _stateRefreshTimer: ReturnType<typeof setTimeout> | undefined;

  /** Debounced re-check of the code-link states after a linked file changes. */
  public static scheduleCodeLinkStateRefresh(relPath: string): void {
    if (LynvoPanel._stateRefreshTimer) {
      clearTimeout(LynvoPanel._stateRefreshTimer);
    }
    LynvoPanel._stateRefreshTimer = setTimeout(() => {
      LynvoPanel._stateRefreshTimer = undefined;
      void LynvoPanel.refreshCodeLinkStatesFor(relPath);
    }, 400);
  }

  /** Re-check the link state of a specific linked file and push it to the webview. */
  public static async refreshCodeLinkStatesFor(relPath: string): Promise<void> {
    if (!LynvoPanel.currentPanel) {return;}
    const board = await DataManager.loadBoard();
    const linkedFiles = new Set(
      Object.values(board?.tasks || {})
        .filter(
          (task) =>
            task.codeReference?.filePath &&
            isSafeWorkspaceRelativePath(task.codeReference.filePath),
        )
        .map((task) => task.codeReference!.filePath),
    );
    if (!linkedFiles.has(relPath)) {return;}
    const codeLinkStates = await computeCodeLinkStates(board);
    LynvoPanel.currentPanel._panel.webview.postMessage({
      command: "setCodeLinkStates",
      states: codeLinkStates,
    });
  }

  public static postRemotePending(pending: boolean): void {
    if (LynvoPanel.currentPanel) {
      LynvoPanel.currentPanel._panel.webview.postMessage({
        command: "setRemotePending",
        pending,
      });
    }
  }

  /**
   * Re-seed the open webview with the recently-switched l10n bundle
   * to render the UI with the selected display language.
   */
  public static applyLanguage(): void {
    if (LynvoPanel.currentPanel) {
      // Keep the panel tab title in the active language (t() already re-pointed
      // to the new bundle by setLanguage()).
      LynvoPanel.currentPanel._panel.title = t("Lynvo - Project Board");
      LynvoPanel.currentPanel._panel.webview.postMessage({
        command: "setLanguage",
        bundle: getWebviewBundle(),
      });
    }
  }

  private static async refreshDataAndScheduleSync() {
    await LynvoPanel.refreshData();
    GitService.scheduleBoardSync(15000, (result) => {
      if (result.success) {
        LynvoPanel.refreshData();
      }
    });
  }

  public dispose() {
    LynvoPanel.currentPanel = undefined;
    this._panel.dispose();
    while (this._disposables.length) {
      const disposable = this._disposables.pop();
      disposable?.dispose();
    }
  }

  private _setWebviewMessageListener(webview: vscode.Webview) {
    webview.onDidReceiveMessage(
      async (message: WebviewMessage) => {
        if (!isRecord(message) || !asString(message.command)) {
          return;
        }

        switch (message.command) {
          case "requestData": {
            const board = await DataManager.loadBoard();
            const codeLinkStates = await computeCodeLinkStates(board);
            webview.postMessage({ command: "loadData", data: board, codeLinkStates });
            return;
          }
          case "updateTaskStatus": {
            const taskId = asString(message.taskId);
            const newStatus = asString(message.newStatus);
            if (!taskId || !newStatus) {
              return;
            }
            await DataManager.updateTaskStatus(taskId, newStatus);
            LynvoPanel.refreshDataAndScheduleSync();
            return;
          }
          case "reorderTasks": {
            const updates = asTaskReorderUpdates(message.updates);
            if (updates.length === 0) {
              return;
            }
            await DataManager.reorderTasks(updates);
            LynvoPanel.refreshDataAndScheduleSync();
            return;
          }
          case "createTask": {
            const title = asString(message.title);
            if (!title) {
              return;
            }
            // Task titles are unique: reject a duplicate (case-insensitive).
            const board = await DataManager.loadBoard();
            if (board && DataManager.hasTaskWithTitle(board, title)) {
              // Refuse the creation but keep the Task Creation View open so the
              // user's draft (title, description, ...) is not lost. Surface the
              // reason inline in the webview instead of a one-off popup.
              webview.postMessage({
                command: "createTaskResult",
                success: false,
                error: t('A task named "{0}" already exists. Task names must be unique.', title.trim()),
              });
              return;
            }
            await DataManager.createTask(
              title,
              asString(message.description) || "",
              asString(message.targetColId),
              asStringArray(message.labelIds),
              asCodeReference(message.codeReference),
              asPriority(message.priority),
              asNumber(message.dueDate),
            );
            webview.postMessage({ command: "createTaskResult", success: true });
            LynvoPanel.refreshDataAndScheduleSync();
            return;
          }
          case "editTask": {
            const taskId = asString(message.taskId);
            const title = asString(message.title);
            const description = asString(message.description) || "";
            if (!taskId || !title) {
              return;
            }

            // For a promoted task, the title/description are bound
            // to the in-code TODO comment.
            // Write the code FIRST (live buffer, no forced save);
            // if that fails,
            // do not touch the board so the user can fix the file and retry.
            const board = await DataManager.loadBoard();
            const task = board?.tasks[taskId];
            const todoId = task?.codeReference?.todoId;
            const filePath = task?.codeReference?.filePath;
            const isLinked = Boolean(
              todoId && filePath && isSafeWorkspaceRelativePath(filePath),
            );
            const textChanged =
              isLinked &&
              ((task!.title !== title) || (task!.description !== description));
            if (textChanged) {
              const ok = await syncLinkedTaskToCode(board!, taskId, { title, description });
              if (!ok) {
                vscode.window.showErrorMessage(t(CODE_SYNC_ERROR));
                return;
              }
            }

            await DataManager.editTask(
              taskId,
              title,
              description,
              asStringArray(message.labelIds),
              asPriority(message.priority),
              asNumber(message.dueDate),
            );
            LynvoPanel.refreshDataAndScheduleSync();
            return;
          }
          case "deleteTask": {
            const taskId = asString(message.taskId);
            if (!taskId) {
              return;
            }
            const board = await DataManager.loadBoard();
            const task = board?.tasks[taskId];
            const todoId = task?.codeReference?.todoId;
            const filePath = task?.codeReference?.filePath;
            const hasMarker = Boolean(
              todoId && filePath && isSafeWorkspaceRelativePath(filePath),
            );
            const deleteLabel = t("Delete");
            const confirmTask = await vscode.window.showWarningMessage(
              hasMarker
                ? t("Delete task and remove its Lynvo marker from the file?")
                : t("Delete task?"),
              { modal: true },
              deleteLabel,
            );
            if (confirmTask === deleteLabel) {
              if (todoId && filePath && isSafeWorkspaceRelativePath(filePath)) {
                // Demote: strip the marker token but keep the comment line itself.
                await removeMarkerFromFile(filePath, todoId);
              }
              await DataManager.deleteTask(taskId);
              LynvoPanel.refreshDataAndScheduleSync();
            }
            return;
          }
          case "createColumn": {
            const title = asString(message.title);
            if (!title) {
              return;
            }
            await DataManager.createColumn(
              title,
              asString(message.color) || "var(--vscode-charts-blue)",
            );
            LynvoPanel.refreshDataAndScheduleSync();
            return;
          }
          case "editColumn": {
            const colId = asString(message.colId);
            const title = asString(message.title);
            if (!colId || !title) {
              return;
            }
            await DataManager.editColumn(
              colId,
              title,
              asString(message.color) || "var(--vscode-charts-blue)",
            );
            LynvoPanel.refreshDataAndScheduleSync();
            return;
          }
          case "deleteColumn": {
            const colId = asString(message.colId);
            if (!colId) {
              return;
            }
            const deleteLabel = t("Delete");
            const confirmCol = await vscode.window.showWarningMessage(
              t("Delete column? ALL TASKS inside will be deleted."),
              { modal: true },
              deleteLabel,
            );
            if (confirmCol === deleteLabel) {
              await DataManager.deleteColumn(colId);
              LynvoPanel.refreshDataAndScheduleSync();
            }
            return;
          }
          case "reorderColumns": {
            const updates = asColumnReorderUpdates(message.updates);
            if (updates.length === 0) {
              return;
            }
            await DataManager.reorderColumns(updates);
            LynvoPanel.refreshDataAndScheduleSync();
            return;
          }
          case "createLabel": {
            const name = asString(message.name);
            if (!name) {
              return;
            }
            await DataManager.createLabel(
              name,
              asString(message.color) || "#f85149",
            );
            LynvoPanel.refreshDataAndScheduleSync();
            return;
          }
          case "updateLabel": {
            const labelId = asString(message.labelId);
            if (!labelId) {
              return;
            }
            await DataManager.updateLabel(
              labelId,
              asString(message.name) || "",
              asString(message.color) || "#f85149",
            );
            LynvoPanel.refreshDataAndScheduleSync();
            return;
          }
          case "deleteLabel": {
            const labelId = asString(message.labelId);
            if (!labelId) {
              return;
            }
            await DataManager.deleteLabel(labelId);
            LynvoPanel.refreshDataAndScheduleSync();
            return;
          }
          case "addChecklistItem": {
            const taskId = asString(message.taskId);
            const text = asString(message.text);
            if (!taskId || !text) {
              return;
            }
            const board = await DataManager.loadBoard();
            const task = board?.tasks[taskId];
            if (board && task) {
              const checklist = [
                ...(task.checklist || []).map((entry) => ({ text: entry.text, done: entry.done })),
                { text: text.trim(), done: false },
              ];
              const ok = await syncLinkedTaskToCode(board, taskId, {
                checklist,
                relations: (task.relations || []).map((relation) => ({ type: relation.type, targetTaskId: relation.targetTaskId })),
              });
              if (!ok) {
                vscode.window.showErrorMessage(t(CODE_SYNC_ERROR));
                return;
              }
            }
            await DataManager.addChecklistItem(taskId, text);
            LynvoPanel.refreshDataAndScheduleSync();
            return;
          }
          case "updateChecklistItem": {
            const taskId = asString(message.taskId);
            const itemId = asString(message.itemId);
            if (!taskId || !itemId) {
              return;
            }
            const newText = asString(message.text);
            const newDone = asBoolean(message.done);
            const board = await DataManager.loadBoard();
            const task = board?.tasks[taskId];
            if (board && task) {
              const checklist = (task.checklist || []).map((entry) =>
                entry.id === itemId
                  ? {
                      text: typeof newText === "string" ? newText.trim() : entry.text,
                      done: typeof newDone === "boolean" ? newDone : entry.done,
                    }
                  : { text: entry.text, done: entry.done },
              );
              const ok = await syncLinkedTaskToCode(board, taskId, {
                checklist,
                relations: (task.relations || []).map((relation) => ({ type: relation.type, targetTaskId: relation.targetTaskId })),
              });
              if (!ok) {
                vscode.window.showErrorMessage(t(CODE_SYNC_ERROR));
                return;
              }
            }
            await DataManager.updateChecklistItem(taskId, itemId, {
              text: newText,
              done: newDone,
            });
            LynvoPanel.refreshDataAndScheduleSync();
            return;
          }
          case "deleteChecklistItem": {
            const taskId = asString(message.taskId);
            const itemId = asString(message.itemId);
            if (!taskId || !itemId) {
              return;
            }
            const board = await DataManager.loadBoard();
            const task = board?.tasks[taskId];
            if (board && task) {
              const checklist = (task.checklist || [])
                .filter((entry) => entry.id !== itemId)
                .map((entry) => ({ text: entry.text, done: entry.done }));
              const ok = await syncLinkedTaskToCode(board, taskId, {
                checklist,
                relations: (task.relations || []).map((relation) => ({ type: relation.type, targetTaskId: relation.targetTaskId })),
              });
              if (!ok) {
                vscode.window.showErrorMessage(t(CODE_SYNC_ERROR));
                return;
              }
            }
            await DataManager.deleteChecklistItem(taskId, itemId);
            LynvoPanel.refreshDataAndScheduleSync();
            return;
          }
          case "addTaskRelation": {
            const taskId = asString(message.taskId);
            const targetTaskId = asString(message.targetTaskId);
            const relationType = asRelationType(message.relationType);
            if (!taskId || !targetTaskId || !relationType) {
              return;
            }
            const board = await DataManager.loadBoard();
            const task = board?.tasks[taskId];
            if (board && task) {
              const relations = [
                ...(task.relations || []).map((relation) => ({ type: relation.type, targetTaskId: relation.targetTaskId })),
                { type: relationType, targetTaskId },
              ];
              const ok = await syncLinkedTaskToCode(board, taskId, {
                checklist: (task.checklist || []).map((entry) => ({ text: entry.text, done: entry.done })),
                relations,
              });
              if (!ok) {
                vscode.window.showErrorMessage(t(CODE_SYNC_ERROR));
                return;
              }
            }
            await DataManager.addTaskRelation(
              taskId,
              targetTaskId,
              relationType,
            );
            LynvoPanel.refreshDataAndScheduleSync();
            return;
          }
          case "deleteTaskRelation": {
            const taskId = asString(message.taskId);
            const relationId = asString(message.relationId);
            if (!taskId || !relationId) {
              return;
            }
            const board = await DataManager.loadBoard();
            const task = board?.tasks[taskId];
            if (board && task) {
              const relations = (task.relations || [])
                .filter((relation) => relation.id !== relationId)
                .map((relation) => ({ type: relation.type, targetTaskId: relation.targetTaskId }));
              const ok = await syncLinkedTaskToCode(board, taskId, {
                checklist: (task.checklist || []).map((entry) => ({ text: entry.text, done: entry.done })),
                relations,
              });
              if (!ok) {
                vscode.window.showErrorMessage(t(CODE_SYNC_ERROR));
                return;
              }
            }
            await DataManager.deleteTaskRelation(taskId, relationId);
            LynvoPanel.refreshDataAndScheduleSync();
            return;
          }
          case "resolveConflict": {
            const conflictId = asString(message.conflictId);
            const resolution = asResolution(message.resolution);
            if (!conflictId || !resolution) {
              return;
            }
            await DataManager.resolveConflict(conflictId, resolution);
            LynvoPanel.refreshDataAndScheduleSync();
            return;
          }
          case "syncBoard": {
            const result = await GitService.syncBoard();
            // A sync pulls the remote state, so there are no more pending updates.
            GitService.setRemotePending(false);
            if (result.success && result.hasConflicts) {
              const openConflicts = t("Open conflicts");
              const action = await vscode.window.showWarningMessage(
                t("Lynvo has synchronized the dashboard, but there are still conflicts to resolve."),
                openConflicts,
              );
              if (action === openConflicts) {
                this._panel.webview.postMessage({
                  command: "switchView",
                  view: "conflicts",
                });
              }
            } else if (result.success) {
              vscode.window.showInformationMessage(result.message);
            } else {
              vscode.window.showWarningMessage(result.message);
            }
            LynvoPanel.refreshData();
            return;
          }
          case "openCode": {
            const filePath = asString(message.filePath);
            if (!filePath || !isSafeWorkspaceRelativePath(filePath)) {
              return;
            }
            const folders = vscode.workspace.workspaceFolders;
            if (!folders || folders.length === 0) {
              return;
            }

            let lineNumber: number | undefined;
            const todoId = asString(message.todoId);
            if (todoId) {
              const index = await findMarkerLineIndex(filePath, todoId);
              if (index !== -1) {
                lineNumber = index + 1;
              }
            }
            if (lineNumber === undefined) {
              lineNumber = asNumber(message.lineStart);
            }
            if (lineNumber === undefined) {
              vscode.window.showWarningMessage(
                t("Lynvo could not locate the linked line in the file."),
              );
              return;
            }

            const fileUri = vscode.Uri.joinPath(folders[0].uri, filePath);
            const doc = await vscode.workspace.openTextDocument(fileUri);
            const editor = await vscode.window.showTextDocument(
              doc,
              vscode.ViewColumn.Beside,
            );
            const pos = new vscode.Position(Math.max(0, lineNumber - 1), 0);
            editor.selection = new vscode.Selection(pos, pos);
            editor.revealRange(
              new vscode.Range(pos, pos),
              vscode.TextEditorRevealType.InCenter,
            );
            return;
          }
          case "deleteTodoLine": {
            const taskId = asString(message.taskId);
            if (!taskId) {
              return;
            }
            const board = await DataManager.loadBoard();
            const task = board?.tasks[taskId];
            const todoId = task?.codeReference?.todoId;
            const filePath = task?.codeReference?.filePath;
            if (!todoId || !filePath || !isSafeWorkspaceRelativePath(filePath)) {
              vscode.window.showWarningMessage(
                t("This task is not linked to a Lynvo TODO marker."),
              );
              return;
            }
            const removeLabel = t("Remove");
            const confirm = await vscode.window.showWarningMessage(
              t("Remove the TODO line from {0}? The task stays on the board.", filePath),
              { modal: true },
              removeLabel,
            );
            if (confirm !== removeLabel) {
              return;
            }
            const deleted = await removeTodoCommentFromFile(filePath, todoId);
            if (!deleted) {
              vscode.window.showErrorMessage(
                t("Could not find the Lynvo TODO marker in the file."),
              );
              return;
            }
            // Keep the task on the board; just drop its code link so it stays tracked but untracked in code.
            await DataManager.clearTaskCodeReference(taskId);
            vscode.window.showInformationMessage(
              t("TODO line removed. Task kept on the board."),
            );
            LynvoPanel.refreshDataAndScheduleSync();
            return;
          }
          case "removeCodeRefsForColumn": {
            const colId = asString(message.colId);
            if (!colId) {
              return;
            }
            const board = await DataManager.loadBoard();
            if (!board) {
              return;
            }
            const targets = Object.values(board.tasks)
              .filter(
                (task) =>
                  task.status === colId &&
                  Boolean(task.codeReference?.todoId) &&
                  Boolean(task.codeReference?.filePath) &&
                  isSafeWorkspaceRelativePath(task.codeReference!.filePath!),
              )
              .map((task) => ({
                taskId: task.id,
                todoId: task.codeReference!.todoId!,
                filePath: task.codeReference!.filePath!,
              }));
            if (targets.length === 0) {
              vscode.window.showInformationMessage(
                t("No TODO comments to remove in this column."),
              );
              return;
            }
            const removeComments = t("Remove comments");
            const confirm = await vscode.window.showWarningMessage(
              t(
                "Remove the related TODO comments from code for the {0} task(s) listed in this column?",
                targets.length,
              ),
              { modal: true },
              removeComments,
            );
            if (confirm !== removeComments) {
              return;
            }
            let removed = 0;
            for (const target of targets) {
              const ok = await removeTodoCommentFromFile(
                target.filePath,
                target.todoId,
              );
              if (ok) {
                removed += 1;
              }
              await DataManager.clearTaskCodeReference(target.taskId);
            }
            vscode.window.showInformationMessage(
              removed === targets.length
                ? t("{0} TODO comment(s) removed from your code. Tasks kept on the board.", removed)
                : t("Removed {0} of {1} TODO comments. Some were already gone from the file.", removed, targets.length),
            );
            LynvoPanel.refreshDataAndScheduleSync();
            return;
          }
          case "relinkTodo": {
            const taskId = asString(message.taskId);
            if (!taskId) {
              return;
            }
            const board = await DataManager.loadBoard();
            const task = board?.tasks[taskId];
            const todoId = task?.codeReference?.todoId;
            const filePath = task?.codeReference?.filePath;
            if (!todoId || !filePath || !isSafeWorkspaceRelativePath(filePath)) {
              return;
            }
            const parsed = await readTodoComment(filePath, todoId);
            if (!parsed) {
              vscode.window.showErrorMessage(
                t("Could not find the linked TODO comment in the code."),
              );
              return;
            }
            await DataManager.updateTaskText(taskId, parsed.title, parsed.description);
            vscode.window.showInformationMessage(t("Task re-synced from code."));
            LynvoPanel.refreshDataAndScheduleSync();
            return;
          }
          case "convertBrokenTask": {
            const taskId = asString(message.taskId);
            if (!taskId) {
              return;
            }
            const confirm = t("Convert to normal task");
            const action = await vscode.window.showWarningMessage(
              t("The code linked to this task could not be found (file deleted/renamed, or the marker removed). Convert this promoted task to a normal task? The link will be removed."),
              { modal: true },
              confirm,
            );
            if (action === confirm) {
              await DataManager.clearTaskCodeReference(taskId);
              LynvoPanel.refreshDataAndScheduleSync();
            }
            return;
          }
        }
      },
      undefined,
      this._disposables,
    );
  }

  private _getWebviewContent(
    webview: vscode.Webview,
    extensionUri: vscode.Uri,
  ) {
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(extensionUri, "dist", "webview.js"),
    );
    const nonce = getNonce();
    // Seed the webview with the merged l10n bundle (English base + locale).
    // The `<` escape keeps the JSON safe inside the inline <script> tag.
    const bundle = JSON.stringify(getWebviewBundle()).replace(/</g, "\\u003c");
    const csp = [
      "default-src 'none'",
      `script-src 'nonce-${nonce}'`,
      "style-src 'unsafe-inline'",
      "img-src data: https:",
      "font-src data:",
    ].join("; ");
    return `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta http-equiv="Content-Security-Policy" content="${csp}"><style>
            body { overflow-x: hidden; font-family: var(--vscode-font-family); }
            .icon-btn { cursor: pointer; opacity: 0.7; background: transparent; border: none; color: var(--vscode-foreground); font-size: 14px; }
            .icon-btn:hover { opacity: 1; }
            .icon-btn.delete:hover { color: var(--vscode-errorForeground); }
            input, textarea, select { background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border); border-radius: 4px; }
            button { border-radius: 4px; }
            input[type="color"] { -webkit-appearance: none; border: none; width: 25px; height: 25px; cursor: pointer; padding: 0; background: transparent; }
            input[type="color"]::-webkit-color-swatch-wrapper { padding: 0; }
            input[type="color"]::-webkit-color-swatch { border: 1px solid var(--vscode-widget-border); border-radius: 4px; }
        </style></head><body><div id="root"></div><script nonce="${nonce}">window.__LYNVO_I18N__ = ${bundle};</script><script nonce="${nonce}" src="${scriptUri}"></script></body></html>`;
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
