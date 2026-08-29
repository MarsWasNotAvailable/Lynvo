import * as vscode from "vscode";

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

/** Append the marker token to the end of a line (keeping it inside the existing comment). */
export function appendMarker(line: string, todoId: string): string {
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
  const isMultiline =
    firstLine.startsWith("/*") || firstLine.startsWith("<!--");
  let endIndex = startIndex;
  if (isMultiline) {
    for (let j = startIndex; j < lines.length; j++) {
      if (lines[j].includes("*/") || lines[j].includes("-->")) {
        endIndex = j;
        break;
      }
    }
  }
  lines.splice(startIndex, endIndex - startIndex + 1);
  await writeWorkspaceFileText(filePath, lines.join("\n"));
  return true;
}
