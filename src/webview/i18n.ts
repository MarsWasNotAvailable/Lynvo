import { config } from "@vscode/l10n";
import type { l10nJsonFormat } from "@vscode/l10n";

// Re-export `t` so webview modules share one import point.
export { t } from "@vscode/l10n";

declare global {
  interface Window {
    /** Merged l10n bundle injected by the extension host before this script runs. */
    __LYNVO_I18N__?: l10nJsonFormat;
  }
}

// The extension host injects the merged (English base + locale) bundle
// into the page before this module loads,
// so configure the webview's @vscode/l10n copy with it.
// Without it, t() still degrades to the English keys.
if (typeof window !== "undefined" && window.__LYNVO_I18N__) {
  config({ contents: window.__LYNVO_I18N__ });
}
