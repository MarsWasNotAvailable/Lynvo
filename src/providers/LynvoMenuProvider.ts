import * as vscode from "vscode";

interface MenuItem {
  label: string;
  command: string;
  tooltip: string;
  icon: string;
}

export class LynvoMenuProvider
  implements vscode.TreeDataProvider<vscode.TreeItem>
{
  private readonly menuItems: MenuItem[] = [
    {
      label: "Open Board",
      command: "lynvo.openBoard",
      tooltip: "Open the main Kanban board",
      icon: "project",
    },
    {
      label: "Open Insights",
      command: "lynvo.openInsights",
      tooltip: "Show project metrics",
      icon: "graph",
    },
    {
      label: "Open Table",
      command: "lynvo.openTable",
      tooltip: "Open the table view of the tasks",
      icon: "table",
    },
    {
      label: "Open Activity",
      command: "lynvo.openActivity",
      tooltip: "Show the previous activities of the team",
      icon: "history",
    },
    {
      label: "Open Conflicts",
      command: "lynvo.openConflicts",
      tooltip: "Show pending conflicts of synchonization",
      icon: "warning",
    },
    {
      label: "Manage Labels",
      command: "lynvo.openLabels",
      tooltip: "Administra etiquetas del tablero",
      icon: "tag",
    },
    {
      label: "New Task",
      command: "lynvo.quickCreateTask",
      tooltip: "Create a new quick task",
      icon: "add",
    },
    {
      label: "Promote TODO to Task",
      command: "lynvo.promoteTodo",
      tooltip: "Promote the selected comments marked with TODO/IDEA/FIXME as tasks",
      icon: "code",
    },
    {
      label: "Sync Team Board",
      command: "lynvo.syncBoard",
      tooltip: "Synchronize Lynvo with the remote lynvo-sync branch",
      icon: "sync",
    },
    {
      label: "Connect GitHub",
      command: "lynvo.connectGitHub",
      tooltip: "Connect your locally assigned identity with your GitHub account",
      icon: "github",
    },
    {
      label: "Install Agent Skills",
      command: "lynvo.installSkills",
      tooltip: "Install the Skill.MD file for coding agents (OpenCode, Claude Code, Cline, Cursor, or others)",
      icon: "robot",
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
        this.createMenuItem(item),
      ),
    );
  }

  private createMenuItem({ label, command, tooltip, icon }: MenuItem): vscode.TreeItem {
    const item = new vscode.TreeItem(
      label,
      vscode.TreeItemCollapsibleState.None,
    );
    item.command = { command, title: label };
    item.tooltip = tooltip;
    item.iconPath = new vscode.ThemeIcon(icon);
    return item;
  }
}
