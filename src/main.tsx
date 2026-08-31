import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import cytoscape from "cytoscape";
import fcose from "cytoscape-fcose";
import coseBilkent from "cytoscape-cose-bilkent";
import RavenRefactor from "./refactor/RavenRefactor";
import "./index.css";

cytoscape.use(fcose);
cytoscape.use(coseBilkent);

const queryClient = new QueryClient();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <RavenRefactor />
    </QueryClientProvider>
  </React.StrictMode>
);
