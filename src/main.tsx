import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import cytoscape from "cytoscape";
import fcose from "cytoscape-fcose";
import coseBilkent from "cytoscape-cose-bilkent";
import App from "./App";
import RavenShell from "./refactor/RavenShell";
import RavenRefactor from "./refactor/RavenRefactor";
import "./index.css";

cytoscape.use(fcose);
cytoscape.use(coseBilkent);

const queryClient = new QueryClient();

// Entry selection:
//   /            → RavenShell   (new chrome wired to the real panes — the default)
//   ?legacy      → App          (old sidebar/tab console — transition fallback)
//   ?refactor    → RavenRefactor (pure design mockup, mock data — visual reference)
const params = new URLSearchParams(window.location.search);
const root = params.has("legacy") ? (
  <App />
) : params.has("refactor") ? (
  <RavenRefactor />
) : (
  <RavenShell />
);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>{root}</QueryClientProvider>
  </React.StrictMode>
);
