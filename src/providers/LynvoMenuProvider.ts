import * as vscode from "vscode";

interface MenuItem {
  label: string;
  command: string;
  tooltip: string;
}

export class LynvoMenuProvider
  implements vscode.TreeDataProvider<vscode.TreeItem>
{
  private readonly menuItems: MenuItem[] = [
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

  getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: vscode.TreeItem): Thenable<vscode.TreeItem[]> {
    if (element) {
      return Promise.resolve([]);
    }

    return Promise.resolve(
      this.menuItems.map((item) =>
        this.createMenuItem(item.label, item.command, item.tooltip),
      ),
    );
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
    item.command = { command, title: label };
    item.tooltip = tooltip;
    return item;
  }
}
