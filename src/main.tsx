import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import cytoscape from "cytoscape";
import fcose from "cytoscape-fcose";
import coseBilkent from "cytoscape-cose-bilkent";
import App from "./App";
import RavenShell from "./refactor/RavenShell";
import "./index.css";

cytoscape.use(fcose);
cytoscape.use(coseBilkent);

const queryClient = new QueryClient();

// UI-refactor preview gate: the real App (sidebar shell) is the default. Add
// `?refactor` to the URL to preview the new RAVEN shell — new chrome wired to
// the same real panes. The pure design mockup (mock data) lives in
// RavenRefactor.tsx if a data-free visual reference is needed.
const showRefactor = new URLSearchParams(window.location.search).has("refactor");

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      {showRefactor ? <RavenShell /> : <App />}
    </QueryClientProvider>
  </React.StrictMode>
);
