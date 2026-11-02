import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { useStore } from "./store";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

// A dongle granted in an earlier visit can be reopened without the picker.
if (navigator.hid) void useStore.getState().reconnectPermitted();
