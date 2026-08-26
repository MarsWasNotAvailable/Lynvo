import * as vscode from "vscode";
import { AuthProvider } from "./providers/AuthProvider";
import { LynvoPanel } from "./providers/LynvoPanel";
import { DataManager } from "./providers/DataManager";
import { LynvoMenuProvider } from "./providers/LynvoMenuProvider";
import { GitService } from "./providers/GitService";
import { SkillInstaller } from "./providers/SkillInstaller";
import { CodeReference } from "./types";
import {
  appendMarker,
  deriveTitle,
  generateTodoId,
  lineHasMarker,
  lineHasTodoKeyword,
  TODO_KEYWORDS,
} from "./providers/TodoTracker";

function selectionContainsTodo(editor: vscode.TextEditor | undefined): boolean {
  if (!editor || editor.selection.isEmpty) {
    return false;
  }
  const startLine = editor.selection.start.line;
  const endLine = editor.selection.end.line;
  for (let i = startLine; i <= endLine; i++) {
    if (lineHasTodoKeyword(editor.document.lineAt(i).text)) {
      return true;
    }
  }
  return false;
}

function updatePromoteTodoContext(): void {
  const has = selectionContainsTodo(vscode.window.activeTextEditor);
  void vscode.commands.executeCommand("setContext", "lynvo.selectionHasTodo", has);
}

async function createTask(
   title: string,
   description: string,
   columnId: string | undefined,
   codeRef?: CodeReference
): Promise<void> {
   await DataManager.createTask(title.trim(), description, columnId, [], codeRef);
   vscode.window.showInformationMessage("Task created in Lynvo.");
   LynvoPanel.refreshData();
   GitService.scheduleBoardSync();
}

/**
 * Promote the selected source lines that contain a TODO keyword (TODO/IDEA/FIXME)
 * into Lynvo tasks. Each such line gets a unique marker token appended to it, and a
 * task is created that links to the file via that marker (robust to later edits).
 */
async function promoteTodo(): Promise<void> {
   const editor = vscode.window.activeTextEditor;
   if (!editor) {
     vscode.window.showErrorMessage("No file is currently open.");
     return;
   }
   if (!vscode.workspace.getWorkspaceFolder(editor.document.uri)) {
     vscode.window.showErrorMessage(
       "Lynvo can only promote TODOs in files inside the workspace.",
     );
     return;
   }
   if (editor.selection.isEmpty) {
     vscode.window.showErrorMessage("Select one or more TODO lines first.");
     return;
   }

   const startLine = editor.selection.start.line;
   const endLine = editor.selection.end.line;

   type TodoLine = { lineIndex: number; text: string };
   const candidates: TodoLine[] = [];
   for (let i = startLine; i <= endLine; i++) {
     const text = editor.document.lineAt(i).text;
     if (lineHasTodoKeyword(text)) {
       candidates.push({ lineIndex: i, text });
     }
   }

   if (candidates.length === 0) {
     vscode.window.showErrorMessage(
       `No ${TODO_KEYWORDS.join("/")} found in the selection.`,
     );
     return;
   }

   const alreadyTracked = candidates.filter((candidate) => lineHasMarker(candidate.text));
   if (alreadyTracked.length > 0) {
     vscode.window.showErrorMessage(
       "Selection already contains Lynvo-tracked TODO(s). Use 'Lynvo: Remove tracking' first.",
     );
     return;
   }

   const filePath = vscode.workspace.asRelativePath(editor.document.uri);

   const prepared = candidates.map((candidate) => ({
     lineIndex: candidate.lineIndex,
     todoId: generateTodoId(),
     title: deriveTitle(candidate.text),
     description: candidate.text.trim(),
   }));

   // Append each marker to its line through the live document (respects unsaved edits).
   const edit = new vscode.WorkspaceEdit();
   for (const item of prepared) {
     const line = editor.document.lineAt(item.lineIndex);
     edit.replace(
       editor.document.uri,
       new vscode.Range(line.range.start, line.range.end),
       appendMarker(line.text, item.todoId),
     );
   }
   const applied = await vscode.workspace.applyEdit(edit);
   if (!applied) {
     vscode.window.showErrorMessage("Lynvo could not update the file.");
     return;
   }
   await new Promise<void>((resolve) => {
     editor.document.save().then(
       () => resolve(),
       (error) => {
         console.error("Lynvo: failed to save promoted TODO file", error);
         resolve();
       },
     );
   });

   // Create one task per promoted line, linked by the marker token.
   for (const item of prepared) {
     await DataManager.createTask(item.title, item.description, undefined, [], {
       filePath,
       todoId: item.todoId,
     });
   }

   const count = prepared.length;
   vscode.window.showInformationMessage(
     count === 1
       ? "1 TODO promoted to a Lynvo task."
       : `${count} TODOs promoted to Lynvo tasks.`,
   );
   LynvoPanel.refreshData();
   GitService.scheduleBoardSync();
}

async function quickCreateTask(): Promise<void> {
   const board = await DataManager.loadBoard();
   if (!board) {
     vscode.window.showWarningMessage(
       "Lynvo board not found. Open a project folder first.",
     );
     return;
   }

   const title = await vscode.window.showInputBox({
     prompt: "Task title",
     validateInput: (value) =>
       value.trim().length === 0 ? "Title cannot be empty." : null,
   });
   if (!title) {return;}

   const description =
     (await vscode.window.showInputBox({
       prompt: "Description (optional)",
       placeHolder: "Brief context for the task...",
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
       title: "Select initial column",
       placeHolder: "Which column should the task start in?",
     },
   );

   if (!selectedColumn) {return;}

   await createTask(title.trim(), description, selectedColumn.columnId);
}

export function activate(context: vscode.ExtensionContext) {
  const lynvoMenuProvider = new LynvoMenuProvider();
  const treeDataRegistration = vscode.window.registerTreeDataProvider(
    "lynvo.sidebarMenu",
    lynvoMenuProvider,
  );
  let refreshTimer: NodeJS.Timeout | undefined;
  const schedulePanelRefresh = () => {
    if (refreshTimer) {
      clearTimeout(refreshTimer);
    }
    refreshTimer = setTimeout(() => {
      refreshTimer = undefined;
      LynvoPanel.refreshData();
    }, 250);
  };
  const boardWatcher = vscode.workspace.createFileSystemWatcher(
    "**/.vscode/lynvo/**/*.json",
  );
  boardWatcher.onDidChange(schedulePanelRefresh, null, context.subscriptions);
  boardWatcher.onDidCreate(schedulePanelRefresh, null, context.subscriptions);
  boardWatcher.onDidDelete(schedulePanelRefresh, null, context.subscriptions);

  // Keep the "Promote TODO" context-menu item visible only while the active
  // selection contains a known TODO keyword.
  const refreshPromoteContext = () => updatePromoteTodoContext();
  vscode.window.onDidChangeTextEditorSelection(
    refreshPromoteContext,
    null,
    context.subscriptions,
  );
  vscode.window.onDidChangeActiveTextEditor(
    refreshPromoteContext,
    null,
    context.subscriptions,
  );
  updatePromoteTodoContext();

  DataManager.initializeBoard().catch((err) =>
    console.error("Lynvo Init Error:", err),
  );
  DataManager.touchCurrentUser().catch((err) =>
    console.error("Lynvo Presence Error:", err),
  );

  SkillInstaller.installAll(context.extensionUri, context, { silent: true }).then(
    (result) => {
      if (result.installed.length > 0) {
        console.log(`Lynvo: skills installed → ${result.installed.join(", ")}`);
      }
      if (result.errors.length > 0) {
        console.warn(`Lynvo: skill install errors → ${result.errors.join(", ")}`);
      }
    },
  ).catch((err) => console.error("Lynvo Skill Install Error:", err));

  context.subscriptions.push(treeDataRegistration);
  context.subscriptions.push(boardWatcher);
  const autoSyncInterval = setInterval(async () => {
    await DataManager.touchCurrentUser().catch((err) =>
      console.error("Lynvo Presence Error:", err),
    );
    const result = await GitService.syncBoard();
    if (result.success) {
      await LynvoPanel.refreshData();
      if (result.hasConflicts) {
        vscode.window.showWarningMessage(
          "Lynvo detected sync conflicts. Open the Conflict Center to resolve them.",
          "Open conflicts",
        ).then((action) => {
          if (action === "Open conflicts") {
            LynvoPanel.render(context.extensionUri, "conflicts");
          }
        });
        return;
      }
      if (result.remoteChanged) {
        vscode.window.showInformationMessage(
          "Lynvo detected team changes and updated the board.",
        );
      }
    } else {
      console.warn(`Lynvo periodic sync skipped: ${result.message}`);
    }
  }, 120000);

  context.subscriptions.push({
    dispose: () => {
      if (refreshTimer) {
        clearTimeout(refreshTimer);
        refreshTimer = undefined;
      }
      clearInterval(autoSyncInterval);
      GitService.cancelScheduledSync();
    },
  });

  context.subscriptions.push(
    vscode.commands.registerCommand("lynvo.connectGitHub", async () => {
      const user = await AuthProvider.getGitHubUser({ createIfNone: true });
      if (user) {
        await DataManager.touchCurrentUser();
        vscode.window.showInformationMessage(`Connected as: ${user.username}`);
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
    vscode.commands.registerCommand("lynvo.openTable", () => {
      LynvoPanel.render(context.extensionUri, "table");
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("lynvo.openActivity", () => {
      LynvoPanel.render(context.extensionUri, "activity");
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("lynvo.openConflicts", () => {
      LynvoPanel.render(context.extensionUri, "conflicts");
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
      if (result.success && result.hasConflicts) {
        const action = await vscode.window.showWarningMessage(
          "Lynvo synced the board, but there are conflicts to resolve.",
          "Open conflicts",
        );
        if (action === "Open conflicts") {
          LynvoPanel.render(context.extensionUri, "conflicts");
        }
      } else if (result.success) {
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
    vscode.commands.registerCommand("lynvo.promoteTodo", async () => {
      await promoteTodo();
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("lynvo.installSkills", async () => {
      const result = await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: "Lynvo: Installing agent skills...",
          cancellable: false,
        },
        () => SkillInstaller.installAll(context.extensionUri, context, { force: true }),
      );

      const messages: string[] = [];
      if (result.installed.length > 0) {
        messages.push(`Installed: ${result.installed.length} location(s)`);
      }
      if (result.skipped.length > 0) {
        messages.push(`Skipped: ${result.skipped.length} location(s)`);
      }
      if (result.errors.length > 0) {
        messages.push(`Errors: ${result.errors.join("; ")}`);
      }

      if (messages.length === 0) {
        vscode.window.showInformationMessage("Lynvo skills are already up to date.");
      } else {
        const detail = messages.join("\n");
        if (result.errors.length > 0) {
          vscode.window.showWarningMessage(detail);
        } else {
          vscode.window.showInformationMessage(detail);
        }
      }
    }),
  );
}

export function deactivate() {}
