import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import { registerPmtilesProtocol } from "./lib/map";
import "./index.css";

// PMTiles protocol registration happens once here, not in map
// components: a per-component call is a footgun the next map screen
// would forget (the error only surfaces at runtime). createMap keeps
// its own guarded call as an idempotent backstop.
registerPmtilesProtocol();

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("root element not found");
}
const root = ReactDOM.createRoot(rootElement);

// M1-T7: `?camera-wall-demo` renders CameraWall against mock data instead
// of the app shell. Dev-only (`import.meta.env.DEV` is false in `vite
// build`) -- there is no real end-to-end integration to demo yet: the
// server's current `GET /cameras` (M1-T1) returns only
// {id, code, label, declared_start_ts, fps}, not the full API_CONTRACTS.md
// §2.6 shape (mode, effective_fps, status, node_id, stream_url) this
// component needs, and no client-side auth/session flow exists to attach a
// bearer token to that request yet (D21, ARCHITECTURE.md §7.1). Both are
// pre-existing gaps outside this task's scope, noted here rather than
// fixed as a side effect of it.
const showCameraWallDemo = import.meta.env.DEV && new URLSearchParams(location.search).has("camera-wall-demo");
const showGraphDemo = import.meta.env.DEV && new URLSearchParams(location.search).has("graph-demo");

async function render(): Promise<void> {
  const Root = showGraphDemo
    ? (await import("./dev/GraphDemo")).GraphDemo
    : showCameraWallDemo
      ? (await import("./dev/CameraWallDemo")).CameraWallDemo
      : App;
  root.render(
    <React.StrictMode>
      <Root />
    </React.StrictMode>,
  );
}

void render();
