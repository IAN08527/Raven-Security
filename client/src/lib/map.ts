// Local basemap configuration (D6, FR-6.2, design §15): MapLibre GL JS
// over the locally hosted Maharashtra PMTiles extract. No third-party
// tile requests — the only network origin this module ever contacts is
// VITE_BASEMAP_URL (loopback :8802 in development).
//
// Source-layer names below were read from the extract itself
// (`pmtiles show --metadata infra/tiles/maharashtra.pmtiles`):
// boundaries, buildings, earth, landcover, landuse, places, pois,
// roads, water. Layers carry no data filters, so no field values are
// assumed about the tileset contents. Centre [76.75, 18.82] is the
// archive's own centre, not a chosen constant.
//
// Deliberate gap: no text/symbol layers. Place labels need a glyphs URL
// and there is no offline glyph source provisioned yet; wiring one is a
// follow-up, not a silent external fetch. The map renders muted
// streets, water and landuse on the design-system dark surface (#060809).

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

export function basemapAttribution(): string {
  const env = (import.meta as unknown as { env?: Record<string, string> }).env;
  return env?.VITE_BASEMAP_ATTRIBUTION ?? "© OpenStreetMap contributors";
}

export function darkBasemapStyle(url: string, attribution: string): StyleSpecification {
  return {
    version: 8,
    name: "Raven local basemap (Maharashtra PMTiles)",
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
    ],
  };
}

export function createMap(container: HTMLElement): maplibregl.Map {
  registerPmtilesProtocol();
  return new maplibregl.Map({
    container,
    style: darkBasemapStyle(basemapUrl(), basemapAttribution()),
    center: [76.75, 18.82],
    zoom: 6,
    // ODbL attribution stays expanded and visible, never compacted away.
    attributionControl: { compact: false },
  });
}
