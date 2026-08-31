import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import { config } from "@vscode/l10n";
import type { l10nJsonFormat } from "@vscode/l10n";

// Re-export the @vscode/l10n `t` so host modules have a single import point.
export { t } from "@vscode/l10n";

const BASE_BUNDLE_FILE = "vscode.l10n.bundle.json";
const LOCALIZATION_DIR = "localization";

let initialized = false;

/**
 * The extension bundles its code into `dist/extension.js`, so the l10n bundle
 * files (kept at the extension root) live one directory up from `__dirname`.
 */
function extensionRoot(): string {
  return path.join(__dirname, "..");
}

function readJson(file: string): Record<string, string> {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    return parsed && typeof parsed === "object" ? (parsed as Record<string, string>) : {};
  } catch {
    return {};
  }
}

/** Base language code of the current VS Code UI language (e.g. "en", "es"). */
function currentLanguage(): string {
  const lang = (vscode.env.language || "en").toLowerCase();
  return lang.split("-")[0].split("_")[0];
}

function mergedBundle(): l10nJsonFormat {
  const root = path.join(extensionRoot(), LOCALIZATION_DIR);
  const base = readJson(path.join(root, BASE_BUNDLE_FILE));
  const lang = currentLanguage();
  if (lang && lang !== "en") {
    const override = readJson(path.join(root, `vscode.l10n.${lang}.json`));
    if (Object.keys(override).length > 0) {
      return { ...base, ...override };
    }
  }
  return base as l10nJsonFormat;
}

/**
 * Load the l10n bundle (English base + optional locale override) and hand it to
 * @vscode/l10n. Safe to call multiple times. Because every key is its English
 * text, `t()` degrades to English if a bundle file is missing.
 */
export function initL10n(): void {
  if (initialized) {
    return;
  }
  config({ contents: mergedBundle() });
  initialized = true;
}

/** Return the merged bundle so the webview can be seeded with the same strings. */
export function getWebviewBundle(): l10nJsonFormat {
  initL10n();
  return mergedBundle();
}
