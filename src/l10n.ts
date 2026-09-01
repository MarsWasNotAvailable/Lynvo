import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import { config } from "@vscode/l10n";
import type { l10nJsonFormat } from "@vscode/l10n";

// Re-export the @vscode/l10n `t` so host modules have a single import point.
export { t } from "@vscode/l10n";

const BASE_BUNDLE_FILE = "vscode.l10n.bundle.json";
const LOCALIZATION_DIR = "localization";
const DEFAULT_LANGUAGE = "auto";

/**
 * The language (e.g. "en", "es") we use for rendering the UI.
 * Allows to override the VSCode Display Language settings.
 * "auto" means follow the VS Code UI language.
 */
let activeLanguage = DEFAULT_LANGUAGE;

/**
 * The extension bundles its code into `dist/extension.js`,
 * while l10n bundle folder is kept at the extension root :
 * the localization folder is relatively one directory up from current `__dirname`.
 */
function getLocalizationDir(): string {
  return path.join(__dirname, "..", LOCALIZATION_DIR);
}

function readJson(file: string): Record<string, string> {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    return parsed && typeof parsed === "object" ? (parsed as Record<string, string>) : {};
  } catch {
    return {};
  }
}

/** Resolve the effective language code from the active override or VS Code. */
function resolveLanguage(): string {
  if (activeLanguage && activeLanguage !== DEFAULT_LANGUAGE) {
    return activeLanguage.toLowerCase();
  }
  const lang = (vscode.env.language || "en").toLowerCase();
  return lang.split("-")[0].split("_")[0];
}

function mergedBundle(): l10nJsonFormat {
  const localizationDir = getLocalizationDir();
  const base = readJson(path.join(localizationDir, BASE_BUNDLE_FILE));
  const lang = resolveLanguage();
  if (lang && lang !== "en") {
    const override = readJson(path.join(localizationDir, `vscode.l10n.${lang}.json`));
    if (Object.keys(override).length > 0) {
      return { ...base, ...override };
    }
  }
  return base as l10nJsonFormat;
}

/** Read the persisted language preference (default "auto"). */
function loadSetting(): string {
  try {
    const value = vscode.workspace.getConfiguration("lynvo").get<string>("language");
    if (value) {
      return value;
    }
  } catch {
    // Ignore and fall back to "auto".
  }
  return DEFAULT_LANGUAGE;
}

/** Available languages: "en" plus any per-locale bundle files found on disk. */
export function getAvailableLanguages(): string[] {
  const langs = new Set<string>(["en"]);
  const localizationDir = getLocalizationDir();
  try {
    for (const file of fs.readdirSync(localizationDir)) {
      const match = /^vscode\.l10n\.([a-z]{2,3})\.json$/i.exec(file);
      if (match) {
        langs.add(match[1].toLowerCase());
      }
    }
  } catch {
    // Ignore; only "en" is guaranteed.
  }
  return Array.from(langs).sort();
}

/** Human-readable native name for a language code (e.g. "es" -> "Español"). */
export function getLanguageDisplayName(code: string): string {
  const normalized = code.toLowerCase().split("-")[0].split("_")[0];
  try {
    return new Intl.DisplayNames([normalized], { type: "language" }).of(normalized) || normalized;
  } catch {
    return normalized;
  }
}

/** Apply a language at runtime and re-configure @vscode/l10n so t() resolves it. */
export function setLanguage(language: string): void {
  activeLanguage = language && language.trim() ? language : DEFAULT_LANGUAGE;
  config({ contents: mergedBundle() });
}

/** The active language override ("auto" or a concrete code). */
export function getActiveLanguage(): string {
  return activeLanguage;
}

/**
 * Load the l10n bundle (English base + locale override)
 * and hand it to \@vscode/l10n.
 * Safe to call multiple times.
 * Because every key is its English text,
 * t() degrades to English if a bundle file is missing.
 */
export function initL10n(): void {
  activeLanguage = loadSetting();
  config({ contents: mergedBundle() });
}

/** Return the merged bundle so the webview can be seeded with the same strings. */
export function getWebviewBundle(): l10nJsonFormat {
  return mergedBundle();
}
