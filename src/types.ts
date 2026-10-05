export interface LynvoUser {
  githubId: string;
  username: string;
  avatarUrl?: string;
}

export interface LynvoPresenceUser extends LynvoUser {
  lastSeenAt: number;
}

/**
 * A `LynvoIdentity` contains :
 * a generated `id` like `id-mur3r8ds-vow62vvv`,
 * with a fancy name like `John`,
 * which resides in a Domain like `john-doe-1234`,
 * and that Domain might be sourced locally or remoteley (`local` vs `github`).
 * A user `John` owning the account `john-doe-1234@github.com`,
 * might be visualized as `John@john-doe-1234` in this internal system;
 * and its local Agent might be visualized as `Agent@john-doe-1234`.
 * This concept can be expanded to companies like, for example :
 * `wile@acme` and `raplh@acme` employees belonging to the same Domain `acme`.
 */
export interface LynvoIdentity {
  id: string;
  displayName: string;
  /** Domain Provider - Where does the domain comes from: "local" | "github" | "gitlab" ? */
  source: string;
  /** Domain Name - What group does the Identity belongs to : "acme" | "a-github-username" ? */
  sourceId: string;
  createdAt: number;
}

/**
 * A domain is used to group identities.
 * The "local" domain always exists.
 * Remote domains are created by authenticating with a provider
 * (the account name becomes the domain);
 * Local domains are created through the Manage Identity panel
 * (their uniqueness outside the project cannot be guaranteed).
 */
export interface LynvoDomain {
  name: string;          // "local" | "acme" (unique, used as the key)
  provider?: string;     // "github" | "gitlab" for third-party domains; absent for text domains
  providerId?: string;   // Provider account id (e.g. GitHub numeric id)
  createdAt: number;     // Unix timestamp in milliseconds
}

export interface CodeReference {
  filePath: string;
  /** Unique Lynvo TODO marker token embedded in the source file (preferred). */
  todoId?: string;
  /** Legacy line-based reference, kept for backward compatibility with old boards. */
  lineStart?: number;
  lineEnd?: number;
}

export interface LynvoColumn {
  id: string;
  title: string;
  color: string;
  position: number;
}

export interface LynvoLabel {
  id: string;
  name: string;
  color: string;
}

export interface LynvoChecklistItem {
  id: string;
  text: string;
  done: boolean;
  createdAt: number;
  updatedAt: number;
}

export type LynvoTaskRelationType = "blocks" | "blocked-by" | "related" | "duplicates";

export interface LynvoTaskRelation {
  id: string;
  type: LynvoTaskRelationType;
  targetTaskId: string;
  createdAt: number;
}

export type LynvoActivityType =
  | "task_created"
  | "task_updated"
  | "task_renamed"
  | "task_moved"
  | "task_deleted"
  | "link_added"
  | "link_removed"
  | "column_created"
  | "column_updated"
  | "column_renamed"
  | "column_color_changed"
  | "column_deleted"
  | "label_created"
  | "label_renamed"
  | "label_color_changed"
  | "label_deleted"
  | "checklist_added"
  | "checklist_updated"
  | "checklist_renamed"
  | "checklist_completed"
  | "checklist_reopened"
  | "checklist_deleted"
  | "relation_added"
  | "relation_deleted"
  | "relation_block_added"
  | "relation_block_deleted"
  | "relation_blockedby_added"
  | "relation_blockedby_deleted"
  | "relation_duplicates_added"
  | "relation_duplicates_deleted";

export interface LynvoActivity {
  id: string;
  type: LynvoActivityType;
  message: string;
  createdAt: number;
  actor: LynvoUser;
  taskId?: string;
  targetTaskId?: string;
  metadata?: Record<string, string | number | boolean | null>;
}

export type LynvoSyncStatus =
  | "idle"
  | "pending"
  | "syncing"
  | "synced"
  | "offline"
  | "failed"
  | "conflict";

export interface LynvoSyncMetadata {
  branch: string;
  status: LynvoSyncStatus;
  pendingChanges: boolean;
  lastSyncAt: number | null;
  lastRemoteCommit: string | null;
  message?: string;
  updatedAt: number;
}

export interface LynvoTombstone {
  id: string;
  entityType: "task" | "column" | "label";
  entityId: string;
  deletedAt: number;
  deletedBy: LynvoUser;
}

export interface LynvoConflict {
  id: string;
  entityType: "task";
  entityId: string;
  field: "title" | "description" | "status" | "priority" | "dueDate";
  localValue: string | number | null;
  remoteValue: string | number | null;
  createdAt: number;
  resolved: boolean;
}

export interface LynvoTask {
  id: string;
  title: string;
  description: string;
  status: string;
  /** Identity ID (stored in identities.json) that created the task; undefined = anonymous. */
  createdBy?: string;
  /** Identity ID (stored in identities.json) that last modified the task; undefined = anonymous. */
  lastModifiedBy?: string;
  createdAt: number;
  updatedAt: number;
  codeReference?: CodeReference;
  position?: number;
  labelIds?: string[];
  priority?: "low" | "medium" | "high";
  dueDate?: number;
  checklist?: LynvoChecklistItem[];
  relations?: LynvoTaskRelation[];
  /** Identity ID of the assigned worker (references identities.json). */
  assigneeId?: string;
}

export interface LynvoBoard {
  version: string;
  columns: Record<string, LynvoColumn>;
  tasks: Record<string, LynvoTask>;
  labels?: Record<string, LynvoLabel>;
  users?: Record<string, LynvoPresenceUser>;
  identities?: Record<string, LynvoIdentity>;
  domains?: Record<string, LynvoDomain>;
  activity?: Record<string, LynvoActivity>;
  sync?: LynvoSyncMetadata;
  tombstones?: Record<string, LynvoTombstone>;
  conflicts?: Record<string, LynvoConflict>;
}
