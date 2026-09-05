import * as fs from "fs";
import * as path from "path";

/**
 * Single source of truth for the Lynvo data schema version and the CHANGELOG
 * location. Both are read from the extension's `package.json`, so bumping the
 * version or moving the repo only ever requires editing one place.
 *
 * The extension bundles to `dist/extension.js`, so `package.json` sits one
 * directory above the runtime `__dirname` (the same layout assumption l10n.ts
 * uses to locate the `localization/` folder).
 */

const FALLBACK_SCHEMA_VERSION = "2.1.0";
const FALLBACK_CHANGELOG_URL =
  "https://github.com/DevBySergio/Lynvo_by_Sergio/blob/main/CHANGELOG.md";

// Cache: `undefined` = not read yet, `null` = read but unavailable.
let packageJson: Record<string, unknown> | null | undefined;

function readPackageJson(): Record<string, unknown> {
  if (packageJson !== undefined) {
    return packageJson || {};
  }
  const candidate = path.join(__dirname, "..", "package.json");
  try {
    const parsed = JSON.parse(
      fs.readFileSync(candidate, "utf8"),
    ) as Record<string, unknown>;
    if (parsed && typeof parsed === "object" && parsed.name === "lynvo") {
      packageJson = parsed;
      return parsed;
    }
  } catch {
    // Fall through to the built-in defaults below.
  }
  packageJson = null;
  return {};
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/** The data schema version this extension is configured for (from package.json). */
export function getSchemaVersion(): string {
  return asString(readPackageJson().schemaVersion) || FALLBACK_SCHEMA_VERSION;
}

/** URL of the CHANGELOG, used by the schema-mismatch warning (from package.json). */
export function getChangelogUrl(): string {
  return asString(readPackageJson().changelogUrl) || FALLBACK_CHANGELOG_URL;
}

export interface SemVer {
  major: number;
  minor: number;
  patch: number;
}

/** Parse a "major.minor.patch" string into its numeric parts (defaults to 0). */
export function parseSemVer(version: string): SemVer {
  const [major = "0", minor = "0", patch = "0"] = version.split(".");
  return {
    major: Number.parseInt(major, 10) || 0,
    minor: Number.parseInt(minor, 10) || 0,
    patch: Number.parseInt(patch, 10) || 0,
  };
}

/** Compare two semver strings: -1 if a < b, 0 if equal, 1 if a > b. */
export function compareSemVer(a: string, b: string): -1 | 0 | 1 {
  const left = parseSemVer(a);
  const right = parseSemVer(b);
  if (left.major !== right.major) {return left.major > right.major ? 1 : -1;}
  if (left.minor !== right.minor) {return left.minor > right.minor ? 1 : -1;}
  if (left.patch !== right.patch) {return left.patch > right.patch ? 1 : -1;}
  return 0;
}

/** The higher of two semver strings (returns `a` when `b` is missing). */
export function maxVersion(a: string, b: string | undefined): string {
  if (!b) {return a;}
  return compareSemVer(a, b) >= 0 ? a : b;
}

/**
 * True only when the MAJOR version field differs (minor/patch are ignored).
 * Returns false when `b` is missing or not a clean semver, so we never warn
 * about a version we cannot confidently interpret (avoids false positives).
 */
export function majorDiffers(a: string, b: string | undefined): boolean {
  if (!b) {return false;}
  const dbMajor = strictMajor(b);
  if (dbMajor === null) {return false;}
  return parseSemVer(a).major !== dbMajor;
}

/** The MAJOR version as an integer, or null when it is not a clean "<int>." prefix. */
function strictMajor(version: string): number | null {
  const token = version.trim().split(".")[0] ?? "";
  if (!/^\d+$/.test(token)) {return null;}
  const value = Number.parseInt(token, 10);
  return Number.isFinite(value) ? value : null;
}
