// Local basemap configuration (D6, FR-6.2, design §2): MapLibre GL JS
// over the locally hosted Maharashtra PMTiles extract. No third-party
// tile or glyph requests — the only network origin this module ever
// contacts is `localhost:8802` in development (VITE_BASEMAP_URL /
// VITE_BASEMAP_URL_BASE), both overridable independently for deployment.
//
// Glyphs: Noto Sans Regular / Bold PBF stacks from
// infra/tiles/glyphs/ (Apache 2.0, © Google via OpenMapTiles/fonts v2.0,
// LICENSE in infra/tiles/glyphs/FONTS_LICENCE). Served by the same nginx
// basemap host so there is zero font egress (rule 6, CLAUDE.md).
//
// Symbol layers: place labels and major-road labels only. Field values
// in `kind` and `kind_detail` were read from the live extract before use
// (places kinds: locality, region[, country]; roads major kind_detail:
// motorway, trunk, primary) so the dark style stays uncluttered without
// guessing at the tileset contents. Layout field values (the `name`
// field) are declared in the source schema and verified present; no
// other label types are added per design §2.
//
// Source-layer names below were read from the extract itself
// (`pmtiles show --metadata infra/tiles/maharashtra.pmtiles`):
// boundaries, buildings, earth, landcover, landuse, places, pois,
// roads, water. Centre [76.75, 18.82] is the archive's own centre.

import maplibregl, { type StyleSpecification } from "maplibre-gl";
import { Protocol } from "pmtiles";

const PROTOCOL_SCHEME = "pmtiles";
const DARK_SURFACE = "#060809";

let protocolRegistered = false;

export function registerPmtilesProtocol(): void {
  if (protocolRegistered) {
    return;
  }
  maplibregl.addProtocol(PROTOCOL_SCHEME, new Protocol().tile);
  protocolRegistered = true;
}

export function basemapUrl(): string {
  const env = (import.meta as unknown as { env?: Record<string, string> }).env;
  const url = env?.VITE_BASEMAP_URL;
  if (!url) {
    throw new Error(
      "Local PMTiles extract not provisioned (D6). No third-party tiles are requested.",
    );
  }
  return url;
}

export function basemapUrlBase(): string {
  const env = (import.meta as unknown as { env?: Record<string, string> }).env;
  const url = env?.VITE_BASEMAP_URL_BASE;
  if (!url) {
    throw new Error(
      "Basemap URL base not provisioned (D6). Glyphs require a local origin.",
    );
  }
  return url.replace(/\/$/, "");
}

export function basemapAttribution(): string {
  const env = (import.meta as unknown as { env?: Record<string, string> }).env;
  return env?.VITE_BASEMAP_ATTRIBUTION ?? "© OpenStreetMap contributors";
}

export function darkBasemapStyle(url: string, urlBase: string, attribution: string): StyleSpecification {
  return {
    version: 8,
    name: "Raven local basemap (Maharashtra PMTiles)",
    glyphs: `${urlBase}/glyphs/{fontstack}/{range}.pbf`,
    sources: {
      maharashtra: {
        type: "vector",
        url: `${PROTOCOL_SCHEME}://${url}`,
        attribution,
      },
    },
    layers: [
      {
        id: "background",
        type: "background",
        paint: { "background-color": DARK_SURFACE },
      },
      {
        id: "earth",
        type: "fill",
        source: "maharashtra",
        "source-layer": "earth",
        paint: { "fill-color": "#0d1113" },
      },
      {
        id: "water",
        type: "fill",
        source: "maharashtra",
        "source-layer": "water",
        paint: { "fill-color": "#10333d" },
      },
      {
        id: "buildings",
        type: "fill",
        source: "maharashtra",
        "source-layer": "buildings",
        paint: { "fill-color": "#161b1e" },
      },
      {
        id: "roads",
        type: "line",
        source: "maharashtra",
        "source-layer": "roads",
        paint: {
          "line-color": "#2b3134",
          "line-width": ["interpolate", ["linear"], ["zoom"], 5, 0.5, 12, 2],
        },
      },
      {
        id: "boundaries",
        type: "line",
        source: "maharashtra",
        "source-layer": "boundaries",
        paint: { "line-color": "#262d31", "line-width": 1 },
      },
      {
        id: "place-labels",
        type: "symbol",
        source: "maharashtra",
        "source-layer": "places",
        layout: {
          // Ground field in the extract schema (verified). Places kinds in
          // this archive: locality, region, country. All are label-worthy;
          // the tileset's own min_zoom gates when each feature appears, so
          // the map stays dark and uncluttered without a guessed threshold.
          "text-field": ["get", "name"],
          "text-font": ["Noto Sans Regular"],
          "text-size": 12,
          "text-max-width": 6,
        },
        paint: { "text-color": "#a0a8b0" },
      },
      {
        id: "road-labels",
        type: "symbol",
        source: "maharashtra",
        "source-layer": "roads",
        // Filter grounded in the live extract: major kind_detail values are
        // motorway / trunk / primary (verified at z6-z14). Residential,
        // unclassified and link variants are excluded to keep the dark
        // style uncluttered per design §2.
        filter: ["match", ["get", "kind_detail"], ["motorway", "trunk", "primary"], true, false],
        layout: {
          "text-field": ["get", "name"],
          "text-font": ["Noto Sans Regular"],
          "text-size": 10,
          "text-max-width": 4,
        },
        paint: { "text-color": "#606870" },
      },
    ],
  };
}

export function createMap(container: HTMLElement): maplibregl.Map {
  registerPmtilesProtocol();
  return new maplibregl.Map({
    container,
    style: darkBasemapStyle(basemapUrl(), basemapUrlBase(), basemapAttribution()),
    center: [76.75, 18.82],
    zoom: 6,
    // ODbL attribution stays expanded and visible, never compacted away.
    // customAttribution replaces MapLibre's default, which is a hyperlink
    // to maplibre.org: credit as text, never an outbound link (rule 6).
    // The logo control is opt-in (maplibreLogo) and stays off, so its
    // link never renders either. The egress gate (eval/test_no_egress.py)
    // documents why inert library anchor strings are excluded there.
    attributionControl: { compact: false, customAttribution: "MapLibre" },
  });
}
