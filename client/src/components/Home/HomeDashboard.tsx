import { useEffect, useRef, useState } from "react";
import { fetchAuditRows, type AuditRow } from "../../lib/audit";
import { countUp, relativeTime, weekDelta } from "../../lib/format";
import { fetchCameras, fetchHealth, fetchNodes, onlineCameraCodes } from "../../lib/health";

// Home dashboard (screen 02, design §7). Six stat tiles, operational map,
// recent activity, active cases, camera status, key locations.
//
// Wired to real data, never mock: tiles with a backing endpoint show live
// counts; tiles without a listing API yet (cases, entities, files,
// review queue, candidates) show an em-dash with a "no listing API yet"
// caption instead of an invented number (rule 10). Deltas are computed
// client-side from created_at/last_seen and hidden where the API carries
// no timestamps — never hardcoded.
//
// Transitions (§25 + task): stat count-up 400ms first load only, panel
// hover 120ms elevation, navigation via the 180ms View Transition in App.

interface Tile {
  label: string;
  value: string;
  delta: string | null;
  tone: "plain" | "amber" | "red";
  caption?: string;
}

function StatTile({ tile, animate }: { tile: Tile; animate: boolean }): JSX.Element {
  const [shown, setShown] = useState(animate ? "0" : tile.value);
  const numeric = /^\d[\d,]*$/.test(tile.value);
  useEffect(() => {
    if (!animate || !numeric) {
      setShown(tile.value);
      return undefined;
    }
    const target = Number(tile.value.replace(/,/g, ""));
    return countUp(target, 400, (value) => setShown(value.toLocaleString("en-US")));
  }, [animate, numeric, tile.value]);
  return (
    <div className="border border-neutral-800 bg-neutral-900 px-3 py-2 transition-shadow duration-[120ms] hover:shadow-[0_0_0_1px_#3a3a37]">
      <div className="text-[11px] uppercase tracking-wide text-neutral-400">{tile.label}</div>
      <div className="text-2xl font-semibold text-neutral-50">{shown}</div>
      {tile.delta ? <div className="text-xs text-neutral-400">{tile.delta}</div> : null}
      {tile.caption ? <div className="text-[11px] text-neutral-500">{tile.caption}</div> : null}
    </div>
  );
}

function actionLabel(action: string): string {
  return action.replace(/\./g, " · ");
}

export function HomeDashboard({ onNavigate }: { onNavigate: (id: string) => void }): JSX.Element {
  const [tiles, setTiles] = useState<Tile[]>([]);
  const [cameras, setCameras] = useState<{ code: string; label: string; online: boolean }[]>([]);
  const [healthNote, setHealthNote] = useState("Loading system status…");
  const [caseId, setCaseId] = useState("");
  const [activity, setActivity] = useState<AuditRow[]>([]);
  const [activityNote, setActivityNote] = useState<string | null>(null);
  const [basemapMissing, setBasemapMissing] = useState(true);
  const [nodeLine, setNodeLine] = useState("No engine nodes seen yet.");
  const animatedOnce = useRef(false);

  useEffect(() => {
    let cancelled = false;
    async function load(): Promise<void> {
      try {
        const [health, nodes, serverCameras] = await Promise.all([
          fetchHealth(),
          fetchNodes(),
          fetchCameras(),
        ]);
        if (cancelled) return;
        const online = onlineCameraCodes(nodes);
        const cameraRows = serverCameras.map((camera) => ({
          code: camera.code,
          label: camera.label,
          online: online.has(camera.code),
        }));
        setCameras(cameraRows);
        const offline = cameraRows.filter((row) => !row.online).length;
        const nodeDelta = weekDelta(nodes.map((node) => ({ last_seen: node.last_seen })));
        setNodeLine(
          nodes.length === 0
            ? "No engine nodes registered."
            : `${nodes.length} node(s), ${nodeDelta.newThisWeek} seen this week.`,
        );
        const deps = health.dependencies ?? [];
        const down = deps.filter((dep) => !dep.healthy);
        setHealthNote(
          down.length === 0
            ? `All ${deps.length} dependencies healthy.`
            : `${down.length} dependency check(s) failing: ${down.map((dep) => dep.name).join(", ")}.`,
        );
        setTiles([
          { label: "Active Cases", value: "—", delta: null, tone: "plain", caption: "No listing API yet." },
          { label: "Persons of Interest", value: "—", delta: null, tone: "plain", caption: "No listing API yet." },
          { label: "Documents Ingested", value: "—", delta: null, tone: "plain", caption: "No listing API yet." },
          {
            label: "Cameras Online",
            value: String(cameraRows.filter((row) => row.online).length),
            delta: null,
            tone: offline > 0 ? "amber" : "plain",
            caption: offline > 0 ? `${offline} offline` : `${cameraRows.length} registered`,
          },
          { label: "Pending Reviews", value: "—", delta: null, tone: "plain", caption: "Select a case in Ingestion." },
          { label: "Alerts", value: "—", delta: null, tone: "plain", caption: "No listing API yet." },
        ]);
      } catch {
        if (!cancelled) {
          setHealthNote("System status unreachable.");
          setTiles([]);
        }
      }
    }
    void load();
    animatedOnce.current = true;
    return () => {
      cancelled = true;
    };
  }, []);

  // Recent activity: last 10 audit rows for the entered case, refreshed
  // every 30s. The §2.9 socket is pending server-side, so this polls on
  // the specified cadence rather than pretending a socket is connected.
  useEffect(() => {
    if (!caseId) {
      setActivity([]);
      setActivityNote(null);
      return;
    }
    let cancelled = false;
    async function poll(): Promise<void> {
      try {
        const rows = await fetchAuditRows(caseId, {});
        if (!cancelled) {
          setActivity(rows.slice(-10).reverse());
          setActivityNote(null);
        }
      } catch (err) {
        if (!cancelled) {
          setActivityNote(err instanceof Error ? err.message : "Activity unavailable.");
        }
      }
    }
    void poll();
    const timer = setInterval(() => void poll(), 30000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [caseId]);

  useEffect(() => {
    const env = (import.meta as unknown as { env?: Record<string, string> }).env;
    setBasemapMissing(!env?.VITE_BASEMAP_URL);
  }, []);

  const firstLoad = !animatedOnce.current;

  return (
    <div className="flex flex-col gap-4 p-6">
      <header className="flex items-baseline justify-between">
        <div>
          <h1 className="text-2xl text-neutral-50">Operational situation</h1>
          <p className="text-sm text-neutral-400">Live counts where an API exists; gaps labelled, never filled.</p>
        </div>
        <span className="text-xs text-neutral-500">{healthNote}</span>
      </header>

      <section aria-label="Key metrics" className="grid grid-cols-2 gap-2 lg:grid-cols-6">
        {tiles.map((tile) => (
          <StatTile key={tile.label} tile={tile} animate={firstLoad} />
        ))}
      </section>

      <section className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="border border-neutral-800 bg-neutral-900 p-3 transition-shadow duration-[120ms] hover:shadow-[0_0_0_1px_#3a3a37]">
          <h2 className="text-sm font-semibold text-neutral-100">Operational Map</h2>
          {basemapMissing ? (
            <p className="mt-2 text-xs text-neutral-400">
              Local PMTiles extract not provisioned (D6). No third-party tiles are requested.
            </p>
          ) : (
            <p className="mt-2 text-xs text-neutral-400">Local basemap configured; markers need camera coordinates (M1-T1 API carries none yet).</p>
          )}
          <p className="mt-1 text-[11px] text-neutral-500">
            Camera markers, case pins and last-known locations appear here once coordinates exist.
          </p>
        </div>

        <div className="border border-neutral-800 bg-neutral-900 p-3 transition-shadow duration-[120ms] hover:shadow-[0_0_0_1px_#3a3a37]">
          <h2 className="text-sm font-semibold text-neutral-100">Recent Activity</h2>
          <label className="mt-2 flex flex-col gap-1 text-xs text-neutral-400">
            Case id
            <input
              aria-label="Activity case id"
              className="border border-neutral-700 bg-neutral-950 px-2 py-1 text-neutral-100"
              placeholder="00000000-0000-0000-0000-000000000000"
              value={caseId}
              onChange={(event) => setCaseId(event.target.value.trim())}
            />
          </label>
          {activityNote ? (
            <p role="alert" className="mt-2 text-xs text-red-400">{activityNote}</p>
          ) : null}
          {!caseId ? (
            <p className="mt-2 text-xs text-neutral-500">Enter a case id to stream its last 10 audit rows (30s refresh).</p>
          ) : (
            <ul className="mt-2 flex flex-col gap-1">
              {activity.map((row) => (
                <li key={row.id} className="flex items-baseline justify-between gap-2 text-xs">
                  <span className="text-neutral-200">{actionLabel(row.action)}</span>
                  <span className="shrink-0 text-neutral-500">{relativeTime(row.created_at)}</span>
                </li>
              ))}
              {activity.length === 0 && !activityNote ? (
                <li className="text-xs text-neutral-500">No activity rows for this case.</li>
              ) : null}
            </ul>
          )}
        </div>

        <div className="flex flex-col gap-4">
          <div className="border border-neutral-800 bg-neutral-900 p-3 transition-shadow duration-[120ms] hover:shadow-[0_0_0_1px_#3a3a37]">
            <h2 className="text-sm font-semibold text-neutral-100">Active Cases</h2>
            <p className="mt-2 text-xs text-neutral-500">Top 5 by last update — needs a cases listing API.</p>
            <button type="button" onClick={() => onNavigate("cases")} className="mt-2 border border-neutral-700 px-2 py-1 text-xs text-neutral-200">
              Open Cases
            </button>
          </div>
          <div className="border border-neutral-800 bg-neutral-900 p-3 transition-shadow duration-[120ms] hover:shadow-[0_0_0_1px_#3a3a37]">
            <h2 className="text-sm font-semibold text-neutral-100">Camera Status</h2>
            <p className="mt-1 text-[11px] text-neutral-500">{nodeLine}</p>
            <ul className="mt-2 flex flex-col gap-1">
              {cameras.slice(0, 5).map((camera) => (
                <li key={camera.code} className="flex items-center gap-2 text-xs">
                  <span
                    aria-label={camera.online ? "online" : "offline"}
                    className={`inline-block h-2 w-2 rounded-full ${camera.online ? "bg-green-500" : "bg-red-500"}`}
                  />
                  <span className="text-neutral-200">{camera.label || camera.code}</span>
                  <span className="text-neutral-500">{camera.online ? "Online" : "Offline"}</span>
                </li>
              ))}
              {cameras.length === 0 ? <li className="text-xs text-neutral-500">No cameras registered.</li> : null}
            </ul>
            <button type="button" onClick={() => onNavigate("cctv")} className="mt-2 border border-neutral-700 px-2 py-1 text-xs text-neutral-200">
              See all
            </button>
          </div>
          <div className="border border-neutral-800 bg-neutral-900 p-3 transition-shadow duration-[120ms] hover:shadow-[0_0_0_1px_#3a3a37]">
            <h2 className="text-sm font-semibold text-neutral-100">Key Locations</h2>
            <p className="mt-2 text-xs text-neutral-500">Top locations by evidence count — needs a locations API.</p>
          </div>
        </div>
      </section>
    </div>
  );
}
