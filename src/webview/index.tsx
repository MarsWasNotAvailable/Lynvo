// src/webview/index.tsx
// Seed the webview's l10n bundle before App is evaluated
// so that its module-level localized values (e.g. relationLabels)
// are resolved with the active locale.
import "./i18n";
import * as React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";

const container = document.getElementById("root");
if (container) {
  const root = createRoot(container);
  root.render(<App />);
}
