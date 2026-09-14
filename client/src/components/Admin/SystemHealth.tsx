import { useEffect, useState } from "react";
import { fetchHealth, fetchNodes, type DependencyStatus, type EngineNode } from "../../lib/health";

interface BasemapState {
  status: "healthy" | "degraded" | "unconfigured";
  detail: string;
}

function defaultBasemapUrl(): string | null {
  const env = (import.meta as unknown as { env?: Record<string, string> }).env;
  return env?.VITE_BASEMAP_URL ?? null;
}

async function probeBasemap(url: string | null): Promise<BasemapState> {
  if (!url) {
    return { status: "unconfigured", detail: "VITE_BASEMAP_URL is not set" };
  }
  try {
    const response = await fetch(url, { method: "HEAD" });
    return response.ok
      ? { status: "healthy", detail: url }
      : { status: "degraded", detail: `${url} answered ${response.status}` };
  } catch (err) {
    return {
      status: "degraded",
      detail: err instanceof Error ? err.message : "basemap unreachable",
    };
  }
}

/**
 * Screen 16. System Health (FR-8.3). One card per dependency from GET
 * /health, engine-node cards from GET /nodes, plus a client-side probe
 * of the basemap file server (loopback only). Status changes render
 * instantly — no transition on health updates (an animation on a DOWN
 * change would be inappropriate). "Checked at" and response time are
 * client-measured and labelled as such: the server reports status and
 * detail only. Node registration reports budget, GPU and cameras only;
 * VRAM ceilings and per-camera FPS are not exposed by GET /nodes, so
 * they are absent here rather than filled in.
 */
export function SystemHealth({ basemapUrl }: { basemapUrl?: string | null }): JSX.Element {
  const [deps, setDeps] = useState<DependencyStatus[]>([]);
  const [nodes, setNodes] = useState<EngineNode[]>([]);
  const [basemap, setBasemap] = useState<BasemapState | null>(null);
  const [checkedAt, setCheckedAt] = useState<string | null>(null);
  const [roundTripMs, setRoundTripMs] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Explicit prop for tests; production reads the env default. Passing
  // null renders the unconfigured state without a probe.
  const probeUrl = basemapUrl === undefined ? defaultBasemapUrl() : basemapUrl;

  useEffect(() => {
    let cancelled = false;
    async function refresh(): Promise<void> {
      const started = performance.now();
      try {
        const [report, nodeRows, basemapState] = await Promise.all([
          fetchHealth(),
          fetchNodes(),
          probeBasemap(probeUrl),
        ]);
        if (cancelled) return;
        setDeps(report.dependencies ?? []);
        setNodes(nodeRows);
        setBasemap(basemapState);
        setCheckedAt(new Date().toISOString());
        setRoundTripMs(Math.round(performance.now() - started));
        setError(null);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Health unavailable.");
      }
    }
    void refresh();
    const timer = setInterval(() => void refresh(), 10_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  function dot(healthy: boolean): JSX.Element {
    return (
      <span
        aria-label={healthy ? "healthy" : "down"}
        className={`inline-block h-2 w-2 rounded-full ${healthy ? "bg-green-500" : "bg-red-500"}`}
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-baseline gap-3 text-xs text-neutral-500">
        {checkedAt && <span>Checked at {checkedAt} (client clock).</span>}
        {roundTripMs !== null && <span>Health fetch took {roundTripMs} ms (client-measured).</span>}
      </div>
      {error && (
        <p role="alert" className="text-xs text-red-400">
          {error}
        </p>
      )}
      <section>
        <h3 className="mb-2 text-sm font-semibold text-neutral-100">Dependencies</h3>
        {deps.length === 0 && !error ? (
          <p className="text-xs text-neutral-500">No dependency rows reported.</p>
        ) : (
          <ul className="grid grid-cols-1 gap-2 md:grid-cols-2">
            {deps.map((dep) => (
              <li
                key={dep.name}
                className="rounded-sm border border-neutral-800 bg-neutral-900 p-3 text-xs"
              >
                <p className="flex items-center gap-2 text-neutral-100">
                  {dot(dep.healthy)}
                  <span className="font-semibold">{dep.name}</span>
                </p>
                <p className="mt-1 text-neutral-400">{dep.detail || "No detail reported."}</p>
              </li>
            ))}
            {basemap && (
              <li className="rounded-sm border border-neutral-800 bg-neutral-900 p-3 text-xs">
                <p className="flex items-center gap-2 text-neutral-100">
                  <span
                    aria-label={basemap.status}
                    className={`inline-block h-2 w-2 rounded-full ${
                      basemap.status === "healthy"
                        ? "bg-green-500"
                        : basemap.status === "degraded"
                          ? "bg-red-500"
                          : "bg-neutral-500"
                    }`}
                  />
                  <span className="font-semibold">basemap</span>
                </p>
                <p className="mt-1 text-neutral-400">{basemap.detail}</p>
              </li>
            )}
          </ul>
        )}
      </section>
      <section>
        <h3 className="mb-2 text-sm font-semibold text-neutral-100">Engine nodes</h3>
        {nodes.length === 0 ? (
          <p className="text-xs text-neutral-500">No engine nodes registered.</p>
        ) : (
          <ul className="grid grid-cols-1 gap-2 md:grid-cols-2">
            {nodes.map((node) => (
              <li
                key={node.id}
                className="rounded-sm border border-neutral-800 bg-neutral-900 p-3 text-xs"
              >
                <p className="flex items-center gap-2 text-neutral-100">
                  {dot(node.status === "ready")}
                  <span className="font-semibold">{node.name}</span>
                  <span className="text-neutral-500">{node.status}</span>
                </p>
                <p className="mt-1 font-mono text-neutral-400">
                  budget {node.budget_dps} det/s · {node.gpu_name} · last seen{" "}
                  {node.last_seen || "never"}
                </p>
                <p className="mt-1 text-neutral-400">
                  {node.cameras.length === 0
                    ? "No cameras assigned."
                    : `Cameras: ${node.cameras.join(", ")}`}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
