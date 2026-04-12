import * as vscode from "vscode";
import { CodeReference, LynvoBoard, LynvoTask } from "../types";
import { AuthProvider } from "./AuthProvider";

export class DataManager {
  private static readonly FILENAME = "lynvo.json";
  private static readonly FOLDER = ".vscode";

  private static getWorkspaceUri(): vscode.Uri | undefined {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) return undefined;
    return workspaceFolders[0].uri;
  }

  private static getFolderUri(): vscode.Uri | undefined {
    const workspace = this.getWorkspaceUri();
    if (!workspace) return undefined;
    return vscode.Uri.joinPath(workspace, this.FOLDER);
  }

  private static getFileUri(): vscode.Uri | undefined {
    const folderUri = this.getFolderUri();
    if (!folderUri) return undefined;
    return vscode.Uri.joinPath(folderUri, this.FILENAME);
  }

  private static getDefaultBoard(): LynvoBoard {
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

  private static ensureBoardIntegrity(board: LynvoBoard): LynvoBoard {
    if (!board.columns || Object.keys(board.columns).length === 0) {
      board.columns = this.getDefaultBoard().columns;
    }

    if (!board.labels) {
      board.labels = this.getDefaultBoard().labels;
    }

    if (!board.tasks) {
      board.tasks = {};
    }

    const sortedColumns = Object.values(board.columns).sort(
      (a, b) => a.position - b.position,
    );
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

  public static async initializeBoard(): Promise<void> {
    const fileUri = this.getFileUri();
    const folderUri = this.getFolderUri();
    if (!fileUri || !folderUri) return;

    try {
      await vscode.workspace.fs.createDirectory(folderUri);
      await vscode.workspace.fs.stat(fileUri);
      const board = await this.loadBoard();
      if (board) {
        await this.saveBoard(this.ensureBoardIntegrity(board));
      }
    } catch {
      await this.saveBoard(this.getDefaultBoard());
    }
  }

  public static async loadBoard(): Promise<LynvoBoard | null> {
    const fileUri = this.getFileUri();
    if (!fileUri) return null;

    try {
      const fileData = await vscode.workspace.fs.readFile(fileUri);
      const parsed = JSON.parse(Buffer.from(fileData).toString("utf8")) as LynvoBoard;
      return this.ensureBoardIntegrity(parsed);
    } catch {
      return null;
    }
  }

  public static async saveBoard(board: LynvoBoard): Promise<void> {
    const fileUri = this.getFileUri();
    const folderUri = this.getFolderUri();
    if (!fileUri || !folderUri) return;

    await vscode.workspace.fs.createDirectory(folderUri);
    const data = Buffer.from(
      JSON.stringify(this.ensureBoardIntegrity(board), null, 2),
      "utf8",
    );
    await vscode.workspace.fs.writeFile(fileUri, data);
  }

  public static async updateTaskStatus(
    taskId: string,
    newStatus: string,
  ): Promise<void> {
    const board = await this.loadBoard();
    if (!board || !board.tasks[taskId] || !board.columns[newStatus]) return;

    const user = await AuthProvider.getGitHubUser();
    board.tasks[taskId].status = newStatus;
    board.tasks[taskId].updatedAt = Date.now();
    if (user) board.tasks[taskId].lastModifiedBy = user;

    await this.saveBoard(board);
  }

  public static async reorderTasks(
    updates: Array<{
      id: string;
      status: string;
      position: number;
      isDraggedTask?: boolean;
    }>,
  ): Promise<void> {
    const board = await this.loadBoard();
    if (!board) return;

    const user = await AuthProvider.getGitHubUser();
    updates.forEach((upd) => {
      if (!board.tasks[upd.id] || !board.columns[upd.status]) return;

      board.tasks[upd.id].status = upd.status;
      board.tasks[upd.id].position = upd.position;
      if (upd.isDraggedTask) {
        board.tasks[upd.id].updatedAt = Date.now();
        if (user) board.tasks[upd.id].lastModifiedBy = user;
      }
    });

    await this.saveBoard(board);
  }

  public static async createTask(
    title: string,
    description: string,
    targetColId?: string,
    labelIds: string[] = [],
    codeReference?: CodeReference,
    priority: LynvoTask["priority"] = "medium",
    dueDate?: number,
  ): Promise<void> {
    const board = await this.loadBoard();
    if (!board) return;

    const user = await AuthProvider.getGitHubUser();
    const taskId = `task-${Date.now()}`;

    let status = targetColId;
    if (!status || !board.columns[status]) {
      const sortedCols = Object.values(board.columns).sort(
        (a, b) => a.position - b.position,
      );
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

  public static async editTask(
    taskId: string,
    title: string,
    description: string,
    labelIds: string[] = [],
    priority: LynvoTask["priority"] = "medium",
    dueDate?: number,
  ): Promise<void> {
    const board = await this.loadBoard();
    if (!board || !board.tasks[taskId]) return;

    const user = await AuthProvider.getGitHubUser();
    board.tasks[taskId].title = title;
    board.tasks[taskId].description = description;
    board.tasks[taskId].labelIds = labelIds;
    board.tasks[taskId].priority = priority;
    board.tasks[taskId].dueDate = dueDate;
    board.tasks[taskId].updatedAt = Date.now();

    if (user) board.tasks[taskId].lastModifiedBy = user;
    await this.saveBoard(board);
  }

  public static async deleteTask(taskId: string): Promise<void> {
    const board = await this.loadBoard();
    if (!board) return;

    delete board.tasks[taskId];
    await this.saveBoard(board);
  }

  public static async createColumn(title: string, color: string): Promise<void> {
    const board = await this.loadBoard();
    if (!board) return;

    const colId = `col-${Date.now()}`;
    const position = Object.keys(board.columns).length;
    board.columns[colId] = { id: colId, title, color, position };

    await this.saveBoard(board);
  }

  public static async editColumn(
    id: string,
    title: string,
    color: string,
  ): Promise<void> {
    const board = await this.loadBoard();
    if (!board || !board.columns[id]) return;

    board.columns[id].title = title;
    board.columns[id].color = color;
    await this.saveBoard(board);
  }

  public static async deleteColumn(id: string): Promise<void> {
    const board = await this.loadBoard();
    if (!board || !board.columns[id]) return;

    const columnsCount = Object.keys(board.columns).length;
    if (columnsCount <= 1) {
      vscode.window.showWarningMessage(
        "No puedes eliminar la última columna del tablero.",
      );
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

  public static async reorderColumns(
    updates: { id: string; position: number }[],
  ): Promise<void> {
    const board = await this.loadBoard();
    if (!board) return;

    updates.forEach((upd) => {
      if (board.columns[upd.id]) {
        board.columns[upd.id].position = upd.position;
      }
    });

    await this.saveBoard(board);
  }

  public static async createLabel(name: string, color: string): Promise<void> {
    const board = await this.loadBoard();
    if (!board) return;

    if (!board.labels) board.labels = {};
    const labelId = `label-${Date.now()}`;
    board.labels[labelId] = { id: labelId, name, color };

    await this.saveBoard(board);
  }

  public static async deleteLabel(labelId: string): Promise<void> {
    const board = await this.loadBoard();
    if (!board || !board.labels || !board.labels[labelId]) return;

    delete board.labels[labelId];

    Object.values(board.tasks).forEach((task) => {
      task.labelIds = (task.labelIds || []).filter((id) => id !== labelId);
    });

    await this.saveBoard(board);
  }
}
