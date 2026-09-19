import type { LynvoBoard, LynvoTask, LynvoTaskRelation, LynvoTaskRelationType } from "./types";

/**
 * Pure relation-model helpers shared by the extension host and the webview.
 *
 * Canonical storage model (schema 3.0.0):
 *  - A task stores only `blocked-by`, `related`, and `duplicates` relations.
 *  - `blocks` is never stored:
 *    "A blocks B" is the reciprocal of "B is blocked-by A",
 *    so it is stored as a `blocked-by` relation on B targeting A.
 *  - A task's `blocks` list is *derived*:
 *    every task whose stored `blocked-by` points back at it.
 *
 * `related` and `duplicates` keep their stored direction (source -> target).
 */

/** A stored relation's type is always one of these (`blocks` is derived only). */
export type StoredRelationType = Exclude<LynvoTaskRelationType, "blocks">;

/** One display/sync relation, annotated with where it is stored. */
export interface TaskRelationView {
  type: LynvoTaskRelationType;
  targetTaskId: string;
  /** The task that holds the stored relation (owner of the edge). */
  ownerId: string;
  /** The stored relation's id (used to delete the canonical edge). */
  relationId: string;
  /** True when this is a derived `blocks` entry (stored as the owner's `blocked-by`). */
  derived: boolean;
}

/**
 * Canonicalize a user-facing relation intent into the single stored edge.
 * `blocks A->B` is stored on B as `blocked-by -> A`;
 * the other types are stored as-is on the source task.
 */
export function canonicalizeRelation(
  sourceId: string,
  type: LynvoTaskRelationType,
  targetId: string,
): { ownerId: string; storedType: StoredRelationType; targetId: string } {
  if (type === "blocks") {
    return { ownerId: targetId, storedType: "blocked-by", targetId: sourceId };
  }
  return { ownerId: sourceId, storedType: type, targetId };
}

/**
 * The full relation set for a task: its own stored relations
 * (blocked-by / related / duplicates) plus its derived `blocks`.
 */
export function fullRelationsForTask(
  board: LynvoBoard,
  taskId: string,
): TaskRelationView[] {
  const tasks = board.tasks || {};
  const views: TaskRelationView[] = [];

  for (const relation of tasks[taskId]?.relations || []) {
    views.push({
      type: relation.type,
      targetTaskId: relation.targetTaskId,
      ownerId: taskId,
      relationId: relation.id,
      derived: false,
    });
  }

  // Derived `blocks`: every other task that is `blocked-by` this task.
  for (const other of Object.values(tasks)) {
    if (other.id === taskId) {continue;}
    for (const relation of other.relations || []) {
      if (relation.type === "blocked-by" && relation.targetTaskId === taskId) {
        views.push({
          type: "blocks",
          targetTaskId: other.id,
          ownerId: other.id,
          relationId: relation.id,
          derived: true,
        });
        break; // one edge per other task
      }
    }
  }

  return views;
}

/**
 * True when a relation already exists between `a` and `b` in either direction (any type).
 * Used for making "add" a no-op on a duplicate intent.
 */
export function hasRelationBetween(board: LynvoBoard, a: string, b: string): boolean {
  const tasks = board.tasks || {};
  for (const relation of tasks[a]?.relations || []) {
    if (relation.targetTaskId === b) {return true;}
  }
  for (const relation of tasks[b]?.relations || []) {
    if (relation.targetTaskId === a) {return true;}
  }
  return false;
}

/**
 * A canonical edge key is `"owner::storedType::storedTarget"`,
 * identifying the single stored edge that backs a displayed relation.
 *
 *  - own relation (type X->Y): stored on X -> `X::type::Y`
 *  - derived blocks (blocks X->Y, i.e. "X blocks Y"):
 *    stored on Y as blocked-by->X -> `Y::blocked-by::X`
 *
 * This lets the webview, the in-code render, the sync check,
 * and the add/delete handlers to compare the SAME logical edge;
 * regardless of which side (blocker vs blocked) they are looking at.
 */
export function canonicalEdgeKey(
  ownerId: string,
  storedType: LynvoTaskRelationType,
  storedTarget: string,
): string {
  return `${ownerId}::${storedType}::${storedTarget}`;
}

/**
 * Map a displayed relation (as seen on `taskId`)
 * to the canonical edge key that stores it.
 * `blocks` is derived and lives on the target task;
 * the other types are stored on `taskId` itself.
 */
export function relationEdgeKey(
  taskId: string,
  type: LynvoTaskRelationType,
  targetId: string,
): string {
  if (type === "blocks") {
    // "taskId blocks targetId" is stored on targetId as blocked-by -> taskId.
    return canonicalEdgeKey(targetId, "blocked-by", taskId);
  }
  return canonicalEdgeKey(taskId, type, targetId);
}

/** The set of canonical edge keys backing the FULL relation set of `taskId` . */
export function fullEdgeKeys(board: LynvoBoard, taskId: string): Set<string> {
  const keys = new Set<string>();
  for (const relation of fullRelationsForTask(board, taskId)) {
    keys.add(relationEdgeKey(taskId, relation.type, relation.targetTaskId));
  }
  return keys;
}

/** A plan for reconciling full relation set of `taskId`, against a desired set. */
export interface RelationChangePlan {
  /** Edges to delete. Each carries the canonical `ownerId` + stored `relationId`. */
  edgeToRemove: TaskRelationView[];
  /** Edges to add, expressed from `taskId`'s perspective (display type + target). */
  edgeToAdd: Array<{ type: LynvoTaskRelationType; targetTaskId: string }>;
}

/**
 * Compute which of `taskId`'s FULL relations (own + derived `blocks`)
 * must be added or removed to reach the `desired` set
 * (a display list from `taskId`'s perspective).
 * Both sides are compared by canonical edge key,
 * so that a `blocks` edge (stored on the other task) is matched
 * and reconciled correctly in both directions.
 */
export function planRelationChanges(
  board: LynvoBoard,
  taskId: string,
  desiredRelation: Array<{ type: LynvoTaskRelationType; targetTaskId: string }>,
): RelationChangePlan {
  const boardEdges = fullRelationsForTask(board, taskId);
  const desiredKeys = new Set(desiredRelation.map(
    (relation) => relationEdgeKey(taskId, relation.type, relation.targetTaskId))
  );
  const boardKeys = new Set(boardEdges.map(
    (relation) => relationEdgeKey(taskId, relation.type, relation.targetTaskId))
  );
  const toRemove = boardEdges.filter(
    (edge) => !desiredKeys.has(relationEdgeKey(taskId, edge.type, edge.targetTaskId))
  );
  const toAdd = desiredRelation.filter(
    (relation) => !boardKeys.has(relationEdgeKey(taskId, relation.type, relation.targetTaskId))
  );
  return { edgeToRemove: toRemove, edgeToAdd: toAdd };
}

/**
 * The counterpart task IDs whose in-code comment also carries one of the changed edges
 * (`blocks`/`blocked-by` are reciprocal and render on both sides),
 * so their comments must be refreshed too.
 */
export function findChangedCounterpartIds(plan: RelationChangePlan): Set<string> {
  // strings (primitive type) are compared by value for uniqueness
  const uniqueTaskIds = new Set<string>();
  for (const subtractive of plan.edgeToRemove) {
    if (subtractive.type === "blocks" || subtractive.type === "blocked-by") {
      uniqueTaskIds.add(subtractive.targetTaskId);
    }
  }
  for (const additive of plan.edgeToAdd) {
    if (additive.type === "blocks" || additive.type === "blocked-by") {
      uniqueTaskIds.add(additive.targetTaskId);
    }
  }
  return uniqueTaskIds;
}

/**
 * Return a clone of `board` with `plan` applied to `taskId`'s relations.
 * Removals delete the canonical edge from its owner;
 * additions are canonicalized (a `blocks` edge lands on the target task as `blocked-by`).
 * Used to derive the FINAL full-relation state for in-code rendering before the
 * board is committed (so that the counterpart comments reflect both adds and removals).
 */
export function applyRelationPlan(
  board: LynvoBoard,
  taskId: string,
  plan: RelationChangePlan,
): LynvoBoard {
  const tasks: Record<string, LynvoTask> = {};
  for (const [id, task] of Object.entries(board.tasks)) {
    tasks[id] = { ...task, relations: (task.relations || []).slice() };
  }
  for (const subtractive of plan.edgeToRemove) {
    const owner = tasks[subtractive.ownerId];
    if (!owner) {continue;}
    owner.relations = (owner.relations || []).filter(
      (relation) => relation.id !== subtractive.relationId
    );
  }
  for (const additive of plan.edgeToAdd) {
    const { ownerId, storedType, targetId } = canonicalizeRelation(
      taskId, additive.type, additive.targetTaskId
    );
    const owner = tasks[ownerId];
    if (!owner) {continue;}
    const alreadyExists = (owner.relations || []).some(
      (relation) => relation.type === storedType && relation.targetTaskId === targetId
    );
    if (!alreadyExists) {
      const entry: LynvoTaskRelation = {
        id: `sim-${ownerId}-${targetId}`,
        type: storedType,
        targetTaskId: targetId,
        createdAt: 0,
      };
      owner.relations = [...(owner.relations || []), entry];
    }
  }
  return { ...board, tasks };
}
