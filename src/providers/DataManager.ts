import * as vscode from "vscode";
import {
  CodeReference,
  LynvoActivity,
  LynvoActivityType,
  LynvoBoard,
  LynvoChecklistItem,
  LynvoColumn,
  LynvoConflict,
  LynvoDomain,
  LynvoIdentity,
  LynvoLabel,
  LynvoPresenceUser,
  LynvoSyncMetadata,
  LynvoTask,
  LynvoTaskRelation,
  LynvoTaskRelationType,
  LynvoTombstone,
  LynvoUser,
} from "../types";
import { t } from "../l10n";
import { canonicalizeRelation } from "../relationModel";
import { parseIdentitiesFile, serializeIdentitiesFile } from "../identitiesFile";
import {
  compareSemVer,
  getChangelogUrl,
  getSchemaVersion,
  majorDiffers,
  maxVersion,
  parseSemVer,
} from "../schema";

type BoardMetadata = {
  version: string;
  labels?: Record<string, LynvoLabel>;
};

const UNKNOWN_USER = { githubId: "unknown", username: "Unknown" };

// Map a task relation type to its specific activity type.
// `related` uses the legacy catch-all `relation_added` / `relation_deleted`.
// `blocks` and `blocked-by` are the same edge (reciprocal), so both log :
// `relation_blockedby_*` for consistency (schema 3.0.0 stores only `blocked-by`).
// `relation_block_added` / `relation_block_deleted` are kept for legacy entries.
const generateRelationActivityType = (
  relationType: LynvoTaskRelationType,
  verb: "added" | "deleted",
): LynvoActivityType => {
  switch (relationType) {
    case "blocks":
    case "blocked-by":
      return `relation_blockedby_${verb}`;
    case "duplicates":
      return `relation_duplicates_${verb}`;
    case "related":
    default:
      return `relation_${verb}`;
  }
};

export class DataManager {
  private static readonly LEGACY_FILENAME = "lynvo.json";
  private static readonly FOLDER = ".vscode";
  private static readonly MODULAR_FOLDER = "lynvo";
  private static writeQueue: Promise<void> = Promise.resolve();

  // In-memory guard so the schema-mismatch warning shows at most once per session.
  private static schemaWarningShown = false;

  private static getWorkspaceUri(): vscode.Uri | undefined {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {return undefined;}
    return workspaceFolders[0].uri;
  }

  private static getFolderUri(): vscode.Uri | undefined {
    const workspace = this.getWorkspaceUri();
    if (!workspace) {return undefined;}
    return vscode.Uri.joinPath(workspace, this.FOLDER);
  }

  private static getLegacyFileUri(): vscode.Uri | undefined {
    const folderUri = this.getFolderUri();
    if (!folderUri) {return undefined;}
    return vscode.Uri.joinPath(folderUri, this.LEGACY_FILENAME);
  }

  private static getModularRootUri(): vscode.Uri | undefined {
    const folderUri = this.getFolderUri();
    if (!folderUri) {return undefined;}
    return vscode.Uri.joinPath(folderUri, this.MODULAR_FOLDER);
  }

  private static joinModularPath(...segments: string[]): vscode.Uri | undefined {
    const root = this.getModularRootUri();
    if (!root) {return undefined;}
    return vscode.Uri.joinPath(root, ...segments);
  }

  private static getDefaultBoard(): LynvoBoard {
    return {
      version: getSchemaVersion(),
      columns: {
        todo: {
          id: "todo",
          title: "To Do",
          color: "var(--vscode-charts-blue)",
          position: 0,
        },
        "in-progress": {
          id: "in-progress",
          title: "In Progress",
          color: "var(--vscode-charts-yellow)",
          position: 1,
        },
        done: {
          id: "done",
          title: "Done",
          color: "var(--vscode-charts-green)",
          position: 2,
        },
      },
      tasks: {},
      labels: {
        bug: { id: "bug", name: "Bug", color: "#f85149" },
        feat: { id: "feat", name: "Feature", color: "#a371f7" },
      },
      users: {},
      identities: {},
      domains: {
        local: { name: "local", createdAt: Date.now() },
      },
      sync: this.getDefaultSyncMetadata(),
      tombstones: {},
      conflicts: {},
    };
  }

  private static getDefaultSyncMetadata(): LynvoSyncMetadata {
    return {
      branch: "lynvo-sync",
      status: "idle",
      pendingChanges: false,
      lastSyncAt: null,
      lastRemoteCommit: null,
      updatedAt: Date.now(),
    };
  }

  private static createId(prefix: string): string {
    const random = Math.random().toString(36).slice(2, 10);
    return `${prefix}-${Date.now().toString(36)}-${random}`;
  }

  /**
   * Normalize a stored `createdBy`/`lastModifiedBy` value to the identity-ID form.
   * - string -> already an identity ID, kept as-is.
   * - legacy `{ githubId, username }` object -> the ID of a matching existing identity
   *   (by display name or source ID), or one materialized from the pair.
   * - the "Unknown" user or missing -> undefined (anonymous).
   * Invoked only by the user-confirmed schema migration (migrateToCurrentSchema).
   */
  private static normalizeSigningRef(
    raw: unknown,
    identities: Record<string, LynvoIdentity>,
  ): string | undefined {
    if (typeof raw === "string") {
      return raw;
    }
    if (!raw || typeof raw !== "object") {
      return undefined;
    }
    const legacy = raw as Record<string, unknown>;
    const username = typeof legacy.username === "string" ? legacy.username.trim() : "";
    const providerId = typeof legacy.githubId === "string" ? legacy.githubId.trim() : "";
    if (!username || username.toLowerCase() === "unknown") {
      return undefined; // anonymous
    }
    const lowered = username.toLowerCase();
    const match = Object.values(identities).find(
      (identity) =>
        identity.displayName.toLowerCase() === lowered ||
        identity.sourceId.toLowerCase() === lowered ||
        (providerId !== "unknown" &&
          identity.sourceId.toLowerCase() === providerId.toLowerCase()),
    );
    if (match) {
      return match.id;
    }
    // Materialize the legacy user as a new identity so that the reference stays resolvable.
    const identity: LynvoIdentity = {
      id: this.createId("id"),
      displayName: username,
      source: providerId === "unknown" ? "local" : "github",
      sourceId: providerId === "unknown" ? username : providerId,
      createdAt: Date.now(),
    };
    identities[identity.id] = identity;
    return identity.id;
  }

  /**
   * Map the signing identity (or anonymous) to the legacy display shape still
   * used by the activity actor, presence entries and tombstones.
   */
  private static toLegacyUser(identity: LynvoIdentity | undefined): LynvoUser {
    if (identity) {
      return { githubId: identity.sourceId, username: identity.displayName };
    }
    return UNKNOWN_USER;
  }

  private static ensureBoardIntegrity(board: Partial<LynvoBoard>): LynvoBoard {
    const defaults = this.getDefaultBoard();
    const next: LynvoBoard = {
      // Stamp only if higher:
      // never downgrade a board that was written by a newer schema.
      // Keeps the persisted version = max(extension, existing DB).
      version: maxVersion(getSchemaVersion(), board.version),
      columns:
        board.columns && Object.keys(board.columns).length > 0
          ? board.columns
          : defaults.columns,
      tasks: board.tasks || {},
      labels: board.labels || defaults.labels,
      users: board.users || {},
      identities: board.identities || {},
      domains: board.domains || {},
      activity: board.activity || {},
      sync: {
        ...this.getDefaultSyncMetadata(),
        ...(board.sync || {}),
      },
      tombstones: board.tombstones || {},
      conflicts: board.conflicts || {},
    };

    // The "local" domain always exists (domains is optional on the type, so guard first).
    if (!next.domains) {next.domains = {};}
    if (!next.domains["local"]) {
      next.domains["local"] = { name: "local", createdAt: Date.now() };
    }

    const sortedColumns = Object.values(next.columns).sort(
      (a, b) => a.position - b.position,
    );
    const fallbackColumnId = sortedColumns[0]?.id ?? "todo";

    Object.values(next.columns).forEach((column, index) => {
      if (!column.id) {column.id = this.createId("col");}
      if (!column.title) {column.title = "Untitled";}
      if (!column.color) {column.color = "var(--vscode-charts-blue)";}
      if (!Number.isFinite(column.position)) {column.position = index;}
    });

    Object.values(next.tasks).forEach((task) => {
      if (!next.columns[task.status]) {
        task.status = fallbackColumnId;
      }

      if (!task.createdAt) {task.createdAt = Date.now();}
      if (!task.updatedAt) {task.updatedAt = task.createdAt;}
      // Those attribution fields are left as-is on load:
      // the legacy { githubId, username } objects are only converted
      // by the user-confirmed schema migration.
      // While unassigned tasks simply have these fields unset.
      if (!task.lastModifiedBy && task.createdBy) {
        task.lastModifiedBy = task.createdBy;
      }
      if (!task.labelIds) {
        task.labelIds = [];
      }
      if (!task.priority) {
        task.priority = "medium";
      }
      if (!task.checklist) {
        task.checklist = [];
      }
      if (!task.relations) {
        task.relations = [];
      }
    });

    return next;
  }

  private static async exists(uri: vscode.Uri): Promise<boolean> {
    try {
      await vscode.workspace.fs.stat(uri);
      return true;
    } catch {
      return false;
    }
  }

  private static async readJson<T>(uri: vscode.Uri): Promise<T> {
    const fileData = await vscode.workspace.fs.readFile(uri);
    const raw = Buffer.from(fileData).toString("utf8");
    try {
      return JSON.parse(raw) as T;
    } catch (error) {
      await this.backupCorruptJson(uri, fileData).catch((backupError) =>
        console.error(`Lynvo: failed to backup corrupt json ${uri.path}`, backupError),
      );
      throw error;
    }
  }

  private static async writeJsonAtomic(uri: vscode.Uri, value: unknown): Promise<void> {
    const data = Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");

    // Write-on-change: skip the write (and any mtime update) when the file
    // already holds identical content, so idle re-saves don't churn the folder.
    try {
      const existing = await vscode.workspace.fs.readFile(uri);
      if (Buffer.compare(existing, data) === 0) {
        return;
      }
    } catch {
      // File does not exist yet (or is unreadable) -> write it below.
    }

    const parent = uri.with({ path: uri.path.replace(/\/[^/]+$/, "") });
    await vscode.workspace.fs.createDirectory(parent);

    const tempUri = vscode.Uri.joinPath(
      parent,
      `.${uri.path.split("/").pop()}.${Date.now()}.tmp`,
    );
    await vscode.workspace.fs.writeFile(tempUri, data);
    await vscode.workspace.fs.rename(tempUri, uri, { overwrite: true });
  }

  private static async backupCorruptJson(
    uri: vscode.Uri,
    fileData: Uint8Array,
  ): Promise<void> {
    const fileName = uri.path.split("/").pop() || "file.json";
    if (fileName.includes(".corrupt-")) {
      return;
    }

    const parent = uri.with({ path: uri.path.replace(/\/[^/]+$/, "") });
    const backupUri = vscode.Uri.joinPath(
      parent,
      `${fileName}.corrupt-${Date.now()}`,
    );
    await vscode.workspace.fs.writeFile(backupUri, fileData);
  }

  private static async readTasks(tasksUri: vscode.Uri): Promise<Record<string, LynvoTask>> {
    const tasks: Record<string, LynvoTask> = {};

    if (!(await this.exists(tasksUri))) {
      return tasks;
    }

    const entries = await vscode.workspace.fs.readDirectory(tasksUri);
    for (const [name, type] of entries) {
      if (type !== vscode.FileType.File || !name.endsWith(".json")) {continue;}
      try {
        const task = await this.readJson<LynvoTask>(vscode.Uri.joinPath(tasksUri, name));
        if (task.id) {
          tasks[task.id] = task;
        }
      } catch (error) {
        console.error(`Lynvo: invalid task file ${name}`, error);
      }
    }

    return tasks;
  }

  private static async readActivity(
    activityUri: vscode.Uri,
  ): Promise<Record<string, LynvoActivity>> {
    const activity: Record<string, LynvoActivity> = {};

    if (!(await this.exists(activityUri))) {
      return activity;
    }

    const entries = await vscode.workspace.fs.readDirectory(activityUri);
    for (const [name, type] of entries) {
      if (type !== vscode.FileType.File || !name.endsWith(".json")) {continue;}
      try {
        const item = await this.readJson<LynvoActivity>(
          vscode.Uri.joinPath(activityUri, name),
        );
        if (item.id) {
          activity[item.id] = item;
        }
      } catch (error) {
        console.error(`Lynvo: invalid activity file ${name}`, error);
      }
    }

    return activity;
  }

  private static async readOptionalJson<T>(
    uri: vscode.Uri,
    fallback: T,
  ): Promise<T> {
    if (!(await this.exists(uri))) {
      return fallback;
    }

    try {
      return await this.readJson<T>(uri);
    } catch (error) {
      console.error(`Lynvo: invalid json ${uri.path}`, error);
      return fallback;
    }
  }

  private static async loadModularBoard(): Promise<LynvoBoard | null> {
    const boardUri = this.joinModularPath("board.json");
    const columnsUri = this.joinModularPath("columns.json");
    const usersUri = this.joinModularPath("users.json");
    const identitiesUri = this.joinModularPath("identities.json");
    const tasksUri = this.joinModularPath("tasks");
    const activityUri = this.joinModularPath("activity");
    const syncUri = this.joinModularPath("metadata", "sync.json");
    const tombstonesUri = this.joinModularPath("metadata", "tombstones.json");
    const conflictsUri = this.joinModularPath("metadata", "conflicts.json");
    if (
      !boardUri ||
      !columnsUri ||
      !usersUri ||
      !identitiesUri ||
      !tasksUri ||
      !activityUri ||
      !syncUri ||
      !tombstonesUri ||
      !conflictsUri
    ) {return null;}
    if (!(await this.exists(boardUri)) || !(await this.exists(columnsUri))) {
      return null;
    }

    try {
      const metadata = await this.readJson<BoardMetadata>(boardUri);
      const columns = await this.readJson<Record<string, LynvoColumn>>(columnsUri);
      const users = await this.readOptionalJson<Record<string, LynvoPresenceUser>>(
        usersUri,
        {},
      );
      const tasks = await this.readTasks(tasksUri);
      const activity = await this.readActivity(activityUri);
      const sync = await this.readOptionalJson<LynvoSyncMetadata>(
        syncUri,
        this.getDefaultSyncMetadata(),
      );
      const tombstones = await this.readOptionalJson<Record<string, LynvoTombstone>>(
        tombstonesUri,
        {},
      );
      const conflicts = await this.readOptionalJson<Record<string, LynvoConflict>>(
        conflictsUri,
        {},
      );
      // identities.json holds both the identities and the domains registries.
      let identities: Record<string, LynvoIdentity> = {};
      let domainsOnFile: Record<string, LynvoDomain> | undefined;
      if (await this.exists(identitiesUri)) {
        try {
          const parsed = parseIdentitiesFile(await this.readJson<unknown>(identitiesUri));
          identities = parsed.identities;
          domainsOnFile = parsed.domains;
        } catch (error) {
          console.error("Lynvo: invalid identities file", error);
        }
      }

      return this.ensureBoardIntegrity({
        version: metadata.version,
        columns,
        tasks,
        labels: metadata.labels,
        users,
        identities,
        domains : domainsOnFile ?? {},
        activity,
        sync,
        tombstones,
        conflicts,
      });
    } catch (error) {
      console.error("Lynvo: error loading modular board", error);
      vscode.window.showWarningMessage(
        t("Lynvo could not read the modular persistence. Check .vscode/lynvo."),
      );
      return null;
    }
  }

  private static async loadLegacyBoard(): Promise<LynvoBoard | null> {
    const legacyUri = this.getLegacyFileUri();
    if (!legacyUri || !(await this.exists(legacyUri))) {return null;}

    try {
      const parsed = await this.readJson<LynvoBoard>(legacyUri);
      return this.ensureBoardIntegrity(parsed);
    } catch (error) {
      console.error("Lynvo: error loading legacy board", error);
      vscode.window.showWarningMessage(
        t("Lynvo could not read .vscode/lynvo.json. The file might be corrupted."),
      );
      return null;
    }
  }

  private static async saveBoardUnsafe(board: LynvoBoard): Promise<void> {
    const root = this.getModularRootUri();
    const boardUri = this.joinModularPath("board.json");
    const columnsUri = this.joinModularPath("columns.json");
    const usersUri = this.joinModularPath("users.json");
    const identitiesUri = this.joinModularPath("identities.json");
    const settingsUri = this.joinModularPath("settings.json");
    const tasksUri = this.joinModularPath("tasks");
    const commentsUri = this.joinModularPath("comments");
    const activityUri = this.joinModularPath("activity");
    const metadataUri = this.joinModularPath("metadata");
    const syncUri = this.joinModularPath("metadata", "sync.json");
    const tombstonesUri = this.joinModularPath("metadata", "tombstones.json");
    const conflictsUri = this.joinModularPath("metadata", "conflicts.json");
    const versionUri = this.joinModularPath("metadata", "version.json");
    if (
      !root ||
      !boardUri ||
      !columnsUri ||
      !usersUri ||
      !identitiesUri ||
      !settingsUri ||
      !tasksUri ||
      !commentsUri ||
      !activityUri ||
      !metadataUri ||
      !syncUri ||
      !tombstonesUri ||
      !conflictsUri ||
      !versionUri
    ) {
      return;
    }

    const cleanBoard = this.ensureBoardIntegrity(board);

    await vscode.workspace.fs.createDirectory(root);
    await vscode.workspace.fs.createDirectory(tasksUri);
    await vscode.workspace.fs.createDirectory(commentsUri);
    await vscode.workspace.fs.createDirectory(activityUri);
    await vscode.workspace.fs.createDirectory(metadataUri);

    await this.writeJsonAtomic(boardUri, {
      // cleanBoard.version already equals max(extension schema, DB version).
      version: cleanBoard.version,
      labels: cleanBoard.labels || {},
    });
    await this.writeJsonAtomic(columnsUri, cleanBoard.columns);
    await this.writeJsonAtomic(usersUri, cleanBoard.users || {});
    // identities.json holds both the identities and the domains registries.
    await this.writeJsonAtomic(identitiesUri, serializeIdentitiesFile(cleanBoard));
    await this.writeJsonAtomic(settingsUri, {});
    await this.writeJsonAtomic(syncUri, cleanBoard.sync || this.getDefaultSyncMetadata());
    await this.writeJsonAtomic(tombstonesUri, cleanBoard.tombstones || {});
    await this.writeJsonAtomic(conflictsUri, cleanBoard.conflicts || {});
    await this.writeJsonAtomic(versionUri, {
      schemaVersion: cleanBoard.version,
    });

    const expectedTaskFiles = new Set<string>();
    for (const task of Object.values(cleanBoard.tasks)) {
      expectedTaskFiles.add(`${task.id}.json`);
      await this.writeJsonAtomic(vscode.Uri.joinPath(tasksUri, `${task.id}.json`), task);
    }

    const existingTaskFiles = await vscode.workspace.fs.readDirectory(tasksUri);
    for (const [name, type] of existingTaskFiles) {
      if (
        type === vscode.FileType.File &&
        name.endsWith(".json") &&
        !expectedTaskFiles.has(name)
      ) {
        await vscode.workspace.fs.delete(vscode.Uri.joinPath(tasksUri, name));
      }
    }

    const expectedActivityFiles = new Set<string>();
    const activityItems = Object.values(cleanBoard.activity || {})
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, 500);
    for (const activity of activityItems) {
      expectedActivityFiles.add(`${activity.id}.json`);
      await this.writeJsonAtomic(
        vscode.Uri.joinPath(activityUri, `${activity.id}.json`),
        activity,
      );
    }

    const existingActivityFiles = await vscode.workspace.fs.readDirectory(activityUri);
    for (const [name, type] of existingActivityFiles) {
      if (
        type === vscode.FileType.File &&
        name.endsWith(".json") &&
        !expectedActivityFiles.has(name)
      ) {
        await vscode.workspace.fs.delete(vscode.Uri.joinPath(activityUri, name));
      }
    }
  }

  private static addActivity(
    board: LynvoBoard,
    type: LynvoActivityType,
    message: string,
    actor: LynvoIdentity | undefined,
    options: Pick<LynvoActivity, "taskId" | "targetTaskId" | "metadata"> = {},
  ): void {
    const id = this.createId("activity");
    board.activity = board.activity || {};
    board.activity[id] = {
      id,
      type,
      message,
      actor: this.toLegacyUser(actor),
      createdAt: Date.now(),
      ...options,
    };
  }

  private static addTombstone(
    board: LynvoBoard,
    entityType: LynvoTombstone["entityType"],
    entityId: string,
    actor: LynvoIdentity | undefined,
  ): void {
    const id = `${entityType}-${entityId}`;
    board.tombstones = board.tombstones || {};
    board.tombstones[id] = {
      id,
      entityType,
      entityId,
      deletedAt: Date.now(),
      deletedBy: this.toLegacyUser(actor),
    };
  }

  private static markPendingSync(board: LynvoBoard): void {
    board.sync = {
      ...this.getDefaultSyncMetadata(),
      ...(board.sync || {}),
      status: "pending",
      pendingChanges: true,
      message: "Local changes pending sync",
      updatedAt: Date.now(),
    };
  }

  private static async mutateBoard(
    mutator: (board: LynvoBoard) => Promise<void> | void,
  ): Promise<void> {
    const run = this.writeQueue.catch(() => undefined).then(async () => {
      const board = await this.loadBoardUnsafe();
      if (!board) {return;}
      await mutator(board);
      this.markPendingSync(board);
      await this.saveBoardUnsafe(board);
    });

    this.writeQueue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  private static async loadBoardUnsafe(): Promise<LynvoBoard | null> {
    const modular = await this.loadModularBoard();
    if (modular) {return modular;}

    const legacy = await this.loadLegacyBoard();
    if (legacy) {
      await this.saveBoardUnsafe(legacy);
      return legacy;
    }

    return null;
  }

  /**
   * Read the raw schema version persisted on disk,
   * without applying the "stamp only if higher" logic.
   * Returns the first version found, or null when there is no board data yet.
   */
  public static async readPersistedVersion(): Promise<string | null> {
    const boardUri = this.joinModularPath("board.json");
    if (boardUri && (await this.exists(boardUri))) {
      try {
        const metadata = await this.readJson<BoardMetadata>(boardUri);
        if (metadata && typeof metadata.version === "string" && metadata.version) {
          return metadata.version;
        }
      } catch {
        // Corrupt board.json; try the dedicated version file next.
      }
    }

    const versionUri = this.joinModularPath("metadata", "version.json");
    if (versionUri && (await this.exists(versionUri))) {
      try {
        const parsed = await this.readJson<{ schemaVersion?: string }>(versionUri);
        if (parsed && typeof parsed.schemaVersion === "string" && parsed.schemaVersion) {
          return parsed.schemaVersion;
        }
      } catch {
        // Ignore and fall back to the legacy file.
      }
    }

    const legacyUri = this.getLegacyFileUri();
    if (legacyUri && (await this.exists(legacyUri))) {
      try {
        const parsed = await this.readJson<{ version?: string }>(legacyUri);
        if (parsed && typeof parsed.version === "string" && parsed.version) {
          return parsed.version;
        }
      } catch {
        // Ignore; no usable version found.
      }
    }

    return null;
  }

  /**
   * Warn (once per session, non-blocking) when the persisted board data uses a
   * different MAJOR schema version than this extension. A major difference
   * signals possible breaking changes or data this version may not fully read.
   * Minor/patch differences are intentionally ignored.
   *
   * Call this BEFORE the board is (re)saved,
   * so the raw persisted version is still available to compare against.
   */
  public static async checkSchemaCompatibility(): Promise<void> {
    if (this.schemaWarningShown) {
      return;
    }
    const dbVersion = await this.readPersistedVersion();
    if (!dbVersion) {
      // No board data yet -> nothing to compare.
      return;
    }
    const extVersion = getSchemaVersion();
    if (!majorDiffers(extVersion, dbVersion)) {
      return;
    }

    this.schemaWarningShown = true;
    const openButton = t("Open release notes");
    const choice = await vscode.window.showWarningMessage(
      t(
        "Lynvo: the board data (schema {0}) and this extension (schema {1}) use different major versions, so some data may be incompatible. Please review the release notes.",
        dbVersion,
        extVersion,
      ),
      openButton,
    );
    if (choice === openButton) {
      await vscode.env.openExternal(vscode.Uri.parse(getChangelogUrl()));
    }
  }

  /**
   * Migrate stored board data to the current schema (3.0.0).
   * 1) Relations:
   *    for every stored "blocks A->B", ensure B has a "blocked-by -> A" (dedup),
   *    then drop A's "blocks" entry. Only `blocks` / `blocked-by` are touched;
   *    `related` / `duplicates` keep their stored direction.
   * 2) Attribution:
   *    the legacy LynvoUser (`{ githubId, username }`) objects
   *    found in Tasks (through the `createdBy` / `lastModifiedBy` properties)
   *    should become an Identity by reusing a matching identity or creating one.
   * Finally the board version is stamped to the extension's schema version.
   * Invoked only from the user-confirmed "Update data" migration prompt.
   */
  public static async migrateToCurrentSchema(): Promise<void> {
    await this.mutateBoard((board) => {
      // 1) Canonicalize stored relations.
      for (const task of Object.values(board.tasks)) {
        const relations = task.relations || [];
        if (!relations.some((relation) => relation.type === "blocks")) {
          continue;
        }
        const kept: LynvoTaskRelation[] = [];
        for (const relation of relations) {
          if (relation.type !== "blocks") {
            kept.push(relation);
            continue;
          }
          // "blocks A->B" becomes "blocked-by -> A" stored on B.
          const target = board.tasks[relation.targetTaskId];
          if (target) {
            const targetRelations = target.relations || [];
            const already = targetRelations.some(
              (existing) =>
                existing.type === "blocked-by" && existing.targetTaskId === task.id,
            );
            if (!already) {
              target.relations = [
                ...targetRelations,
                {
                  id: this.createId("rel"),
                  type: "blocked-by",
                  targetTaskId: task.id,
                  createdAt: relation.createdAt,
                },
              ];
            }
          }
          // The source "blocks" entry is intentionally dropped (not kept).
        }
        task.relations = kept;
      }

      // 2) Convert legacy attribution objects to identity IDs.
      const identities = board.identities || (board.identities = {});
      for (const task of Object.values(board.tasks)) {
        task.createdBy = this.normalizeSigningRef(task.createdBy, identities);
        task.lastModifiedBy =
          this.normalizeSigningRef(task.lastModifiedBy, identities) ?? task.createdBy;
      }

      board.version = getSchemaVersion();
    });
  }

  /**
   * Offer a one-time migration prompt when the persisted board data is
   * on an OLDER major schema than this extension (e.g. 2.x -> 3.x).
   * Only offered when this extension is the newest (persisted major < extension major).
   * On acceptance it runs the full schema migration (migrateToCurrentSchema):
   * canonicalizes `blocks` relations and converts legacy attribution objects.
   * Declining leaves the data untouched (still readable).
   */
  public static async promptAndMigrateIfNeeded(
    persistedVersion?: string | null,
  ): Promise<void> {
    const dbVersion = persistedVersion ?? (await this.readPersistedVersion());
    if (!dbVersion) {
      return; // No board data yet -> nothing to migrate.
    }
    const extVersion = getSchemaVersion();
    // Only migrate when the stored schema is strictly OLDER
    // by major version (e.g. 2.x -> 3.x).
    // Minor/patch-only differences and newer schemas are intentionally left alone.
    if (compareSemVer(dbVersion, extVersion) >= 0) {
      // Stored schema is the same or newer -> nothing to migrate.
      return;
    }
    if (parseSemVer(dbVersion).major >= parseSemVer(extVersion).major) {
      // Same major -> not an older (breaking) schema.
      return;
    }

    const updateButton = t("Update data");
    const choice = await vscode.window.showWarningMessage(
      t(
        "Lynvo: your board data is on an older schema ({0}) than this extension ({1}). Update the data to the new schema?",
        dbVersion,
        extVersion,
      ),
      { modal: true },
      updateButton,
    );
    if (choice === updateButton) {
      await this.migrateToCurrentSchema();
    }
  }

  public static async initializeBoard(): Promise<void> {
    const folderUri = this.getFolderUri();
    if (!folderUri) {return;}

    await vscode.workspace.fs.createDirectory(folderUri);
    const board = await this.loadBoardUnsafe();
    await this.saveBoard(board || this.getDefaultBoard());
  }

  public static async loadBoard(): Promise<LynvoBoard | null> {
    return this.loadBoardUnsafe();
  }

  public static async saveBoard(board: LynvoBoard): Promise<void> {
    const run = this.writeQueue
      .catch(() => undefined)
      .then(() => this.saveBoardUnsafe(board));
    this.writeQueue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  public static async updateSyncMetadata(
    updates: Partial<LynvoSyncMetadata>,
  ): Promise<void> {
    const run = this.writeQueue.catch(() => undefined).then(async () => {
      const board = await this.loadBoardUnsafe();
      if (!board) {return;}
      board.sync = {
        ...this.getDefaultSyncMetadata(),
        ...(board.sync || {}),
        ...updates,
        updatedAt: Date.now(),
      };
      await this.saveBoardUnsafe(board);
    });
    this.writeQueue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  public static async touchCurrentUser(): Promise<void> {
    const run = this.writeQueue.catch(() => undefined).then(async () => {
      const board = await this.loadBoardUnsafe();
      if (!board) {
        return;
      }
      const identity = await this.getSigningIdentity(board);
      if (!identity) {
        return; // No current identity: nothing to mark as present.
      }
      board.users = board.users || {};
      board.users[identity.id] = {
        githubId: identity.sourceId,
        username: identity.displayName,
        lastSeenAt: Date.now(),
      };
      await this.saveBoardUnsafe(board);
    });
    this.writeQueue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  public static async updateTaskStatus(
    taskId: string,
    newStatus: string,
  ): Promise<void> {
    await this.mutateBoard(async (board) => {
      if (!board.tasks[taskId] || !board.columns[newStatus]) {return;}

      const instigator = await this.getSigningIdentity(board);
      const previousStatus = board.tasks[taskId].status;
      board.tasks[taskId].status = newStatus;
      board.tasks[taskId].updatedAt = Date.now();
      if (instigator) {board.tasks[taskId].lastModifiedBy = instigator.id;}
      this.addActivity(
        board,
        "task_moved",
        `{${board.tasks[taskId].title}} ==> [${board.columns[newStatus].title}]`,
        instigator,
        {
          taskId,
          metadata: { from: previousStatus, to: newStatus },
        },
      );
    });
  }

  public static async reorderTasks(
    updates: Array<{
      id: string;
      status: string;
      position: number;
      isDraggedTask?: boolean;
    }>,
  ): Promise<void> {
    await this.mutateBoard(async (board) => {
      const instigator = await this.getSigningIdentity(board);
      updates.forEach((upd) => {
        const column = board.columns[upd.status];
        const task = board.tasks[upd.id];
        if (!task || !column) {return;}

        task.status = upd.status;
        task.position = upd.position;
        if (upd.isDraggedTask) {
          task.updatedAt = Date.now();
          if (instigator) {task.lastModifiedBy = instigator.id;}
          this.addActivity(
            board,
            "task_moved",
            `{${task.title}} ==> [${column.title}]`,
            instigator,
            {
              taskId: upd.id,
              metadata: { status: upd.status, position: upd.position },
            },
          );
        }
      });
    });
  }

  /**
   * Case-insensitive check whether a task with the given title already exists.
   * Task titles are unique (the underlying system relies on a unique task id,
   * and relations are matched by title), so duplicate titles are disallowed.
   */
  public static hasTaskWithTitle(board: LynvoBoard, title: string): boolean {
    const needle = title.trim().toLowerCase();
    if (!needle) {
      return false;
    }
    return Object.values(board.tasks).some(
      (task) => task.title.trim().toLowerCase() === needle,
    );
  }

  public static async createTask(
    title: string,
    description: string,
    targetColId?: string,
    labelIds: string[] = [],
    codeReference?: CodeReference,
    priority: LynvoTask["priority"] = "medium",
    dueDate?: number,
    checklist: Array<{ text: string; done: boolean }> = [],
    relations: Array<{ type: LynvoTaskRelationType; targetTaskId: string }> = [],
  ): Promise<string> {
    let newTaskId = "";
    await this.mutateBoard(async (board) => {
      const instigator = await this.getSigningIdentity(board);
      const taskId = this.createId("task");
      newTaskId = taskId;

      let status = targetColId;
      if (!status || !board.columns[status]) {
        const sortedCols = Object.values(board.columns).sort(
          (a, b) => a.position - b.position,
        );
        status = sortedCols.length > 0 ? sortedCols[0].id : "todo";
      }

      const now = Date.now();

      // Canonicalize incoming relations (schema 3.0.0):
      //  - non-"blocks" types are stored on the new task (as-is);
      //  - "blocks A->B" is stored as a reciprocal "blocked-by -> A" on B.
      // Target tasks must already exist; unresolvable targets are skipped.
      const ownRelations: LynvoTaskRelation[] = [];
      // Each actually-added edge is recorded so that an activity is logged for it
      // (createTask is the only relation-creator that did not log, unlike addTaskRelation).
      const addedEdges: Array<{ type: LynvoTaskRelationType; ownerTitle: string; targetTitle: string; ownerId: string; targetId: string }> = [];
      for (const entry of relations) {
        const target = board.tasks[entry.targetTaskId];
        if (!target || entry.targetTaskId === taskId) {continue;}
        const { ownerId, storedType, targetId } = canonicalizeRelation(
          taskId,
          entry.type,
          entry.targetTaskId,
        );
        const ownerTask = board.tasks[ownerId];
        if (ownerId === taskId) {
          // Dedup the exact canonical edge on the new task.
          const exists = ownRelations.some(
            (relation) => relation.type === storedType && relation.targetTaskId === targetId,
          );
          if (!exists) {
            ownRelations.push({
              id: this.createId("rel"),
              type: storedType,
              targetTaskId: targetId,
              createdAt: now,
            });
            addedEdges.push({ type: storedType, ownerTitle: title, targetTitle: target.title, ownerId, targetId });
          }
        } else {
          // "blocks" -> the target task gains a "blocked-by" pointing at the new task.
          const targetRelations = target.relations || [];
          const exists = targetRelations.some(
            (relation) => relation.type === storedType && relation.targetTaskId === taskId,
          );
          if (!exists) {
            target.relations = [
              ...targetRelations,
              { id: this.createId("rel"), type: storedType, targetTaskId: taskId, createdAt: now },
            ];
            addedEdges.push({ type: storedType, ownerTitle: ownerTask?.title || ownerId, targetTitle: title, ownerId, targetId });
          }
        }
      }

      board.tasks[taskId] = {
        id: taskId,
        title,
        description,
        status,
        createdBy: instigator?.id,
        lastModifiedBy: instigator?.id,
        createdAt: now,
        updatedAt: now,
        codeReference,
        position: now,
        labelIds,
        priority,
        dueDate,
        checklist: checklist.map((entry) => ({
          id: this.createId("check"),
          text: entry.text,
          done: entry.done,
          createdAt: now,
          updatedAt: now,
        })),
        relations: ownRelations,
      };
      this.addActivity( board, "task_created", `{${title}}`, instigator, { taskId } );
      // Log each relation added during promotion (parity with addTaskRelation):
      // blocks/blocked-by -> relation_blockedby_added,
      // duplicates -> relation_duplicates_added,
      // related -> relation_added.
      // The message is canonical-owner first, then target.
      for (const edge of addedEdges) {
        this.addActivity(
          board,
          generateRelationActivityType(edge.type, "added"),
          `{${edge.ownerTitle}} <+> {${edge.targetTitle}}`,
          instigator,
          { taskId, targetTaskId: edge.targetId, metadata: { type: edge.type, ownerId: edge.ownerId } },
        );
      }
      if (codeReference) {
        this.addActivity(
          board,
          "link_added",
          `{${title}}`,
          instigator,
          { taskId, metadata: { filePath: codeReference.filePath } },
        );
      }
    });
    return newTaskId;
  }

  public static async editTask(
    taskId: string,
    title: string,
    description: string,
    labelIds: string[] = [],
    priority: LynvoTask["priority"] = "medium",
    dueDate?: number,
  ): Promise<void> {
    await this.mutateBoard(async (board) => {
      const task = board.tasks[taskId];
      if (!task) {return;}

      const instigator = await this.getSigningIdentity(board);
      const previousTitle = task.title;
      task.title = title;
      task.description = description;
      task.labelIds = labelIds;
      task.priority = priority;
      task.dueDate = dueDate;
      task.updatedAt = Date.now();

      if (instigator) {task.lastModifiedBy = instigator.id;}
      // A title change is a rename ("old ==> new"); otherwise it's a generic edit.
      const isRename = previousTitle !== title;
      const message = isRename
        ? `{${previousTitle}} ==> {${title}}`
        : `{${title}}`;
      this.addActivity(
        board,
        isRename ? "task_renamed" : "task_updated",
        message,
        instigator,
        { taskId }
      );
    });
  }

  /**
   * Re-sync a promoted task's title/description from its linked code comment.
   * Used by the "relink" action (file -> board) so the JSON matches the code.
   */
  public static async updateTaskText(
    taskId: string,
    title: string,
    description: string,
  ): Promise<void> {
    await this.mutateBoard(async (board) => {
      const task = board.tasks[taskId];
      if (!task) {return;}

      const instigator = await this.getSigningIdentity(board);
      const previousTitle = task.title;
      task.title = title;
      task.description = description;
      task.updatedAt = Date.now();
      if (instigator) {task.lastModifiedBy = instigator.id;}
      const isRename = previousTitle !== title;
      const message = isRename ? `{${previousTitle}} ==> {${title}}` : `{${title}}`;
      this.addActivity(
        board,
        isRename ? "task_renamed" : "task_updated",
        message,
        instigator,
        { taskId },
      );
    });
  }

  public static async clearTaskCodeReference(taskId: string): Promise<void> {
    await this.mutateBoard(async (board) => {
      const task = board.tasks[taskId];
      if (!task) {return;}

      const instigator = await this.getSigningIdentity(board);
      task.codeReference = undefined;
      task.updatedAt = Date.now();
      if (instigator) {task.lastModifiedBy = instigator.id;}
      this.addActivity( board, "link_removed", `{${task.title}}`, instigator, { taskId } );
    });
  }

  public static async deleteTask(taskId: string): Promise<void> {
    await this.mutateBoard(async (board) => {
      const taskTitle = board.tasks[taskId]?.title || "task";
      const instigator = await this.getSigningIdentity(board);

      // Log the deleted task's OWN relations before removing it.
      // (schema 3.0.0: "Y blocks X" is stored on X as `blocked-by -> Y`,
      // so that it disappears with X and is only visible here;
      // the reciprocal "X blocks Y" lives on Y and is scrubbed in the loop below.)
      const ownRelations = board.tasks[taskId]?.relations || [];
      for (const relation of ownRelations) {
        const otherTitle = board.tasks[relation.targetTaskId]?.title || relation.targetTaskId;
        this.addActivity(
          board,
          generateRelationActivityType(relation.type, "deleted"),
          `{${taskTitle}} <-> {${otherTitle}}`,
          instigator,
          { taskId, targetTaskId: relation.targetTaskId, metadata: { type: relation.type } },
        );
      }

      this.addTombstone(board, "task", taskId, instigator);
      delete board.tasks[taskId];

      // Dangling references on the OTHER (surviving) tasks:
      // log each as a relation deletion and scrub it out of their JSON
      // (the in-code mirror is cleaned up separately by the caller).
      Object.values(board.tasks).forEach((task) => {
        const relations = task.relations || [];
        for (const relation of relations) {
          if (relation.targetTaskId !== taskId) {continue;}
          this.addActivity(
            board,
            generateRelationActivityType(relation.type, "deleted"),
            `{${task.title}} <-> {${taskTitle}}`,
            instigator,
            { taskId: task.id, targetTaskId: taskId, metadata: { type: relation.type } },
          );
        }
        task.relations = relations.filter((relation) => relation.targetTaskId !== taskId);
      });
      this.addActivity(board, "task_deleted", `{${taskTitle}}`, instigator, { taskId });
    });
  }

  public static async addChecklistItem(
    taskId: string,
    text: string,
    done = false,
  ): Promise<void> {
    await this.mutateBoard(async (board) => {
      const task = board.tasks[taskId];
      if (!task || !text.trim()) {return;}

      const instigator = await this.getSigningIdentity(board);
      const now = Date.now();
      const item: LynvoChecklistItem = {
        id: this.createId("check"),
        text: text.trim(),
        done,
        createdAt: now,
        updatedAt: now,
      };

      task.checklist = [...(task.checklist || []), item];
      task.updatedAt = now;
      if (instigator) {task.lastModifiedBy = instigator.id;}
      this.addActivity(
        board,
        "checklist_added",
        `{${task.title}} ::: (${item.text})`,
        instigator,
        { taskId }
      );
    });
  }

  public static async updateChecklistItem(
    taskId: string,
    itemId: string,
    updates: Partial<Pick<LynvoChecklistItem, "text" | "done">>,
  ): Promise<void> {
    await this.mutateBoard(async (board) => {
      const task = board.tasks[taskId];
      const item = task?.checklist?.find((entry) => entry.id === itemId);
      if (!task || !item) {return;}

      const instigator = await this.getSigningIdentity(board);
      const previousText = item.text;
      if (typeof updates.text === "string") {
        item.text = updates.text.trim();
      }
      if (typeof updates.done === "boolean") {
        item.done = updates.done;
      }

      const now = Date.now();
      item.updatedAt = now;
      task.updatedAt = now;
      if (instigator) {task.lastModifiedBy = instigator.id;}

      // `updates.done` is `boolean | undefined`. The webview sends EITHER a
      // `done` toggle (checkbox) OR a `text` edit (field blur) — never both —
      // so per call exactly one of these holds:
      //   done === true        -> just checked   -> completed
      //   done === false       -> just unchecked -> reopened
      //   done === undefined   -> a text edit    -> renamed
      // Note: `undefined` matches neither `=== true` nor `=== false`, so the
      // text-edit case falls through to checklist_renamed as intended.
      let type: LynvoActivityType;
      if (updates.done === true) {
        type = "checklist_completed";
      } else if (updates.done === false) {
        type = "checklist_reopened";
      } else {
        type = "checklist_renamed";
      }

      // A rename shows "{task} ::: (old) ==> (new)" (a state change);
      // a done toggle shows the "(task) ::: (item)".
      const message =
        type === "checklist_renamed" && previousText !== item.text
          ? `{${task.title}} ::: (${previousText}) ==> (${item.text})`
          : `{${task.title}} ::: (${item.text})`;

      this.addActivity(board, type, message, instigator, { taskId });
    });
  }

  public static async deleteChecklistItem(
    taskId: string,
    itemId: string,
  ): Promise<void> {
    await this.mutateBoard(async (board) => {
      const task = board.tasks[taskId];
      if (!task) {return;}

      const instigator = await this.getSigningIdentity(board);
      const removedItem = task.checklist?.find((item) => item.id !== itemId);
      task.checklist = (task.checklist || []).filter((item) => item.id !== itemId);
      task.updatedAt = Date.now();
      if (instigator) {task.lastModifiedBy = instigator.id;}
      this.addActivity(
        board,
        "checklist_deleted",
        `{${task.title}} ::: (${removedItem?.text || "_reference_lost_"})`,
        instigator,
        { taskId }
      );
    });
  }

  public static async addTaskRelation(
    taskId: string,
    targetTaskId: string,
    type: LynvoTaskRelationType,
  ): Promise<void> {
    await this.mutateBoard(async (board) => {
      // Canonicalize (schema 3.0.0):
      // "blocks A->B" is stored on B as "blocked-by -> A";
      // the other types are stored as-is on the source task.
      // `taskId` is the source of the user's intent
      // the stored edge may live on a different task (the canonical owner).
      const { ownerId, storedType, targetId } = canonicalizeRelation(
        taskId,
        type,
        targetTaskId,
      );
      const owner = board.tasks[ownerId];
      const target = board.tasks[targetId];
      if (!owner || !target || ownerId === targetId) {return;}

      // Dedup the exact canonical edge on the owner.
      const relations = owner.relations || [];
      const alreadyExists = relations.some(
        (relation) =>
          relation.targetTaskId === targetId && relation.type === storedType,
      );
      if (alreadyExists) {return;}

      const instigator = await this.getSigningIdentity(board);
      const relation: LynvoTaskRelation = {
        id: this.createId("rel"),
        type: storedType,
        targetTaskId: targetId,
        createdAt: Date.now(),
      };

      owner.relations = [...relations, relation];
      owner.updatedAt = Date.now();
      if (instigator) {owner.lastModifiedBy = instigator.id;}
      this.addActivity(
        board,
        generateRelationActivityType(storedType, "added"),
        `{${owner.title}} <+> {${target.title}}`,
        instigator,
        { taskId: ownerId, targetTaskId: targetId, metadata: { type: storedType } },
      );
    });
  }

  public static async deleteTaskRelation(
    taskId: string,
    relationId: string,
  ): Promise<void> {
    await this.mutateBoard(async (board) => {
      const task = board.tasks[taskId];
      if (!task) {return;}

      // Capture the relation and its target task BEFORE filtering it out,
      // so the activity can show both task titles (relationId is NOT a task key).
      const relations = task.relations || [];
      const relation = relations.find((candidate) => candidate.id === relationId);
      if (!relation) {return;}
      const targetTask = board.tasks[relation.targetTaskId];

      const instigator = await this.getSigningIdentity(board);
      task.relations = relations.filter((candidate) => candidate.id !== relationId);
      task.updatedAt = Date.now();
      if (instigator) {task.lastModifiedBy = instigator.id;}
      this.addActivity(
        board,
        generateRelationActivityType(relation.type, "deleted"),
        `{${task.title}} <-> {${targetTask?.title || relation.targetTaskId}}`,
        instigator,
        { taskId, targetTaskId: relation.targetTaskId, metadata: { type: relation.type } },
      );
    });
  }

  public static async resolveConflict(
    conflictId: string,
    resolution: "local" | "remote",
  ): Promise<void> {
    await this.mutateBoard((board) => {
      const conflict = board.conflicts?.[conflictId];
      if (!conflict || conflict.resolved) {return;}

      const task = board.tasks[conflict.entityId];
      if (task && resolution === "remote") {
        if (conflict.field === "dueDate") {
          task.dueDate =
            typeof conflict.remoteValue === "number" ? conflict.remoteValue : undefined;
        } else if (conflict.field === "priority") {
          task.priority =
            conflict.remoteValue === "low" ||
            conflict.remoteValue === "medium" ||
            conflict.remoteValue === "high"
              ? conflict.remoteValue
              : "medium";
        } else {
          task[conflict.field] =
            typeof conflict.remoteValue === "string" ? conflict.remoteValue : "";
        }
        task.updatedAt = Date.now();
      }

      conflict.resolved = true;
      const unresolved = Object.values(board.conflicts || {}).some(
        (item) => !item.resolved,
      );
      board.sync = {
        ...this.getDefaultSyncMetadata(),
        ...(board.sync || {}),
        status: unresolved ? "conflict" : "pending",
        pendingChanges: true,
        message: unresolved ? "Unresolved conflicts" : "Conflicts resolved",
        updatedAt: Date.now(),
      };
    });
  }

  public static async createColumn(title: string, color: string): Promise<void> {
    await this.mutateBoard(async (board) => {
      const instigator = await this.getSigningIdentity(board);
      const colId = this.createId("col");
      const position = Object.keys(board.columns).length;
      board.columns[colId] = { id: colId, title, color, position };
      this.addActivity(
        board, "column_created", `[${title}]`,
        instigator,
        { metadata: { columnId: colId } }
      );
    });
  }

  public static async editColumn(
    id: string,
    title: string,
    color: string,
  ): Promise<void> {
    await this.mutateBoard(async (board) => {
      const column = board.columns[id];
      if (!column) {return;}

      const instigator = await this.getSigningIdentity(board);
      const previousTitle = column.title;
      const previousColor = column.color;
      column.title = title;
      column.color = color;

      // A title change is a rename ("old ==> new");
      // a color change has its own type;
      // a no-op edit falls back to the (deprecated) column_updated.
      let type: LynvoActivityType;
      let message: string;
      if (previousTitle !== title) {
        type = "column_renamed";
        message = `[${previousTitle}] ==> [${title}]`;
      } else if (previousColor !== color) {
        type = "column_color_changed";
        message = `[${title}]`;
      } else {
        type = "column_updated";
        message = `[${title}]`;
      }
      this.addActivity(
        board, type, message,
        instigator,
        { metadata: { columnId: id } }
      );
    });
  }

  public static async deleteColumn(id: string): Promise<void> {
    await this.mutateBoard(async (board) => {
      if (!board.columns[id]) {return;}

      const instigator = await this.getSigningIdentity(board);
      const title = board.columns[id].title;
      const columnsCount = Object.keys(board.columns).length;
      if (columnsCount <= 1) {
        vscode.window.showWarningMessage(
          t("You can not delete the last column in the table."),
        );
        return;
      }

      delete board.columns[id];
      this.addTombstone(board, "column", id, instigator);
      this.addActivity(
        board, "column_deleted", `[${title}]`,
        instigator,
        { metadata: { columnId: id } }
      );

      for (const taskId in board.tasks) {
        if (board.tasks[taskId].status === id) {
          delete board.tasks[taskId];
        }
      }
    });
  }

  public static async reorderColumns(
    updates: { id: string; position: number }[],
  ): Promise<void> {
    await this.mutateBoard((board) => {
      updates.forEach((upd) => {
        if (board.columns[upd.id]) {
          board.columns[upd.id].position = upd.position;
        }
      });
    });
  }

  public static async createLabel(name: string, color: string): Promise<void> {
    await this.mutateBoard(async (board) => {
      const instigator = await this.getSigningIdentity(board);
      if (!board.labels) {board.labels = {};}
      const labelId = this.createId("label");
      board.labels[labelId] = { id: labelId, name, color };
      this.addActivity(
        board, "label_created", `#${name}#`,
        instigator,
        { metadata: { labelId } }
      );
    });
  }

  public static async updateLabel(
    labelId: string,
    name: string,
    color: string,
  ): Promise<void> {
    await this.mutateBoard(async (board) => {
      const label = board.labels?.[labelId];
      if (!label) {return;}

      const previousName = label.name;
      const previousColor = label.color;
      const trimmed = name.trim();
      if (trimmed) {label.name = trimmed;}
      label.color = color;

      const instigator = await this.getSigningIdentity(board);
      if (previousName !== label.name) {
        this.addActivity(
          board,
          "label_renamed",
          `#${previousName}# ==> #${label.name}#`,
          instigator,
          { metadata: { labelId } },
        );
      }
      if (previousColor !== label.color) {
        this.addActivity(
          board,
          "label_color_changed",
          `#${label.name}#`,
          instigator,
          { metadata: { labelId } },
        );
      }
    });
  }

  public static async deleteLabel(labelId: string): Promise<void> {
    await this.mutateBoard(async (board) => {
      if (!board.labels || !board.labels[labelId]) {return;}

      const instigator = await this.getSigningIdentity(board);
      const name = board.labels[labelId].name;
      this.addTombstone(board, "label", labelId, instigator);
      delete board.labels[labelId];

      Object.values(board.tasks).forEach((task) => {
        task.labelIds = (task.labelIds || []).filter((id) => id !== labelId);
      });
      this.addActivity(
        board, "label_deleted", `#${name}#`,
        instigator,
        { metadata: { labelId } }
      );
    });
  }

  // ─── Identity management ────────────────────────────────────────────────

  /**
   * Per-machine "current identity" pointer.
   * Set by the UI (Register / Set Identity / Manage panel);
   * persisted in VS Code workspace state by the extension,
   * and used to sign createdBy / lastModifiedBy / activity actors.
   * It is intentionally NOT stored in the board JSON (per-machine, not committed).
   */
  private static activeIdentityId: string | undefined;

  public static setActiveIdentityId(id: string | undefined): void {
    this.activeIdentityId = id;
  }

  public static getActiveIdentityId(): string | undefined {
    return this.activeIdentityId;
  }

  /**
   * Resolve the identity that signs `createdBy`/`lastModifiedBy` (as its ID)
   * and the activity/presence/tombstone actors.
   * Returns `undefined` when no current identity is set (anonymous).
   * You should pass the in-memory `board` when available to avoid a redundant file read.
   */
  public static async getSigningIdentity(
    board?: LynvoBoard,
  ): Promise<LynvoIdentity | undefined> {
    const id = this.activeIdentityId;
    if (!id) {
      return undefined;
    }
    if (board?.identities?.[id]) {
      return board.identities[id];
    }
    try {
      const uri = this.joinModularPath("identities.json");
      if (uri && (await this.exists(uri))) {
        const identities = parseIdentitiesFile(await this.readJson<unknown>(uri)).identities;
        return identities?.[id];
      }
    } catch {
      // Corrupt identities file: treat as anonymous.
    }
    return undefined;
  }

  /**
   * Create a new identity.
   * - `displayName` is the human-readable name the user types.
   * - `source` is the Domain Provider: "local" | "github" | "gitlab".
   * - `sourceId` is the name of the Domain in which the identity belongs (e.g. "acme", or a GitHub username).
   * The sourceId is registered as a new (text) domain, if it does not exist yet.
   */
  public static async createIdentity(
    displayName: string,
    source: string,
    sourceId: string,
  ): Promise<LynvoIdentity> {
    const name = displayName.trim();
    const provider = (source || "").trim() || "local";
    const domain = (sourceId || "").trim();
    const identity: LynvoIdentity = {
      id: this.createId("id"),
      displayName: name,
      source: provider,
      sourceId: domain,
      createdAt: Date.now(),
    };

    await this.mutateBoard(async (board) => {
      board.identities = board.identities || {};
      board.identities[identity.id] = identity;
      // Register the domain if it is not known yet (defensive).
      if (domain) {
        if (!board.domains) {board.domains = {};}
        if (!board.domains[domain]) {
          board.domains[domain] = { name: domain, createdAt: Date.now() };
        }
      }
    });

    return identity;
  }

  /** Add a domain (a text-based entry, or a remote auth provider). */
  public static async addDomain(
    name: string,
    provider?: string,
    providerId?: string,
  ): Promise<LynvoDomain> {
    const domainName = (name || "").trim();
    const newDomain: LynvoDomain = {
      name: domainName,
      provider: provider || undefined,
      providerId: providerId || undefined,
      createdAt: Date.now(),
    };
    await this.mutateBoard(async (board) => {
      board.domains = board.domains || {};
      board.domains[domainName] = newDomain;
    });
    return newDomain;
  }

  /**
   * Remove a domain and handle the identities that belong to it:
   *  - keepIdentitiesLocal = true  -> re-home them onto the protected "local" domain
   *    (their id, display name and task assignments are preserved);
   *  - keepIdentitiesLocal = false -> delete them and clear their task assignments.
   * The "local" domain is the fallback and is never removed.
   */
  public static async removeDomain(
    name: string,
    keepIdentitiesLocal: boolean,
  ): Promise<void> {
    const dom = (name || "").trim();
    if (!dom || dom.toLowerCase() === "local") {
      return;
    }
    await this.mutateBoard(async (board) => {
      if (!board.domains || !board.domains[dom]) {
        return;
      }
      delete board.domains[dom];

      const affected = Object.values(board.identities || {}).filter(
        (identity) => identity.sourceId === dom,
      );
      if (keepIdentitiesLocal) {
        // Re-point the domain's identities at "local"; everything else is preserved.
        affected.forEach((identity) => {identity.sourceId = "local";});
        // Guarantee the new home exists in the registry.
        if (!board.domains["local"]) {
          board.domains["local"] = { name: "local", createdAt: Date.now() };
        }
      } else {
        // Delete the domain's identities and unassign any tasks that pointed at them.
        affected.forEach((identity) => {
          if (board.identities) {delete board.identities[identity.id];}
          Object.values(board.tasks).forEach((task) => {
            if (task.assigneeId === identity.id) {
              task.assigneeId = undefined;
              task.updatedAt = Date.now();
            }
          });
        });
        // If the current pointer was one of the removed identities, drop it (in-memory).
        if (affected.some((identity) => identity.id === this.activeIdentityId)) {
          this.activeIdentityId = undefined;
        }
      }
    });
  }

  /** Validate a domain name: non-empty and not already in use (case-insensitive). */
  public static validateDomainName(
    name: string,
    domains: Record<string, LynvoDomain>,
  ): string | null {
    const trimmed = name.trim();
    if (!trimmed) {
      return t("Domain name cannot be empty.");
    }
    if (
      Object.values(domains).some(
        (domain) => domain.name.toLowerCase() === trimmed.toLowerCase(),
      )
    ) {
      return t("A domain named \"{0}\" already exists.", trimmed);
    }
    return null;
  }

  /** Resolve an identity by ID from the board data. */
  public static async getIdentity(identityId: string): Promise<LynvoIdentity | undefined> {
    const board = await this.loadBoard();
    return board?.identities?.[identityId];
  }

  /** Rename an identity's display name (validated: non-empty, not reserved, not a duplicate). */
  public static async editIdentityName(
    identityId: string,
    displayName: string,
  ): Promise<void> {
    await this.mutateBoard(async (board) => {
      const identity = board.identities?.[identityId];
      if (!identity) {return;}
      const trimmed = displayName.trim();
      if (trimmed) {identity.displayName = trimmed;}
    });
  }

  /** Remove an identity, clear any task assignments pointing to it, and clear the pointer if it was current. */
  public static async removeIdentity(identityId: string): Promise<void> {
    await this.mutateBoard(async (board) => {
      if (!board.identities?.[identityId]) {return;}
      delete board.identities[identityId];
      // Clear dangling assignees on tasks that referenced the removed identity.
      Object.values(board.tasks).forEach((task) => {
        if (task.assigneeId === identityId) {
          task.assigneeId = undefined;
          task.updatedAt = Date.now();
        }
      });
      // If the removed identity was the current pointer, drop it (in-memory).
      if (this.activeIdentityId === identityId) {
        this.activeIdentityId = undefined;
      }
    });
  }

  /** Assign (or unassign) a task to an identity. */
  public static async assignTask(
    taskId: string,
    identityId: string | undefined,
  ): Promise<void> {
    await this.mutateBoard(async (board) => {
      const task = board.tasks[taskId];
      if (!task) {return;}
      task.assigneeId = identityId;
      task.updatedAt = Date.now();
      const instigator = await this.getSigningIdentity(board);
      if (instigator) {task.lastModifiedBy = instigator.id;}

      const assignee = identityId ? board.identities?.[identityId] : undefined;
      const assigneeName = assignee?.displayName || "Unassigned";
      this.addActivity(
        board,
        "task_updated",
        identityId ? `${task.title} <@> ${assigneeName}` : `${task.title} <@> Unassigned`,
        instigator,
        { taskId },
      );
    });
  }

  /**
   * Validate a display name: non-empty, not "Unassigned", not a duplicate.
   * A duplicate is only a duplicate within the same domain (`sourceId`),
   * so that two "Jane" from "Company-A" and "Company-B" can coexist.
   */
  public static validateDisplayName(
    name: string,
    identities: Record<string, LynvoIdentity>,
    excludeId?: string,
    domain?: string,
  ): string | null {
    const trimmed = name.trim();
    if (!trimmed) {
      return t("Display name cannot be empty.");
    }
    if (trimmed.toLowerCase() === "unassigned") {
      return t("Display name \"Unassigned\" is reserved.");
    }
    const domainKey = (domain || "").trim().toLowerCase();
    const duplicate = Object.values(identities).some(
      (id) =>
        id.id !== excludeId &&
        id.displayName.toLowerCase() === trimmed.toLowerCase() &&
        (id.sourceId || "").toLowerCase() === domainKey,
    );
    if (duplicate) {
      return t("An identity named \"{0}\" already exists in this domain.", trimmed);
    }
    return null;
  }
}
