// src/extension.ts
import * as vscode from "vscode";
import { AuthProvider } from "./providers/AuthProvider";
import { LynvoPanel } from "./providers/LynvoPanel";
import { DataManager } from "./providers/DataManager";
import { LynvoMenuProvider } from "./providers/LynvoMenuProvider";

export function activate(context: vscode.ExtensionContext) {
  // 1. REGISTRAMOS EL MENÚ LATERAL
  const lynvoMenuProvider = new LynvoMenuProvider();
  // Corregido: Ahora coincide exactamente con el ID de tu package.json
  vscode.window.registerTreeDataProvider(
    "lynvo.sidebarMenu",
    lynvoMenuProvider,
  );

  // 2. INICIALIZAMOS LA BASE DE DATOS
  DataManager.initializeBoard().catch((err) =>
    console.error("Lynvo Init Error:", err),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("lynvo.testAuth", async () => {
      const user = await AuthProvider.getGitHubUser();
      if (user) {
        vscode.window.showInformationMessage(
          `Conectado como: ${user.username}`,
        );
      }
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("lynvo.openBoard", () => {
      LynvoPanel.render(context.extensionUri);
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("lynvo.openInsights", () => {
      LynvoPanel.render(context.extensionUri);
      LynvoPanel.setActiveView("insights");
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("lynvo.openLabels", () => {
      LynvoPanel.render(context.extensionUri);
      LynvoPanel.setActiveView("labels");
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("lynvo.syncBoard", async () => {
      const result = await LynvoPanel.syncBoard();
      if (result.success) {
        vscode.window.showInformationMessage(result.message);
      } else {
        vscode.window.showWarningMessage(result.message);
      }
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("lynvo.createTaskQuick", async () => {
      const title = await vscode.window.showInputBox({
        prompt: "Título de la tarea",
      });
      if (!title?.trim()) return;

      const description = await vscode.window.showInputBox({
        prompt: "Descripción (opcional)",
      });

      await DataManager.createTask(title.trim(), description?.trim() || "");
      vscode.window.showInformationMessage("Tarea creada en Lynvo.");
      LynvoPanel.refreshData();
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
      const text = editor.document.getText(selection);
      if (!text) {
        vscode.window.showErrorMessage(
          "Selecciona un fragmento de código primero.",
        );
        return;
      }

      const filePath = vscode.workspace.asRelativePath(editor.document.uri);

      const codeRef = {
        filePath: filePath,
        lineStart: selection.start.line + 1,
        lineEnd: selection.end.line + 1,
      };

      const title = await vscode.window.showInputBox({
        prompt: "Título de la tarea",
      });
      if (!title) return;

      // Usamos el DataManager que ya tienes, que está perfecto
      await DataManager.createTask(title, text, undefined, [], codeRef, "high");

      vscode.window.showInformationMessage("Tarea creada en Lynvo.");
      LynvoPanel.refreshData();
    }),
  );
}

export function deactivate() {}
