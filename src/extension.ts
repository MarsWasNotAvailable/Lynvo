// src/extension.ts
import * as vscode from "vscode";
import { DataManager } from "./providers/DataManager";
import { AuthProvider } from "./providers/AuthProvider";
import { LynvoPanel } from "./providers/LynvoPanel";
import { SidebarProvider } from "./providers/SidebarProvider";

export async function activate(context: vscode.ExtensionContext) {
  console.log('¡La extensión "Lynvo" se ha activado!');

  await DataManager.initializeBoard();

  const sidebarProvider = new SidebarProvider();
  vscode.window.registerTreeDataProvider("lynvo.sidebarMenu", sidebarProvider);

  let testAuthCommand = vscode.commands.registerCommand(
    "lynvo.testAuth",
    async () => {
      vscode.window.showInformationMessage("Lynvo: Conectando con GitHub...");
      const user = await AuthProvider.getGitHubUser();
      if (user) {
        vscode.window.showInformationMessage(`¡Hola ${user.username}!`);
      }
    },
  );

  let openBoardCommand = vscode.commands.registerCommand(
    "lynvo.openBoard",
    () => {
      LynvoPanel.render(context.extensionUri);
    },
  );

  // NUEVO: Comando para crear tareas seleccionando código
  let createFromCodeCommand = vscode.commands.registerCommand(
    "lynvo.createTaskFromCode",
    async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showWarningMessage(
          "No hay ningún archivo abierto para vincular.",
        );
        return;
      }

      const selection = editor.selection;
      const text = editor.document.getText(selection);

      // Pedimos al usuario el título de la tarea
      const title = await vscode.window.showInputBox({
        prompt: "Título para la tarea de Lynvo",
        placeHolder: "Ej: Refactorizar esta función",
      });

      if (!title) return; // Si pulsa Escape, cancelamos

      // Calculamos la ruta del archivo relativa al proyecto
      const workspaceFolder = vscode.workspace.getWorkspaceFolder(
        editor.document.uri,
      );
      const filePath = workspaceFolder
        ? vscode.workspace.asRelativePath(editor.document.uri)
        : editor.document.uri.fsPath;

      const codeRef = {
        filePath: filePath,
        lineStart: selection.start.line + 1, // Sumamos 1 porque las líneas empiezan en 0 en la API
        lineEnd: selection.end.line + 1,
      };

      const description =
        text.length > 0
          ? `Código vinculado:\n${text}`
          : "Tarea creada desde un archivo.";

      // Creamos la tarea y forzamos la actualización de la interfaz visual
      await DataManager.createTask(title, description, codeRef);
      await LynvoPanel.refreshData();

      vscode.window.showInformationMessage(
        "¡Tarea vinculada a Lynvo con éxito!",
      );
    },
  );

  context.subscriptions.push(
    testAuthCommand,
    openBoardCommand,
    createFromCodeCommand,
  );
}

export function deactivate() {}
