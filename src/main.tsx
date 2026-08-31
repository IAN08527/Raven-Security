import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import cytoscape from "cytoscape";
import fcose from "cytoscape-fcose";
import coseBilkent from "cytoscape-cose-bilkent";
import App from "./App";
import RavenRefactor from "./refactor/RavenRefactor";
import "./index.css";

cytoscape.use(fcose);
cytoscape.use(coseBilkent);

const queryClient = new QueryClient();

// UI-refactor preview gate: the real App is the default. Add `?refactor` to the
// URL to preview the new RAVEN design shell (mock data, no backend wiring yet).
const showRefactor = new URLSearchParams(window.location.search).has("refactor");

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      {showRefactor ? <RavenRefactor /> : <App />}
    </QueryClientProvider>
  </React.StrictMode>
);
