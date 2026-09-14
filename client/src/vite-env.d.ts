/// <reference types="vite/client" />

// cytoscape-fcose ships no types. Declared against cytoscape's own `Ext
//` type (verified in @types/cytoscape) instead of `any`, so `strict`
// still holds at the single `cytoscape.use(fcose)` call site.
declare module "cytoscape-fcose" {
  import type cytoscape from "cytoscape";
  const extension: cytoscape.Ext;
  export default extension;
}