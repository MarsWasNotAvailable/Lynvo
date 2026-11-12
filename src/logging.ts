import * as vscode from "vscode";

let lynvoChannel: vscode.LogOutputChannel | undefined;

/** Lazily create the shared "Lynvo" log output channel. */
function channel(): vscode.LogOutputChannel {
  if (!lynvoChannel) {
    lynvoChannel = vscode.window.createOutputChannel("Lynvo", { log: true });
  }
  return lynvoChannel;
}

/** Format a single argument the way `console` would display it. */
function formatValue(value: unknown): string {
  if (value instanceof Error) {
    return value.stack || value.message;
  }
  if (typeof value === "string") {
    return value;
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function format(args: unknown[]): string {
  return args.map(formatValue).join(" ");
}

/**
 * Lynvo logger: routes all extension log output to the dedicated "Lynvo"
 * channel (Output panel dropdown), instead of the shared
 * "Log (Extension Host)" channel where it gets lost among VS Code's own logs.
 * Mirrors the `console.*` API (levels + variadic arguments).
 */
export const LynvoLog = {
  log: (...args: unknown[]): void => {channel().info(format(args));},
  info: (...args: unknown[]): void => {channel().info(format(args));},
  warn: (...args: unknown[]): void => {channel().warn(format(args));},
  error: (...args: unknown[]): void => {channel().error(format(args));},
};

// Although the channels (above) are lazily created by design,
// it's easier debugging, when the Dropdown Entry already exists
// in the Output Panel.
LynvoLog.info("Creating log.");
