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
  isTodoCommentLine,
  lineHasMarker,
  TODO_KEYWORDS,
} from "./providers/TodoTracker";
import {
  getAvailableLanguages,
  getLanguageDisplayName,
  initL10n,
  setLanguage,
  t,
} from "./l10n";

function selectionContainsTodo(editor: vscode.TextEditor | undefined): boolean {
  if (!editor || editor.selection.isEmpty) {
    return false;
  }
  const startLine = editor.selection.start.line;
  const endLine = editor.selection.end.line;
  for (let i = startLine; i <= endLine; i++) {
    if (isTodoCommentLine(editor.document.lineAt(i).text)) {
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
   vscode.window.showInformationMessage(t("Task created in Lynvo."));
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
     vscode.window.showErrorMessage(t("No file is currently open."));
     return;
   }
   if (!vscode.workspace.getWorkspaceFolder(editor.document.uri)) {
     vscode.window.showErrorMessage(
       t("Lynvo can only promote TODOs in files inside the workspace."),
     );
     return;
   }
   if (editor.selection.isEmpty) {
     vscode.window.showErrorMessage(t("Select one or more TODO lines first."));
     return;
   }

   const startLine = editor.selection.start.line;
   const endLine = editor.selection.end.line;

   type TodoLine = { lineIndex: number; text: string };
   const candidates: TodoLine[] = [];
   for (let i = startLine; i <= endLine; i++) {
     const text = editor.document.lineAt(i).text;
     if (isTodoCommentLine(text)) {
       candidates.push({ lineIndex: i, text });
     }
   }

   if (candidates.length === 0) {
     vscode.window.showErrorMessage(
       t("No {0} comment found in the selection.", TODO_KEYWORDS.join("/")),
     );
     return;
   }

   const alreadyTracked = candidates.filter((candidate) => lineHasMarker(candidate.text));
   if (alreadyTracked.length > 0) {
     vscode.window.showErrorMessage(
       t("Selection already contains Lynvo-tracked TODO(s). Use 'Lynvo: Remove tracking' first."),
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
     vscode.window.showErrorMessage(t("Lynvo could not update the file."));
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
     await DataManager.createTask(item.title, "" /* empty description for now */, undefined, [], {
       filePath,
       todoId: item.todoId,
     });
   }

   const count = prepared.length;
   vscode.window.showInformationMessage(
     t("{0} TODO(s) promoted to Lynvo tasks.", count)
   );
   LynvoPanel.refreshData();
   GitService.scheduleBoardSync();
}

async function quickCreateTask(): Promise<void> {
   const board = await DataManager.loadBoard();
   if (!board) {
     vscode.window.showWarningMessage(
       t("Lynvo board not found. Open a project folder first."),
     );
     return;
   }

   const title = await vscode.window.showInputBox({
     prompt: t("Task title"),
     validateInput: (value) =>
       value.trim().length === 0 ? t("Title cannot be empty.") : null,
   });
   if (!title) {return;}

   const description =
     (await vscode.window.showInputBox({
       prompt: t("Description (optional)"),
       placeHolder: t("Brief context for the task..."),
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
       title: t("Select initial column"),
       placeHolder: t("Which column should the task start in?"),
     },
   );

   if (!selectedColumn) {return;}

   await createTask(title.trim(), description, selectedColumn.columnId);
}

export function activate(context: vscode.ExtensionContext) {
  // Load the l10n bundle first so every user-facing string resolves to the
  // active VS Code language (falls back to English if the bundle is missing).
  initL10n();
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

  // Provide an early signal if there are remote updates available to pull.
  GitService.checkForRemoteChanges()
    .then((pending) => LynvoPanel.postRemotePending(pending))
    .catch(() => {});

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
    // Periodically check for remote updates to pull (detection only, no push).
    const remotePending = await GitService.checkForRemoteChanges();
    LynvoPanel.postRemotePending(remotePending);
    // Push local changes only when there are pending local changes.
    const board = await DataManager.loadBoard();
    if (!board || !board.sync?.pendingChanges) {
      return;
    }
    const result = await GitService.syncBoard();
    if (result.success) {
      GitService.setRemotePending(false);
      await LynvoPanel.refreshData();
      if (result.hasConflicts) {
        const openConflicts = t("Open conflicts");
        vscode.window.showWarningMessage(
          t("Lynvo detected sync conflicts. Open the Conflict Center to resolve them."),
          openConflicts,
        ).then((action) => {
          if (action === openConflicts) {
            LynvoPanel.render(context.extensionUri, "conflicts");
          }
        });
        return;
      }
      if (result.remoteChanged) {
        vscode.window.showInformationMessage(
          t("Lynvo detected team changes and updated the board."),
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
        vscode.window.showInformationMessage(t("Connected as: {0}", user.username));
      }
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("lynvo.setLanguage", async () => {
      // Languages are auto-detected from the bundle files in localization folder;
      // display names come from the language code itself (no hardcoded map).
      const options: Array<{ id: string; label: string }> = [
        { id: "auto", label: t("Follow VS Code language") },
        ...getAvailableLanguages().map((code) => ({
          id: code,
          label: getLanguageDisplayName(code),
        })),
      ];
      const selected = await vscode.window.showQuickPick(options, {
        title: t("Select interface language"),
        placeHolder: t("Choose the language for the Lynvo interface"),
      });
      if (!selected) {
        return;
      }
      await vscode.workspace
        .getConfiguration("lynvo")
        .update("language", selected.id, vscode.ConfigurationTarget.Global);
      // Re-apply the bundle everywhere: host, sidebar menu, and open webview.
      setLanguage(selected.id);
      lynvoMenuProvider.refresh();
      LynvoPanel.applyLanguage();
      if (selected.id === "auto") {
        vscode.window.showInformationMessage(t("Lynvo follows the VS Code language."));
      } else {
        vscode.window.showInformationMessage(t("Language set to {0}.", selected.label));
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
        const openConflicts = t("Open conflicts");
        const action = await vscode.window.showWarningMessage(
          t("Lynvo synced the board, but there are conflicts to resolve."),
          openConflicts,
        );
        if (action === openConflicts) {
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
          title: t("Lynvo: Installing agent skills..."),
          cancellable: false,
        },
        () => SkillInstaller.installAll(context.extensionUri, context, { force: true }),
      );

      const messages: string[] = [];
      if (result.installed.length > 0) {
        messages.push(t("Installed: {0} location(s)", result.installed.length));
      }
      if (result.skipped.length > 0) {
        messages.push(t("Skipped: {0} location(s)", result.skipped.length));
      }
      if (result.errors.length > 0) {
        messages.push(t("Errors: {0}", result.errors.join("; ")));
      }

      if (messages.length === 0) {
        vscode.window.showInformationMessage(t("Lynvo skills are already up to date."));
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
