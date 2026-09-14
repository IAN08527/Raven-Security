import { useEffect, useMemo, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import type { EntityListItem, MovementPoint, RoutineCluster } from "../../types/api";
import { createMap } from "../../lib/map";
import { fetchEntities } from "../../lib/entities";
import { fetchMovementTimeline, fetchRoutine } from "../../lib/movement";

interface MapScreenProps {
  caseId: string;
  onOpenFile?: (fileId: string) => void;
}

// Marker colors by point origin (Part 5 spec; design §3.2 accents).
const ORIGIN_COLOR: Record<string, string> = {
  cdr: "#668DBA",
  fir: "#D89A45",
  address: "#706E68",
  cctv: "#D8665C",
};

export function originColor(origin: string): string {
  return ORIGIN_COLOR[origin.toLowerCase()] ?? "#A5A29A";
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function popupHtml(point: MovementPoint, openFile: boolean): string {
  const anchor = point.declared_start_ts
    ? `Source start (CASE TIME): ${escapeHtml(point.declared_start_ts)}`
    : point.source_file_id
      ? `Source file: ${escapeHtml(point.source_file_id.slice(0, 8))}`
      : "Source anchor: none recorded";
  const accuracy =
    point.accuracy_m !== null && point.accuracy_m !== undefined ? ` · ±${point.accuracy_m}m` : "";
  const fileButton =
    openFile && point.source_file_id
      ? `<br/><button data-open-file="${escapeHtml(point.source_file_id)}">Open source file</button>`
      : "";
  return (
    `<div><strong>CASE TIME: ${escapeHtml(point.ts)}</strong><br/>` +
    `Origin: ${escapeHtml(point.origin)}${accuracy}<br/>${anchor}${fileButton}</div>`
  );
}

/**
 * Screen 10. Map and Movement (design §15, FR-6, API_CONTRACTS.md §2.7).
 * Local basemap, location markers colored by origin, chronological path
 * line, time-range strip, routine clusters. Every timestamp on screen is
 * case-clock labelled CASE TIME (D16); the tooltip's source-anchor line
 * is the camera's declared_start_ts where the model holds one and the
 * source file otherwise — never an invented anchor, never system time.
 * ODbL attribution rides the map control and is always visible.
 */
export function MapScreen({ caseId, onOpenFile }: MapScreenProps): JSX.Element {
  const mapHostRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markersRef = useRef<maplibregl.Marker[]>([]);
  const [personSearch, setPersonSearch] = useState("");
  const [persons, setPersons] = useState<EntityListItem[]>([]);
  const [entityId, setEntityId] = useState<string | null>(null);
  const [entityName, setEntityName] = useState("");
  const [points, setPoints] = useState<MovementPoint[]>([]);
  const [pointsError, setPointsError] = useState<string | null>(null);
  const [clusters, setClusters] = useState<RoutineCluster[]>([]);
  const [totalPoints, setTotalPoints] = useState(0);
  const [routineError, setRoutineError] = useState<string | null>(null);
  const [range, setRange] = useState<[number, number] | null>(null);
  const [selecting, setSelecting] = useState<[number, number] | null>(null);
  const stripRef = useRef<HTMLDivElement>(null);
  const runRef = useRef(0);
  // Latest file opener for the delegated popup-button listener below.
  const openFileRef = useRef(onOpenFile);
  openFileRef.current = onOpenFile;

  // Map instance: created once, destroyed on unmount. The PMTiles
  // protocol is registered at app startup (main.tsx), not here. Popup
  // file buttons are handled by one delegated listener on the host:
  // popups come and go, the host does not.
  useEffect(() => {
    if (!mapHostRef.current || mapRef.current) return;
    try {
      mapRef.current = createMap(mapHostRef.current);
    } catch {
      mapRef.current = null;
    }
    const host = mapHostRef.current;
    function onHostClick(event: MouseEvent): void {
      const target = event.target as HTMLElement | null;
      const button = target?.closest?.("[data-open-file]") as HTMLElement | null;
      const fileId = button?.dataset.openFile;
      if (fileId) openFileRef.current?.(fileId);
    }
    host.addEventListener("click", onHostClick);
    return () => {
      host.removeEventListener("click", onHostClick);
      for (const marker of markersRef.current) marker.remove();
      markersRef.current = [];
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, []);

  // Person list (server-side search, debounced like Global Search).
  useEffect(() => {
    const runId = ++runRef.current;
    const timer = setTimeout(() => {
      fetchEntities(caseId, { type: "PERSON", search: personSearch.trim() || undefined, limit: 50 })
        .then((page) => {
          if (runId === runRef.current) setPersons(page.results);
        })
        .catch(() => {
          if (runId === runRef.current) setPersons([]);
        });
    }, 200);
    return () => clearTimeout(timer);
  }, [caseId, personSearch]);

  // Movement data for the selected entity.
  useEffect(() => {
    if (!entityId) return;
    const runId = ++runRef.current;
    setPointsError(null);
    setRoutineError(null);
    setRange(null);
    fetchMovementTimeline(entityId, {})
      .then((page) => {
        if (runId !== runRef.current) return;
        setPoints(page.results);
      })
      .catch((err: unknown) => {
        if (runId === runRef.current) {
          setPoints([]);
          setPointsError(err instanceof Error ? err.message : "Movement unavailable.");
        }
      });
    fetchRoutine(entityId)
      .then((routine) => {
        if (runId !== runRef.current) return;
        setClusters(routine.clusters);
        setTotalPoints(routine.total_points);
      })
      .catch((err: unknown) => {
        if (runId === runRef.current) {
          setClusters([]);
          setRoutineError(err instanceof Error ? err.message : "Routine unavailable.");
        }
      });
  }, [entityId]);

  // Markers + path for the in-range points, memoized so unrelated
  // re-renders do not rebuild markers and reset the camera.
  const visible = useMemo(() => {
    if (!range || points.length === 0) return points;
    return points.slice(Math.max(0, range[0]), Math.min(points.length, range[1] + 1));
  }, [points, range]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    for (const marker of markersRef.current) marker.remove();
    markersRef.current = [];
    if (visible.length === 0) return;
    const bounds = new maplibregl.LngLatBounds();
    for (const point of visible) {
      const popup = new maplibregl.Popup({ offset: 12 }).setHTML(popupHtml(point, Boolean(onOpenFile)));
      const marker = new maplibregl.Marker({ color: originColor(point.origin) })
        .setLngLat([point.lon, point.lat])
        .setPopup(popup);
      marker.addTo(map);
      markersRef.current.push(marker);
      bounds.extend([point.lon, point.lat]);
    }
    const draw = (): void => {
      if (!map.getSource("movement-path")) {
        map.addSource("movement-path", {
          type: "geojson",
          data: { type: "FeatureCollection", features: [] },
        });
        map.addLayer({
          id: "movement-path",
          type: "line",
          source: "movement-path",
          paint: { "line-color": "#A5A29A", "line-width": 2 },
        });
      }
      const source = map.getSource("movement-path") as maplibregl.GeoJSONSource | undefined;
      source?.setData({
        type: "Feature",
        properties: {},
        geometry: { type: "LineString", coordinates: visible.map((p) => [p.lon, p.lat]) },
      });
    };
    if (map.loaded()) {
      draw();
    } else {
      map.once("load", draw);
    }
    if (visible.length === 1) {
      map.setCenter([visible[0].lon, visible[0].lat]);
      map.setZoom(12);
    } else if (visible.length > 1) {
      map.fitBounds(bounds, { padding: 40 });
    }
  }, [visible, onOpenFile]);

  function stripIndex(clientX: number): number {
    const strip = stripRef.current;
    if (!strip || points.length === 0) return 0;
    const rect = strip.getBoundingClientRect();
    const fraction = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    return Math.min(points.length - 1, Math.floor(fraction * points.length));
  }

  const times = points.map((point) => Date.parse(point.ts));
  const minTime = times.length > 0 ? Math.min(...times) : 0;
  const maxTime = times.length > 0 ? Math.max(...times) : 1;
  const positionOf = (index: number): number =>
    points.length <= 1 ? 0 : (times[index] - minTime) / ((maxTime - minTime) || 1);

  return (
    <div className="flex h-full w-full flex-col gap-4 p-6">
      <header>
        <h1 className="text-2xl text-neutral-50">Map &amp; Movement</h1>
        <p className="text-sm text-neutral-400">
          Confirmed location history on the local basemap. All timestamps are case-clock (CASE
          TIME).
        </p>
      </header>
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 lg:grid-cols-4">
        <div className="flex min-h-0 flex-col gap-2 rounded-sm border border-neutral-800 bg-neutral-900 p-3">
          <h2 className="text-sm font-semibold text-neutral-100">Person</h2>
          <input
            aria-label="Search people"
            type="search"
            value={personSearch}
            onChange={(event) => setPersonSearch(event.target.value)}
            placeholder="Search people…"
            className="border border-neutral-700 bg-neutral-950 px-2 py-1 text-sm text-neutral-100"
          />
          {persons.length === 0 ? (
            <p className="text-xs text-neutral-500">No people found in this case.</p>
          ) : (
            <ul className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto">
              {persons.map((person) => (
                <li key={person.id}>
                  <button
                    type="button"
                    onClick={() => {
                      setEntityId(person.id);
                      setEntityName(person.canonical_name);
                    }}
                    className={`block w-full rounded-sm px-2 py-1 text-left text-xs ${
                      person.id === entityId
                        ? "bg-neutral-800 text-neutral-50"
                        : "text-neutral-300 hover:bg-neutral-800"
                    }`}
                  >
                    {person.canonical_name}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="flex min-h-0 flex-col gap-2 lg:col-span-2">
          <div ref={mapHostRef} aria-label="Movement map" className="min-h-80 flex-1" />
          <div className="rounded-sm border border-neutral-800 bg-neutral-900 p-3">
            <div className="mb-1 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-neutral-100">Timeline</h2>
              {range && (
                <button
                  type="button"
                  onClick={() => setRange(null)}
                  className="text-xs text-neutral-400 hover:text-neutral-200"
                >
                  Reset range
                </button>
              )}
            </div>
            {points.length === 0 ? (
              <p className="text-xs text-neutral-500">
                {entityId ? "No location points for this person." : "Select a person to load movement."}
              </p>
            ) : (
              <div
                ref={stripRef}
                role="group"
                aria-label="Time range filter: drag to filter the map"
                className="relative h-12 cursor-crosshair select-none rounded-sm bg-neutral-950"
                onPointerDown={(event) => {
                  (event.target as HTMLElement).setPointerCapture?.(event.pointerId);
                  const index = stripIndex(event.clientX);
                  setSelecting([index, index]);
                }}
                onPointerMove={(event) => {
                  setSelecting((current) =>
                    current ? [current[0], stripIndex(event.clientX)] : current,
                  );
                }}
                onPointerUp={() => {
                  setSelecting((current) => {
                    if (current) {
                      const [a, b] = current;
                      setRange([Math.min(a, b), Math.max(a, b)]);
                    }
                    return null;
                  });
                }}
              >
                {range && (
                  <div
                    className="absolute top-0 h-full bg-neutral-700/40"
                    style={{
                      left: `${positionOf(Math.min(range[0], range[1])) * 100}%`,
                      width: `${Math.abs(positionOf(range[1]) - positionOf(range[0])) * 100}%`,
                    }}
                  />
                )}
                {points.map((point, index) => (
                  <span
                    key={`${point.ts}:${index}`}
                    title={`${point.ts} · ${point.origin}`}
                    className="absolute top-1/2 h-3 w-1 -translate-y-1/2 rounded-full"
                    style={{
                      left: `${positionOf(index) * 100}%`,
                      backgroundColor: originColor(point.origin),
                    }}
                  />
                ))}
              </div>
            )}
            <p className="mt-1 text-[11px] text-neutral-500">
              Drag across the strip to filter the map to a time range. Red marks are camera
              sightings.
            </p>
            {selecting && (
              <p className="text-[11px] text-neutral-400">
                Selecting points {Math.min(...selecting)} to {Math.max(...selecting)}…
              </p>
            )}
          </div>
        </div>

        <div className="flex min-h-0 flex-col gap-2 overflow-y-auto rounded-sm border border-neutral-800 bg-neutral-900 p-3">
          <h2 className="text-sm font-semibold text-neutral-100">
            Routine{entityName ? ` — ${entityName}` : ""}
          </h2>
          {routineError ? (
            <p role="alert" className="text-xs text-red-400">
              Routine unavailable: {routineError}
            </p>
          ) : !entityId ? (
            <p className="text-xs text-neutral-500">Select a person to analyse routine.</p>
          ) : clusters.length === 0 ? (
            <p className="text-xs text-neutral-500">
              {totalPoints === 0
                ? "No location points to cluster."
                : "No clusters formed from these points."}
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {clusters.map((cluster) => (
                <li
                  key={`${cluster.lat}:${cluster.lon}`}
                  className="rounded-sm border border-neutral-800 bg-neutral-950 p-2"
                >
                  <p className="text-xs font-semibold text-neutral-100">{cluster.area}</p>
                  <p className="mt-0.5 text-xs text-neutral-400">
                    {cluster.confidence_pct}% confidence · {cluster.visit_count} visit
                    {cluster.visit_count === 1 ? "" : "s"}
                  </p>
                  {cluster.low_data && (
                    <span className="mt-1 inline-block rounded-sm border border-[#C9A653] px-1.5 py-0.5 text-[11px] font-semibold text-[#C9A653]">
                      Low data
                    </span>
                  )}
                  {cluster.typical_window && (
                    <p className="mt-1 text-xs text-neutral-300">
                      Typically present {cluster.typical_window}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}
          {pointsError && (
            <p role="alert" className="text-xs text-red-400">
              Movement unavailable: {pointsError}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
