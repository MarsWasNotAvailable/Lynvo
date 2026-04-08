// src/providers/SidebarProvider.ts
import * as vscode from "vscode";

// Creamos un proveedor de datos para una vista de árbol (TreeView) nativa de VS Code
export class SidebarProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(): vscode.ProviderResult<vscode.TreeItem[]> {
    // Opción 1: Botón para abrir el tablero
    const openBoardItem = new vscode.TreeItem(
      "🚀 Abrir Tablero Lynvo",
      vscode.TreeItemCollapsibleState.None,
    );
    openBoardItem.tooltip = "Abre el panel Kanban en pantalla completa";
    openBoardItem.command = {
      command: "lynvo.openBoard",
      title: "Abrir Tablero",
    };

    // Opción 2: Botón para probar la conexión
    const authItem = new vscode.TreeItem(
      "🔐 Conectar GitHub",
      vscode.TreeItemCollapsibleState.None,
    );
    authItem.tooltip = "Verifica tu identidad en GitHub";
    authItem.command = {
      command: "lynvo.testAuth",
      title: "Conectar GitHub",
    };

    // Devolvemos los botones que aparecerán en la barra lateral
    return [openBoardItem, authItem];
  }
}
