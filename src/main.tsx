import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { framed } from "./lib/env";
import { ErrorBoundary } from "./components/error-boundary";
import { useStore } from "./store";
import "./index.css";

// Installed as an app, Chrome prefixes the window title with the app name unless the title already
// starts with it; the long SEO title is for the browser tab only.
if (matchMedia("(display-mode: standalone)").matches) document.title = "OpenMeet Web";

// Uncaught errors land in the diagnostics log, where a bug report can include them.
const describe = (value: unknown) => (value instanceof Error ? value.message : String(value));
// ErrorEvent.message already reads "Uncaught Error: …" in Chromium, so prefer the error object's own message.
window.addEventListener("error", (event) => useStore.getState().logError(`Uncaught: ${event.error !== undefined ? describe(event.error) : event.message}`));
window.addEventListener("unhandledrejection", (event) => useStore.getState().logError(`Unhandled: ${describe(event.reason)}`));

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
);

// A dongle granted in an earlier visit can be reopened without the picker (never inside another site's frame).
if (navigator.hid && !framed) void useStore.getState().reconnectPermitted();
