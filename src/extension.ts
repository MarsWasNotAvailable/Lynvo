import * as vscode from "vscode";
import { AuthProvider } from "./providers/AuthProvider";
import { LynvoPanel } from "./providers/LynvoPanel";
import { DataManager } from "./providers/DataManager";
import { LynvoMenuProvider } from "./providers/LynvoMenuProvider";
import { GitService } from "./providers/GitService";

async function quickCreateTask(): Promise<void> {
  const board = await DataManager.loadBoard();
  if (!board) {
    vscode.window.showWarningMessage(
      "No se encontró el tablero de Lynvo. Abre una carpeta de proyecto primero.",
    );
    return;
  }

  const title = await vscode.window.showInputBox({
    prompt: "Título de la tarea",
    validateInput: (value) =>
      value.trim().length === 0 ? "El título no puede estar vacío." : null,
  });
  if (!title) return;

  const description =
    (await vscode.window.showInputBox({
      prompt: "Descripción (opcional)",
      placeHolder: "Contexto breve de la tarea...",
    })) || "";

  const sortedColumns = Object.values(board.columns).sort(
    (a, b) => a.position - b.position,
  );

  const selectedColumn = await vscode.window.showQuickPick(
    sortedColumns.map((column) => ({
      label: column.title,
      description: column.id,
      columnId: column.id,
    })),
    {
      title: "Selecciona la columna inicial",
      placeHolder: "¿En qué columna quieres crear la tarea?",
    },
  );

  if (!selectedColumn) return;

  await DataManager.createTask(title.trim(), description, selectedColumn.columnId);
  vscode.window.showInformationMessage("Tarea creada correctamente en Lynvo.");
  LynvoPanel.refreshData();
}

export function activate(context: vscode.ExtensionContext) {
  const lynvoMenuProvider = new LynvoMenuProvider();
  const treeDataRegistration = vscode.window.registerTreeDataProvider(
    "lynvo.sidebarMenu",
    lynvoMenuProvider,
  );

  DataManager.initializeBoard().catch((err) =>
    console.error("Lynvo Init Error:", err),
  );

  context.subscriptions.push(treeDataRegistration);

  context.subscriptions.push(
    vscode.commands.registerCommand("lynvo.connectGitHub", async () => {
      const user = await AuthProvider.getGitHubUser({ createIfNone: true });
      if (user) {
        vscode.window.showInformationMessage(`Conectado como: ${user.username}`);
      }
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("lynvo.testAuth", async () => {
      const user = await AuthProvider.getGitHubUser({ createIfNone: true });
      if (user) {
        vscode.window.showInformationMessage(`Conectado como: ${user.username}`);
      }
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("lynvo.openBoard", () => {
      LynvoPanel.render(context.extensionUri, "board");
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("lynvo.openInsights", () => {
      LynvoPanel.render(context.extensionUri, "insights");
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("lynvo.openLabels", () => {
      LynvoPanel.render(context.extensionUri, "labels");
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("lynvo.syncBoard", async () => {
      const result = await GitService.syncBoard();
      if (result.success) {
        vscode.window.showInformationMessage(result.message);
      } else {
        vscode.window.showWarningMessage(result.message);
      }
      LynvoPanel.refreshData();
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("lynvo.quickCreateTask", async () => {
      await quickCreateTask();
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("lynvo.createTaskFromCode", async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showErrorMessage("No hay ningún archivo abierto.");
        return;
      }

      const selection = editor.selection;
      const text = editor.document.getText(selection).trim();
      if (!text) {
        vscode.window.showErrorMessage(
          "Selecciona un fragmento de código primero.",
        );
        return;
      }

      const title = await vscode.window.showInputBox({
        prompt: "Título de la tarea",
        validateInput: (value) =>
          value.trim().length === 0 ? "El título no puede estar vacío." : null,
      });
      if (!title) return;

      const codeRef = {
        filePath: vscode.workspace.asRelativePath(editor.document.uri),
        lineStart: selection.start.line + 1,
        lineEnd: selection.end.line + 1,
      };

      await DataManager.createTask(title.trim(), text, undefined, [], codeRef);
      vscode.window.showInformationMessage("Tarea creada en Lynvo.");
      LynvoPanel.refreshData();
    }),
  );
}

export function deactivate() {}
