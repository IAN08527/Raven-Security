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

// The new RAVEN shell (RavenShell — new chrome wired to the real panes) is now
// the default. The previous sidebar/tab console (App) stays available at
// `?legacy` as a fallback during the transition.
const useLegacy = new URLSearchParams(window.location.search).has("legacy");

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      {useLegacy ? <App /> : <RavenShell />}
    </QueryClientProvider>
  </React.StrictMode>
);
