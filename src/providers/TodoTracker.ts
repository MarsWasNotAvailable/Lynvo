import * as vscode from "vscode";
import type { LynvoBoard, LynvoTaskRelationType } from "../types";

/**
 * Keywords (case-sensitive) that mark a source line as promotable into a Lynvo task.
 * Add, remove, or edit entries here to change which lines can be promoted.
 */
export const TODO_KEYWORDS: string[] = ["TODO", "IDEA", "FIXME"];

/** Prefix used for the unique marker token written into source files. */
export const MARKER_PREFIX = "lynvo-todo";

/** Matches any Lynvo TODO marker token, e.g. `lynvo-todo-m5xk2-d7f3g9h1`. */
export const MARKER_REGEX = /lynvo-todo-[0-9a-z]+-[0-9a-z]+/;

const escapeRegex = (value: string): string =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Generate a unique Lynvo TODO marker ID. */
export function generateTodoId(): string {
  const random = Math.random().toString(36).slice(2, 10);
  return `${MARKER_PREFIX}-${Date.now().toString(36)}-${random}`;
}

/** Return true if the line contains any promotable keyword. */
export function lineHasTodoKeyword(line: string): boolean {
  return TODO_KEYWORDS.some((keyword) => line.includes(keyword));
}

/** Return true if the line already carries a Lynvo TODO marker. */
export function lineHasMarker(line: string): boolean {
  return MARKER_REGEX.test(line);
}

/**
 * Append the marker token to a comment line, keeping it inside the existing comment.
 * For a single-line block comment the marker is inserted before the closing tag;
 * otherwise it is appended at the end of the line.
 */
export function appendMarker(line: string, todoId: string): string {
  const trimmed = line.trimStart();

  // Test for Multiline comment opening tags, to deduce the closing tag
  let closingTag: string | undefined;
  if (trimmed.startsWith("<!--")) {
    closingTag = "-->"; //XML
  } else if (trimmed.startsWith("--[[")) {
    closingTag = "]]";  //LUA
  } else if (trimmed.startsWith("/*")) {
    closingTag = "*/";  //C-like
  }

  if (closingTag) {
    const index = line.lastIndexOf(closingTag);
    if (index !== -1) {
      const head = line.slice(0, index);
      const leadingWs = (head.match(/^\s*/)?.[0]) || "";
      const content = head.slice(leadingWs.length).replace(/\s+$/, "");
      return content
        ? `${leadingWs}${content} ${todoId} ${closingTag}`
        : `${leadingWs}${todoId} ${closingTag}`;
    }
  }

  //Plain line comments are left as a simple append.
  return `${line.replace(/\s+$/, "")} ${todoId}`;
}

/** Remove a specific marker token from a line, cleaning up surrounding whitespace. */
export function removeMarker(line: string, todoId: string): string {
  const escaped = escapeRegex(todoId);
  return line
    .replace(new RegExp(`\\s*${escaped}\\s?`), "")
    .replace(/\s+$/, "");
}

/** Strip leading whitespace and a single comment opener, plus following spaces. */
function stripCommentStart(line: string): string {
  let t = line.replace(/^\s+/, "");
  t = t.replace(/^(\/\*\*|\/\*|\/\/|<!--|--|#|;|\*)/, "");
  return t.replace(/^\s+/, "");
}

/**
 * A (single-line or multiline) comment is a promotable TODO
 * when a TODO keyword is found as the FIRST word of a comment,
 * followed by a space or a colon.
 * Those rules are to meant to rule out identifiers like `TODO_KEYWORDS`
 * or comments that merely mentions TODO.
 */
export function isTodoCommentLine(line: string): boolean {
  const t = stripCommentStart(line);
  for (const keyword of TODO_KEYWORDS) {
    if (t.startsWith(keyword)) {
      const rest = t.slice(keyword.length);
      if (rest.length === 0 || /^[\s:]/.test(rest)) {
        return true;
      }
    }
  }
  return false;
}

/** Derive a human-readable task title from a TODO source line. */
export function deriveTitle(line: string): string {
  let title = line.trim();
  // Strip leading comment markers (//, /*, <!--, --, #, ;, *).
  title = title.replace(/^(\s*(?:\/\/|\/\*|<!--|--|#|;|\*)\s*)+/, "");
  // Strip the keyword and any following separator (":", "-", ".", space).
  for (const keyword of TODO_KEYWORDS) {
    if (title.startsWith(keyword)) {
      title = title.slice(keyword.length).replace(/^[\s:.\-]+/, "");
      break;
    }
  }
  // Strip any trailing Lynvo marker and comment-close markers.
  title = title.replace(MARKER_REGEX, "").replace(/(-->|\*\/)\s*$/, "").trim();
  return title || line.trim();
}

function resolveWorkspaceFile(filePath: string): vscode.Uri | undefined {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) {
    return undefined;
  }
  return vscode.Uri.joinPath(folders[0].uri, filePath);
}

async function readWorkspaceFileText(filePath: string): Promise<string> {
  const uri = resolveWorkspaceFile(filePath);
  if (!uri) {
    throw new Error("No workspace folder is open.");
  }
  const data = await vscode.workspace.fs.readFile(uri);
  return Buffer.from(data).toString("utf8");
}

async function writeWorkspaceFileText(filePath: string, text: string): Promise<void> {
  const uri = resolveWorkspaceFile(filePath);
  if (!uri) {
    throw new Error("No workspace folder is open.");
  }
  await vscode.workspace.fs.writeFile(uri, Buffer.from(text, "utf8"));
}

/** Find the 0-based line index that contains the given marker token, or -1. */
export async function findMarkerLineIndex(filePath: string, todoId: string): Promise<number> {
  let text: string;
  try {
    text = await readWorkspaceFileText(filePath);
  } catch {
    return -1;
  }
  return text.split("\n").findIndex((line) => line.includes(todoId));
}

/** Remove the marker token from the line that contains it. Returns success. */
export async function removeMarkerFromFile(filePath: string, todoId: string): Promise<boolean> {
  let lines: string[];
  try {
    lines = (await readWorkspaceFileText(filePath)).split("\n");
  } catch {
    return false;
  }
  const index = lines.findIndex((line) => line.includes(todoId));
  if (index === -1) {
    return false;
  }
  lines[index] = removeMarker(lines[index], todoId);
  await writeWorkspaceFileText(filePath, lines.join("\n"));
  return true;
}

/**
 * Remove the WHOLE TODO comment from the file, located by its marker token.
 * The marker sits on the comment's first line;
 * for block-style comments the full comment span is removed,
 * otherwise only that line is removed.
 * Returns its success.
 */
export async function removeTodoCommentFromFile(filePath: string, todoId: string): Promise<boolean> {
  let lines: string[];
  try {
    lines = (await readWorkspaceFileText(filePath)).split("\n");
  } catch {
    return false;
  }
  const startIndex = lines.findIndex((line) => line.includes(todoId));
  if (startIndex === -1) {
    return false;
  }
  const firstLine = lines[startIndex].trimStart();
  const isMultiline =  firstLine.startsWith("/*")   // C-like
                    || firstLine.startsWith("<!--") // XML
                    || firstLine.startsWith("--[[") // LUA
                    ;
  let endIndex = startIndex;
  if (isMultiline) {
    for (let j = startIndex; j < lines.length; j++) {
      if (lines[j].includes("*/") || lines[j].includes("-->")|| lines[j].includes("]]")) {
        endIndex = j;
        break;
      }
    }
  }
  let removeCount = endIndex - startIndex + 1;
  // When the TODO comment is spaced out above and below,
  // the removal of the TODO comment leaves two blank line.
  // We attempt to remove the one below, if it exists.
  if (endIndex + 1 < lines.length && lines[endIndex + 1].trim() === "") {
    removeCount += 1;
  }
  lines.splice(startIndex, removeCount);
  await writeWorkspaceFileText(filePath, lines.join("\n"));
  return true;
}

/**
 * The marker token always sits on the FIRST line of a promoted TODO comment.
 * These helpers read/write that comment
 * (title = first line, description = the remaining body),
 * and are pure where possible so they can be unit-tested.
 */

/** Find the index of the comment's closing line, given its first (marker) line. */
function findCommentEndIndex(lines: string[], startIndex: number): number {
  const first = (lines[startIndex] || "").trimStart();
  let closer: string | undefined;
  if (first.startsWith("/*")) { closer = "*/"; }
  else if (first.startsWith("<!--")) { closer = "-->"; }
  else if (first.startsWith("--[[")) { closer = "]]"; }
  if (!closer) {return startIndex;}
  // The closer may be on the same line (single-line block comment).
  for (let j = startIndex; j < lines.length; j++) {
    if (lines[j].includes(closer)) {return j;}
  }
  return lines.length - 1;
}

/** Strip a single line's comment decoration (bullet, opener/closer) for display. */
function stripLineDecoration(line: string): string {
  let t = line.trim();
  t = t.replace(/^(\*|\/\/|\/\*)\s?/, "");
  t = t.replace(/^(-->|\*\/|\]\])\s?/, "");
  return t.trim();
}

/** A checklist entry captured from a promoted TODO comment body. */
export interface TodoBodyChecklistItem {
  text: string;
  done: boolean;
}

/** A relation entry from a promoted TODO comment body; `target` is the code-facing string. */
export interface TodoBodyRelation {
  type: LynvoTaskRelationType;
  target: string;
}

/** Full parsed/rendered content of a promoted TODO comment. */
export interface TodoCommentPayload {
  title: string;
  description: string;
  checklist: TodoBodyChecklistItem[];
  relations: TodoBodyRelation[];
}

/** Relation marker character -> relation type. */
const RELATION_MARKER_TO_TYPE: Record<string, LynvoTaskRelationType> = {
  "!": "blocked-by",
  "|": "blocks",
  "=": "duplicates",
  "&": "related",
};
/** Relation type -> marker character. Built by reversing RELATION_MARKER_TO_TYPE. */
const RELATION_TYPE_TO_MARKER = Object.fromEntries(
  Object.entries(RELATION_MARKER_TO_TYPE).map(([k, v]) => [v, k])
) as {
  [P in keyof typeof RELATION_MARKER_TO_TYPE as typeof RELATION_MARKER_TO_TYPE[P]]: P
};

const CHECKLIST_LINE = /^\[(\s|x|X)\]\s?(.*)$/;
const RELATION_LINE = /^\[([!&|=])\]\s?(.*)$/;

/** Classify one stripped body line into description / checklist / relation. */
function classifyBodyLine(line: string):
  | { kind: "description"; text: string }
  | { kind: "checklist"; text: string; done: boolean }
  | { kind: "relation"; type: LynvoTaskRelationType; target: string } {
  const checklist = line.match(CHECKLIST_LINE);
  if (checklist) {
    return { kind: "checklist", text: checklist[2].trim(), done: checklist[1] !== " " };
  }
  const relation = line.match(RELATION_LINE);
  if (relation) {
    const type = RELATION_MARKER_TO_TYPE[relation[1]];
    if (type) {
      return { kind: "relation", type, target: relation[2].trim() };
    }
  }
  return { kind: "description", text: line };
}

/** Parse stripped body lines into description + checklist + relations. */
function parseBodyLines(bodyLines: string[]): Omit<TodoCommentPayload, "title"> {
  const descriptionLines: string[] = [];
  const checklist: TodoBodyChecklistItem[] = [];
  const relations: TodoBodyRelation[] = [];
  for (const raw of bodyLines) {
    const line = raw.trim();
    if (line.length === 0) {continue;}
    const classified = classifyBodyLine(line);
    if (classified.kind === "description") {descriptionLines.push(classified.text);}
    else if (classified.kind === "checklist") {checklist.push({ text: classified.text, done: classified.done });}
    else {relations.push({ type: classified.type, target: classified.target });}
  }
  return { description: descriptionLines.join("\n"), checklist, relations };
}

/** Render description + checklist + relations into plain body lines (fixed order). */
function renderBodyLines(body: Omit<TodoCommentPayload, "title">): string[] {
  const lines: string[] = [];
  for (const d of body.description.split("\n")) {
    const t = d.trim();
    if (t) {lines.push(t);}
  }
  for (const item of body.checklist) {
    lines.push(item.done ? `[x] ${item.text}` : `[ ] ${item.text}`);
  }
  for (const relation of body.relations) {
    lines.push(`[${RELATION_TYPE_TO_MARKER[relation.type]}] ${relation.target}`);
  }
  return lines;
}

/**
 * The span of a TODO comment starting at `startIndex`.
 * Returns the closing-line index and the body lines in between.
 * NOTE : Multilines comments end at their closing sequence;
 * while line comments blocks end at the last consecutive line that repeats the opener.
 */
function commentSpan(lines: string[], startIndex: number): { end: number; bodyLines: string[] } {
  const style = describeComment(lines[startIndex]);
  if (style.closer !== null) {
    const end = findCommentEndIndex(lines, startIndex);
    return { end, bodyLines: lines.slice(startIndex + 1, end) };
  }
  let end = startIndex;
  for (let j = startIndex + 1; j < lines.length; j++) {
    if (style.opener && lines[j].trimStart().startsWith(style.opener)) {end = j;}
    else {break;}
  }
  return { end, bodyLines: lines.slice(startIndex + 1, end + 1) };
}

/** Derive the TODO comment description (as plain body lines) from source lines. */
export function deriveDescription(lines: string[], startIndex: number): string {
  const { bodyLines } = commentSpan(lines, startIndex);
  return parseBodyLines(bodyLines.map(stripLineDecoration)).description;
}

/** Parse a TODO comment (by marker token) into title, description, checklist, relations. */
export function parseTodoComment(
  text: string,
  todoId: string,
): TodoCommentPayload | undefined {
  const lines = text.split("\n");
  const start = lines.findIndex((line) => line.includes(todoId));
  if (start === -1) {return undefined;}
  const { bodyLines } = commentSpan(lines, start);
  const body = parseBodyLines(bodyLines.map(stripLineDecoration));
  return { title: deriveTitle(lines[start]), ...body };
}

/** Parse a TODO selection (title line + body) into a payload, without requiring a marker. */
export function parseTodoSelection(lines: string[], startIndex: number): TodoCommentPayload {
  const { bodyLines } = commentSpan(lines, startIndex);
  const body = parseBodyLines(bodyLines.map(stripLineDecoration));
  return { title: deriveTitle(lines[startIndex]), ...body };
}

/** Render the full promoted comment lines (title + marker + body) for insertion. */
export function buildPromotedComment(
  firstLine: string,
  todoId: string,
  payload: TodoCommentPayload,
): string[] {
  return renderTodoCommentLines(firstLine, todoId, payload);
}

/** The closing-line index of the comment starting at `startIndex`. */
export function getTodoCommentEndIndex(lines: string[], startIndex: number): number {
  return commentSpan(lines, startIndex).end;
}

/** Render the full comment (title line + marker + body + closer) from a style + payload. */
function renderTodoCommentLines(
  firstLine: string,
  todoId: string,
  payload: TodoCommentPayload,
): string[] {
  const style = describeComment(firstLine);
  const titleText = payload.title.trim() || "(untitled)";
  const bodyLines = renderBodyLines(payload);
  const titleLine = `${style.leadingWs}${style.opener}${style.prefix}${titleText} ${todoId}`;
  if (style.closer === null) {
    return [titleLine, ...bodyLines.map((b) => `${style.bodyPrefix}${b}`)];
  }
  if (bodyLines.length === 0) {
    return [`${style.leadingWs}${style.opener}${style.prefix}${titleText} ${todoId} ${style.closer}`];
  }
  return [titleLine, ...bodyLines.map((b) => `${style.bodyPrefix}${b}`), `${style.leadingWs}${style.closer}`];
}

/** Describe the comment's leading whitespace, opener/closer, and keyword prefix. */
function describeComment(firstLine: string): {
  leadingWs: string;
  opener: string;
  closer: string | null;
  prefix: string;
  bodyPrefix: string;
} {
  const leadingWs = (firstLine.match(/^\s*/)?.[0] || "");
  const trimmed = firstLine.trimStart();
  let opener = "";
  let closer: string | null = null;
  if      (trimmed.startsWith("/*"))   {opener = "/*"; closer = "*/";}
  else if (trimmed.startsWith("<!--")) {opener = "<!--"; closer = "-->";}
  else if (trimmed.startsWith("--[[")) {opener = "--[["; closer = "]]";}
  else if (trimmed.startsWith("//"))   {opener = "//";}
  else if (trimmed.startsWith("#"))    {opener = "#";}
  else if (trimmed.startsWith(";"))    {opener = ";";}

  // Reconstruct the prefix (keyword + separator) exactly as it was formatted,
  // so we keep the user's original TODO/IDEA/FIXME and its punctuation.
  const afterOpener = trimmed.slice(opener.length);
  let prefix = " ";
  for (const kw of TODO_KEYWORDS) {
    const idx = afterOpener.indexOf(kw);
    if (idx !== -1) {
      const after = afterOpener.slice(idx + kw.length);
      const m = after.match(/^[\s:.\-]+/);
      const sepLen = m ? m[0].length : 1;
      prefix = afterOpener.slice(0, idx + kw.length + sepLen);
      break;
    }
  }
  // Body (continuation) lines: repeat the opener for line comments,
  // otherwise use a bullet aligned with the opener.
  let bodyPrefix: string;
  if (closer === null) {
    bodyPrefix = `${leadingWs}${opener} `;
  } else if (opener === "/*") {
    bodyPrefix = `${leadingWs} * `;
  } else {
    bodyPrefix = `${leadingWs}  `;
  }
  return { leadingWs, opener, closer, prefix, bodyPrefix };
}

/**
 * Rebuild the TODO comment (by marker token) from a full payload
 * (title, description, checklist, relations).
 * Preserves the comment style, opener, keyword and marker placement.
 * Returns the updated full text, or undefined if the marker was not found.
 */
export function rewriteTodoComment(
  text: string,
  todoId: string,
  payload: TodoCommentPayload,
): string | undefined {
  const lines = text.split("\n");
  const start = lines.findIndex((line) => line.includes(todoId));
  if (start === -1) {return undefined;}
  const { end } = commentSpan(lines, start);
  const newLines = renderTodoCommentLines(lines[start], todoId, payload);
  return [...lines.slice(0, start), ...newLines, ...lines.slice(end + 1)].join("\n");
}

/** Locate the open (possibly unsaved) document for a workspace-relative path. */
function findOpenDocument(filePath: string): vscode.TextDocument | undefined {
  for (const doc of vscode.workspace.textDocuments) {
    if (!vscode.workspace.getWorkspaceFolder(doc.uri)) {continue;}
    if (vscode.workspace.asRelativePath(doc.uri, false) === filePath) {return doc;}
  }
  return undefined;
}

/** Read a file's text from the open (unsaved) buffer when available, else disk. */
export async function readFileTextLiveOrDisk(filePath: string): Promise<string | undefined> {
  const doc = findOpenDocument(filePath);
  if (doc) {return doc.getText();}
  try {
    return await readWorkspaceFileText(filePath);
  } catch {
    return undefined;
  }
}

/**
 * Write text to a file, or to disk:
 * Applying to the open (unsaved) buffer when available,
 * so we never clobber in-progress edits.
 *
 * When the file is open in the editor:
 *  - If it was "clean" (already saved to disk) before our edit, we save it again afterwards,
 *    so the user is not left with a lingering "unsaved" dot.
 *  - If it was "dirty" (had unsaved changes), we leave it unsaved
 *    (never force save on the user's pending work).
 */
export async function writeFileTextLiveOrDisk(filePath: string, text: string): Promise<boolean> {
  const doc = findOpenDocument(filePath);
  if (doc) {
    const wasCleanBeforeEdit = !doc.isDirty;
    const fullRange = new vscode.Range(
      new vscode.Position(0, 0),
      doc.lineAt(Math.max(0, doc.lineCount - 1)).range.end,
    );
    const edit = new vscode.WorkspaceEdit();
    edit.replace(doc.uri, fullRange, text);
    const applied = await vscode.workspace.applyEdit(edit);
    if (applied && wasCleanBeforeEdit) {
      await doc.save();
    }
    return applied;
  }
  try {
    await writeWorkspaceFileText(filePath, text);
    return true;
  } catch {
    return false;
  }
}

/** Read a promoted TODO comment's content, from the live buffer or disk. */
export async function readTodoComment(
  filePath: string,
  todoId: string,
): Promise<TodoCommentPayload | undefined> {
  const text = await readFileTextLiveOrDisk(filePath);
  if (!text) {return undefined;}
  return parseTodoComment(text, todoId);
}

/** Rewrite a promoted TODO comment's full content (live buffer or disk). */
export async function replaceTodoComment(
  filePath: string,
  todoId: string,
  payload: TodoCommentPayload,
): Promise<boolean> {
  const text = await readFileTextLiveOrDisk(filePath);
  if (!text) {return false;}
  const next = rewriteTodoComment(text, todoId, payload);
  if (!next) {return false;}
  return await writeFileTextLiveOrDisk(filePath, next);
}

/** Whether board -> code propagation is enabled (opt-out setting). */
export function isInCodeEditingEnabled(): boolean {
  try {
    const value = vscode.workspace.getConfiguration("lynvo").get<boolean>("enableInCodeEditing");
    return value !== false;
  } catch {
    return true;
  }
}

/**
 * Resolve a relation target expression (from code) to a task.
 * Accepted forms, in order:
 *  - a bare task id;
 *  - a Lynvo TODO marker (of another promoted task);
 *  - Lynvo's written form `task-id {Title}` (leading id token);
 *  - a `{Title}` or bare title, matched case-insensitively.
 */
export function resolveRelationTarget(
  board: LynvoBoard,
  target: string,
): { taskId: string; title: string } | undefined {
  const t = target.trim();
  const tasks = board.tasks;
  // 1) A bare task id.
  if (tasks[t]) {
    return { taskId: t, title: tasks[t].title };
  }
  // 2) A Lynvo TODO marker (of another promoted task).
  const marker = t.match(MARKER_REGEX);
  if (marker) {
    const owner = Object.values(tasks).find((task) => task.codeReference?.todoId === marker[0]);
    if (owner) {
      return { taskId: owner.id, title: owner.title };
    }
  }
  // 3) Lynvo writes relations as `task-id {Title}`; try the leading id token.
  const firstToken = t.split(/\s+/)[0];
  if (firstToken !== t && tasks[firstToken]) {
    return { taskId: firstToken, title: tasks[firstToken].title };
  }
  // 4) A braced `{Title}` (or a bare title), matched case-insensitively.
  const titleMatch = t.match(/\{(.+)\}/);
  const titleText = (titleMatch ? titleMatch[1] : t).trim().toLowerCase();
  if (titleText) {
    const byTitle = Object.values(tasks).find(
      (task) => task.title.trim().toLowerCase() === titleText,
    );
    if (byTitle) {
      return { taskId: byTitle.id, title: byTitle.title };
    }
  }
  return undefined;
}
