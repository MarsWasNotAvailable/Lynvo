// src/providers/LynvoMenuProvider.ts
import * as vscode from "vscode";

export class LynvoMenuProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: vscode.TreeItem): Thenable<vscode.TreeItem[]> {
    if (element) {
      return Promise.resolve([]);
    } else {
      return Promise.resolve([
        this.createMenuItem(
          "🚀 Open Board",
          "lynvo.openBoard",
          "Abre el tablero principal de Kanban",
        ),
        this.createMenuItem(
          "➕ Add Task from Code",
          "lynvo.createTaskFromCode",
          "Crea una tarea a partir de tu selección actual",
        ),
      ]);
    }
  }

  private createMenuItem(
    label: string,
    command: string,
    tooltip: string,
  ): vscode.TreeItem {
    const item = new vscode.TreeItem(
      label,
      vscode.TreeItemCollapsibleState.None,
    );
    item.command = { command: command, title: label };
    item.tooltip = tooltip;
    return item;
  }
}
