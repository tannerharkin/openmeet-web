import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { useStore } from "./store";
import "./index.css";

// Installed as an app, Chrome prefixes the window title with the app name unless the title already
// starts with it; the long SEO title is for the browser tab only.
if (matchMedia("(display-mode: standalone)").matches) document.title = "OpenMeet Web";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

// A dongle granted in an earlier visit can be reopened without the picker.
if (navigator.hid) void useStore.getState().reconnectPermitted();
