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
  const leadingWs = (line.match(/^\s*/)?.[0]) || "";

  // Test for multiline comment opening tags, to deduce the closing tag.
  let closingTag: string | undefined;
  let isTripleQuote = false;
  if      (trimmed.startsWith("<!--"))  { closingTag = "-->"; }     // XML
  else if (trimmed.startsWith("--[["))  { closingTag = "]]"; }      // Lua
  else if (trimmed.startsWith("/*"))    { closingTag = "*/"; }      // C-like
  else if (trimmed.startsWith("=begin")){ closingTag = "=end"; }    // Ruby
  else if (trimmed.startsWith("=pod"))  { closingTag = "=cut"; }    // Perl
  else if (trimmed.startsWith("{-"))    { closingTag = "-}"; }      // Haskell
  else if (trimmed.startsWith('"""'))   { closingTag = '"""'; isTripleQuote = true; } // Python doubleys
  else if (trimmed.startsWith("'''") )  { closingTag = "'''"; isTripleQuote = true; } // Python singleys

  if (closingTag) {
    // For triple-quotes the opener and closer are the same token,
    // so we only insert before the closer
    // when the token also appears as a trailing token on this line.
    const sameLineClose = isTripleQuote
      ? trimmed.endsWith(closingTag) && trimmed.length > closingTag.length
      : true;
    const index = line.lastIndexOf(closingTag);
    if (sameLineClose && index !== -1) {
      const head = line.slice(0, index);
      const content = head.slice(leadingWs.length).replace(/\s+$/, "");
      return content
        ? `${leadingWs}${content} ${todoId} ${closingTag}`
        : `${leadingWs}${todoId} ${closingTag}`;
    }
  }

  // Multiline (closer on a later line) or plain line comments: simple append.
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
  t = t.replace(/^(\/\*\*|\/\*|\/\/|<!--|--|=begin|=pod|\{-|"""|'''|#|;|\*)/, "");
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
  // Strip leading comment markers : //, /*, <!--, --, =begin, =pod, {-, """, ''', #, ;, *
  title = title.replace(/^(\s*(?:\/\/|\/\*|<!--|--|=begin|=pod|\{-|"""|'''|#|;|\*)\s*)+/, "");
  // Strip the keyword and any following separator (":", "-", ".", space).
  for (const keyword of TODO_KEYWORDS) {
    if (title.startsWith(keyword)) {
      title = title.slice(keyword.length).replace(/^[\s:.\-]+/, "");
      break;
    }
  }
  // Strip any trailing Lynvo marker and comment-close markers.
  title = title
    .replace(MARKER_REGEX, "")
    .replace(/\s*(?:-->|\*\/|\]\]|-}|"""|'''|=end|=cut)\s*$/, "")
    .trim();
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
  return withFileLock(filePath, async () => {
    const text = await readFileTextLiveOrDisk(filePath);
    if (!text) {
      return false;
    }
    const lines = text.split("\n");
    const index = lines.findIndex((line) => line.includes(todoId));
    if (index === -1) {
      return false;
    }
    lines[index] = removeMarker(lines[index], todoId);
    return await writeFileTextLiveOrDisk(filePath, lines.join("\n"));
  });
}

/**
 * Remove the WHOLE TODO comment from the file, located by its marker token.
 * The marker line may be the comment's opener line or a continuation line inside it;
 * in both cases the entire comment is removed
 * (a continuation marker removes its enclosing block, from the opener line to the closer line).
 * For line comments, the consecutive comment run containing the marker is removed.
 * Returns its success.
 */
export async function removeTodoCommentFromFile(filePath: string, todoId: string): Promise<boolean> {
  return withFileLock(filePath, async () => {
    const text = await readFileTextLiveOrDisk(filePath);
    if (!text) {
      return false;
    }
    const lines = text.split("\n");
    const startIndex = lines.findIndex((line) => line.includes(todoId));
    if (startIndex === -1) {
      return false;
    }
    const { end: endIndex } = getCommentSpan(lines, startIndex);
    // Remove the whole comment, not just the marker line:
    // a continuation marker removes its enclosing block (opener -> closer),
    // a line-comment marker removes the consecutive comment run it belongs to.
    let removeStart = startIndex;
    const enclosing = findEnclosingBlock(lines, startIndex);
    if (enclosing) {
      removeStart = enclosing.openerIndex;
    } else {
      const opener = lineCommentOpener(lines[startIndex].trimStart());
      if (opener !== "") {
        for (let k = startIndex - 1; k >= 0; k--) {
          if ((lines[k] || "").trimStart().startsWith(opener)) {removeStart = k;}
          else {break;}
        }
      }
    }
    let removeCount = endIndex - removeStart + 1;
    // When the TODO comment is spaced out above and below,
    // the removal of the TODO comment leaves two blank line.
    // We attempt to remove the one below, if it exists.
    if (endIndex + 1 < lines.length && lines[endIndex + 1].trim() === "") {
      removeCount += 1;
    }
    lines.splice(removeStart, removeCount);
    return await writeFileTextLiveOrDisk(filePath, lines.join("\n"));
  });
}

/**
 * The marker token sits on the TODO line of a promoted comment,
 * which may be the comment's opener line OR a continuation line inside it
 * (e.g. Python docstrings, where content conventionally starts on line 2).
 * These helpers read/write that comment
 * (title = TODO line, description = the body lines that follow it),
 * and are pure where possible so they can be unit-tested.
 */

/** Ordered (opener, closer) pairs of the block comment styles we support. */
const BLOCK_COMMENT_PAIRS: Array<{ opener: string; closer: string; triple: boolean }> = [
  { opener: "/*",     closer: "*/",   triple: false }, // C-like
  { opener: "<!--",   closer: "-->", triple: false }, // XML / HTML
  { opener: "--[[",   closer: "]]",  triple: false }, // Lua
  { opener: "=begin", closer: "=end", triple: false }, // Ruby
  { opener: "=pod",   closer: "=cut", triple: false }, // Perl
  { opener: "{-",     closer: "-}",  triple: false }, // Haskell
  { opener: '"""',    closer: '"""',  triple: true  }, // Python (double quotes)
  { opener: "'''",    closer: "'''",  triple: true  }, // Python (single quotes)
];

/** Line-comment openers (no closing token; a block = consecutive repeated openers). */
const LINE_COMMENT_OPENERS: string[] = ["//", "--", "#", ";"];

/** Bounded upward scan distance when looking for an enclosing block opener. */
const MAX_UPWARD_SCAN = 200;

/** The block pair a (trimmed) line opens, or null when it opens none. */
function findBlockPairForLine(trimmed: string): { opener: string; closer: string; triple: boolean } | null {
  for (const pair of BLOCK_COMMENT_PAIRS) {
    if (trimmed.startsWith(pair.opener)) {
      return pair;
    }
  }
  return null;
}

/** The line-comment opener a (trimmed) line starts with, or "" when none. */
function lineCommentOpener(trimmed: string): string {
  for (const opener of LINE_COMMENT_OPENERS) {
    if (trimmed.startsWith(opener)) {
      return opener;
    }
  }
  return "";
}

/**
 * Find the index of the block's closing line, scanning downward from `startIndex`.
 * For `triple` openers (identical opener and closer, e.g. """),
 * the `startIndex` line only counts when the closer is a distinct trailing token,
 * so that the opener line itself is not mistaken for the close.
 */
function findBlockEnd(lines: string[], startIndex: number, closer: string, triple: boolean): number {
  for (let j = startIndex; j < lines.length; j++) {
    const line = lines[j];
    if (triple) {
      if (j === startIndex) {
        if (line.trim().endsWith(closer) && line.trim().length > closer.length) {return j;}
        continue;
      }
      if (line.trim().endsWith(closer)) {return j;}
    } else if (line.includes(closer)) {
      return j;
    }
  }
  return lines.length - 1;
}

/**
 * Find the block opener that encloses the line at `startIndex` (a TODO continuation line),
 * by scanning upward. A candidate block only counts when it is still open at `startIndex`
 * (its closer lies below), so the already-closed blocks above are ignored.
 * Returns the block pair and its opener line (and index), or null when not inside a block.
 */
function findEnclosingBlock(lines: string[], startIndex: number):
  | { pair: { opener: string; closer: string; triple: boolean }; openerLine: string; openerIndex: number }
  | null {
  const limit = Math.max(0, startIndex - MAX_UPWARD_SCAN);
  for (let k = startIndex - 1; k >= limit; k--) {
    const pair = findBlockPairForLine((lines[k] || "").trimStart());
    if (!pair) {continue;}
    if (findBlockEnd(lines, k, pair.closer, pair.triple) > startIndex) {
      return { pair, openerLine: lines[k], openerIndex: k };
    }
  }
  return null;
}

/** Strip a single line's comment decoration (bullet, opener/closer) for display. */
function stripLineDecoration(line: string): string {
  let t = line.trim();
  t = t.replace(/^(\*|\/\/|\/\*)\s?/, "");
  t = t.replace(/^(-->|\*\/|\]\])\s?/, "");
  // A Lua-style `--` bullet (only when followed by whitespace, so `--foo` survives).
  t = t.replace(/^--\s+/, "").replace(/^--$/, "");
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
 * The span of a TODO comment located at `startIndex`.
 * The TODO line may be the block opener itself (1),
 * a continuation line (2) inside a block opened on an earlier line,
 * a line comment (3) like `//`, `#`, `;` ,
 * or a bare line (4) e.g. inside a Python docstring.
 * Returns the closing-line index and the body lines in between;
 * intro lines above the TODO line are not part of the body.
 * NOTE : Block comments end at their closing sequence;
 * line-comment blocks end at the last consecutive line that repeats the opener.
 */
function getCommentSpan(lines: string[], startIndex: number): { end: number; bodyLines: string[] } {
  const first = (lines[startIndex] || "").trimStart();

  // 1) The line itself opens a block comment.
  const selfPair = findBlockPairForLine(first);
  if (selfPair) {
    const end = findBlockEnd(lines, startIndex, selfPair.closer, selfPair.triple);
    return { end, bodyLines: lines.slice(startIndex + 1, end) };
  }

  // 2) The line is a continuation inside a block opened above.
  const block = findEnclosingBlock(lines, startIndex);
  if (block) {
    const end = findBlockEnd(lines, startIndex, block.pair.closer, block.pair.triple);
    return { end, bodyLines: lines.slice(startIndex + 1, end) };
  }

  // Line-comment block: 
  // 3) consecutive lines repeating the line opener
  // 4) or a bare line.
  const opener = lineCommentOpener(first);
  let end = startIndex;
  if (opener) {
    for (let j = startIndex + 1; j < lines.length; j++) {
      if ((lines[j] || "").trimStart().startsWith(opener)) {end = j;}
      else {break;}
    }
  }
  return { end, bodyLines: lines.slice(startIndex + 1, end + 1) };
}

/** Derive the TODO comment description (as plain body lines) from source lines. */
export function deriveDescription(lines: string[], startIndex: number): string {
  const { bodyLines } = getCommentSpan(lines, startIndex);
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
  const { bodyLines } = getCommentSpan(lines, start);
  const body = parseBodyLines(bodyLines.map(stripLineDecoration));
  return { title: deriveTitle(lines[start]), ...body };
}

/** Parse a TODO selection (title line + body) into a payload, without requiring a marker. */
export function parseTodoSelection(lines: string[], startIndex: number): TodoCommentPayload {
  const { bodyLines } = getCommentSpan(lines, startIndex);
  const body = parseBodyLines(bodyLines.map(stripLineDecoration));
  return { title: deriveTitle(lines[startIndex]), ...body };
}

/** Render the full promoted comment lines (title + marker + body) for insertion at `startIndex`. */
export function buildPromotedComment(
  lines: string[],
  startIndex: number,
  todoId: string,
  payload: TodoCommentPayload,
): string[] {
  return renderTodoCommentLines(describeComment(lines, startIndex), todoId, payload);
}

/** The closing-line index of the comment starting at `startIndex`. */
export function getTodoCommentEndIndex(lines: string[], startIndex: number): number {
  return getCommentSpan(lines, startIndex).end;
}

/** Render the full comment (title line + marker + body + closer) from a style + payload. */
function renderTodoCommentLines(
  style: CommentStyle,
  todoId: string,
  payload: TodoCommentPayload,
): string[] {
  const titleText = payload.title.trim() || "(untitled)";
  const bodyLines = renderBodyLines(payload);
  const titleLine = `${style.leadingWs}${style.opener}${style.prefix}${titleText} ${todoId}`;
  if (style.closer === null) {
    return [titleLine, ...bodyLines.map((b) => `${style.bodyPrefix}${b}`)];
  }
  // A single-line block comment keeps opener, title, marker and closer on one line.
  if (bodyLines.length === 0 && style.openerOnThisLine) {
    return [`${style.leadingWs}${style.opener}${style.prefix}${titleText} ${todoId} ${style.closer}`];
  }
  return [
    titleLine,
    ...bodyLines.map((b) => `${style.bodyPrefix}${b}`),
    `${style.closerWs}${style.closer}`,
  ];
}

/** Renderable style of a TODO comment (opener, closer, prefixes). */
interface CommentStyle {
  leadingWs: string;
  opener: string;
  closer: string | null;
  closerWs: string;
  openerOnThisLine: boolean;
  prefix: string;
  bodyPrefix: string;
}

/** The keyword + separator as written after the opener (e.g. " TODO : "), or a single space. */
function keywordPrefix(afterOpener: string): string {
  for (const keyword of TODO_KEYWORDS) {
    const idx = afterOpener.indexOf(keyword);
    if (idx !== -1) {
      const after = afterOpener.slice(idx + keyword.length);
      const m = after.match(/^[\s:.\-]+/);
      const sepLen = m ? m[0].length : 1;
      return afterOpener.slice(0, idx + keyword.length + sepLen);
    }
  }
  return " ";
}

/** The comment decoration a continuation line carries itself (bullet or line-comment opener). */
function continuationDecoration(trimmed: string): string {
  // Bullet continuation (C-like ` * text`).
  if (trimmed.startsWith("*") && (trimmed.length === 1 || /\s/.test(trimmed.charAt(1)))) {
    return "*";
  }
  // Line-comment style inside a block (`-- TODO`, `# TODO`, ...).
  const opener = lineCommentOpener(trimmed);
  if (opener.length > 0 && (trimmed.length === opener.length || /\s/.test(trimmed.charAt(opener.length)))) {
    return opener;
  }
  return "";
}

/**
 * Describe the comment style used to render a TODO comment located at `startIndex`.
 * A continuation line (inside a block opened above) inherits the block's closer,
 * keeps its own bullet/opener, and aligns its closer line with the opener line's indentation.
 */
function describeComment(lines: string[], startIndex: number): CommentStyle {
  const line = lines[startIndex] || "";
  const leadingWs = (line.match(/^\s*/)?.[0]) || "";
  const trimmed = line.trimStart();

  // 1) The line itself opens a block comment.
  const selfPair = findBlockPairForLine(trimmed);
  if (selfPair) {
    return {
      leadingWs,
      opener: selfPair.opener,
      closer: selfPair.closer,
      closerWs: leadingWs,
      openerOnThisLine: true,
      prefix: keywordPrefix(trimmed.slice(selfPair.opener.length)),
      bodyPrefix: selfPair.opener === "/*" ? `${leadingWs} * ` : `${leadingWs}  `,
    };
  }

  // 2) Continuation inside a block opened above.
  const block = findEnclosingBlock(lines, startIndex);
  if (block) {
    const decoration = continuationDecoration(trimmed);
    const openerLineWs = (block.openerLine.match(/^\s*/)?.[0]) || "";
    return {
      leadingWs,
      opener: decoration,
      closer: block.pair.closer,
      closerWs: openerLineWs,
      openerOnThisLine: false,
      prefix: keywordPrefix(trimmed.slice(decoration.length)),
      bodyPrefix: decoration.length > 0 ? `${leadingWs}${decoration} ` : leadingWs,
    };
  }

  // 3) Line comment (`//`, `#`, `;`) or a bare line.
  const opener = lineCommentOpener(trimmed);
  return {
    leadingWs,
    opener,
    closer: null,
    closerWs: leadingWs,
    openerOnThisLine: false,
    prefix: keywordPrefix(trimmed.slice(opener.length)),
    bodyPrefix: `${leadingWs}${opener} `,
  };
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
  const { end } = getCommentSpan(lines, start);
  const newLines = renderTodoCommentLines(describeComment(lines, start), todoId, payload);
  return [...lines.slice(0, start), ...newLines, ...lines.slice(end + 1)].join("\n");
}

/**
 * Per-file serialization queue.
 * Ensures read-modify-write cycles on the same file never interleave,
 * which prevents lost updates (a stale read clobbering a newer write)
 * and the "content of the file is newer" save conflict
 * (a disk write racing a dirty editor buffer).
 * Each task runs strictly after the previous one for that file.
 * A rejecting task does not wedge the queue: the stored chain always resolves.
 */
const fileOperationQueues = new Map<string, Promise<void>>();

export function withFileLock<T>(filePath: string, task: () => Promise<T>): Promise<T> {
  const previous = fileOperationQueues.get(filePath) ?? Promise.resolve();
  const result = previous.then(task);
  fileOperationQueues.set(filePath, result.then(() => undefined, () => undefined));
  return result;
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

/** How long to wait for a document save before giving up (avoids hanging the handler). */
const SAVE_TIMEOUT_MS = 5000;

/**
 * Save a text document, guarded against a save that never settles:
 *  - a timeout, so a hung save cannot block the extension handler forever;
 *  - a catch, so a rejecting save is logged instead of crashing the caller.
 * Returns `true` when the save completed, `false` when it timed out or failed.
 * (A pending save remaining after the timeout is left to finish in the background,
 * we simply stop waiting for it.)
 */
export async function saveDocument(
  doc: vscode.TextDocument,
  timeoutMs: number = SAVE_TIMEOUT_MS,
): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const saved = await Promise.race([
      doc.save().then(
        () => true,
        (error: unknown) => {
          console.error("Lynvo: save failed", error);
          return false;
        },
      ),
      new Promise<false>((resolve) => {
        timer = setTimeout(() => resolve(false), timeoutMs);
      }),
    ]);
    if (!saved) {
      console.warn("Lynvo: save timed out after", timeoutMs, "ms for", doc.uri.toString());
    }
    return saved;
  } catch (error) {
    console.error("Lynvo: save threw", error);
    return false;
  } finally {
    if (timer) {clearTimeout(timer);}
  }
}

/**
 * Compute the single minimal region that differs between `oldText` and `newText`
 * (longest common prefix + longest common suffix),
 * so that only that region gets to be replaced.
 * Returns null when the two are identical.
 */
function minimalReplace(
  oldText: string,
  newText: string,
): { startOffset: number; endOffset: number; replacement: string } | null {
  if (oldText === newText) {
    return null;
  }
  const limit = Math.min(oldText.length, newText.length);
  let prefix = 0;
  while (prefix < limit && oldText[prefix] === newText[prefix]) {
    prefix++;
  }
  let suffix = 0;
  const maxSuffix = limit - prefix;
  while ( suffix < maxSuffix && oldText[oldText.length - 1 - suffix]
          === newText[newText.length - 1 - suffix]) {
    suffix++;
  }
  return {
    startOffset: prefix,
    endOffset: oldText.length - suffix,
    replacement: newText.slice(prefix, newText.length - suffix),
  };
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
    const oldText = doc.getText();
    const diff = minimalReplace(oldText, text);
    // No-op: the buffer already holds the desired content.
    if (!diff) {
      return true;
    }
    // Targeted replace : thanks to minimalReplace above,
    // only the changed region is rewritten,
    // so that the user's undo stack records a minimal edit,
    // and the time window for clobbering concurrent user edits is smaller.
    const edit = new vscode.WorkspaceEdit();
    const start = doc.positionAt(diff.startOffset);
    const end = doc.positionAt(diff.endOffset);
    edit.replace(doc.uri, new vscode.Range(start, end), diff.replacement);
    const applied = await vscode.workspace.applyEdit(edit);
    if (applied && wasCleanBeforeEdit) {
      // Guarded save : a hung/failed save must not block the caller.
      await saveDocument(doc);
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
  return withFileLock(filePath, async () => {
    const text = await readFileTextLiveOrDisk(filePath);
    if (!text) {return false;}
    const next = rewriteTodoComment(text, todoId, payload);
    if (!next) {return false;}
    return await writeFileTextLiveOrDisk(filePath, next);
  });
}

/**
 * Remove dangling relation lines from a promoted TODO comment
 * after the target task has been deleted.
 *
 * Promotion always rewrites a relation target to its `task-id {Title}` form,
 * so we match the leading (whitespace-separated) token of each relation target
 * against the deleted task's id. A `{Title}`-only or bare-title target will not
 * match - which is safe, since those are not reliable identifiers to scrub.
 *
 * Returns `true` when nothing needed to change (no dangling relation),
 * and `false` only when the file could not be read or written back.
 */
export async function removeDanglingRelationFromFile(
  filePath: string,
  todoId: string,
  deletedTaskId: string,
): Promise<boolean> {
  return withFileLock(filePath, async () => {
    const text = await readFileTextLiveOrDisk(filePath);
    if (!text) {return false;}
    const current = parseTodoComment(text, todoId);
    if (!current) {return false;}
    const targetsDeleted = (relation: TodoBodyRelation): boolean =>
      relation.target.trim().split(/\s+/)[0] === deletedTaskId;
    const kept = current.relations.filter((relation) => !targetsDeleted(relation));
    if (kept.length === current.relations.length) {return true;}
    const next = rewriteTodoComment(text, todoId, { ...current, relations: kept });
    if (!next) {return false;}
    return await writeFileTextLiveOrDisk(filePath, next);
  });
}

/**
 * Remove ALL relation lines from a promoted TODO comment.
 * Used when the owning task is deleted: any relation it declared (e.g. `[|] {Task}`)
 * no longer exists in the board, so it would dangle in the code.
 * Keeps the title, description and checklist;
 * the marker is preserved here (a separate demote step strips it).
 * Returns `true` on write success or when nothing needed to change,
 * and `false` only when the file could not be read or written back.
 */
export async function removeTodoCommentRelationsFromFile(
  filePath: string,
  todoId: string,
): Promise<boolean> {
  return withFileLock(filePath, async () => {
    const text = await readFileTextLiveOrDisk(filePath);
    if (!text) {return false;}
    const current = parseTodoComment(text, todoId);
    if (!current) {return false;}
    if (current.relations.length === 0) {return true;}
    const next = rewriteTodoComment(text, todoId, { ...current, relations: [] });
    if (!next) {return false;}
    return await writeFileTextLiveOrDisk(filePath, next);
  });
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
