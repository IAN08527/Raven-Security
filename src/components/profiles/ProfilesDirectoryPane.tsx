import { CSSProperties, useState, useEffect, useCallback } from "react";
import { useCaseStore } from "../../store/case";

interface LiveEntity {
  id: string;
  name: string;
  type: string;
  risk_score: number;
  centrality: number;
  relationship_count: number;
  identifiers: { type: string; value: string }[];
  aliases: string[];
}

// ── theme tokens ──
const AC = "#e8c15a";
const hexA = (h: string, a: number) => h + Math.round(a * 255).toString(16).padStart(2, "0");
const MONO = "'Spline Sans Mono',monospace";
const mono = (extra?: CSSProperties): CSSProperties => ({ fontFamily: MONO, ...extra });

const th: CSSProperties = mono({
  padding: "0 10px",
  fontSize: 9,
  fontWeight: 500,
  letterSpacing: ".18em",
  color: "#5c6773",
  textAlign: "left",
});

function getRiskLevel(score: number): "HIGH" | "MED" | "LOW" {
  if (score >= 0.65) return "HIGH";
  if (score >= 0.35) return "MED";
  return "LOW";
}

const RISK_C = { HIGH: "#ff5a3c", MED: "#e0a63d", LOW: "#5ecf9a" };

function getPhone(entity: LiveEntity): string {
  return entity.identifiers.find((i) => i.type === "PHONE")?.value || "—";
}
function getVehicle(entity: LiveEntity): string {
  return entity.identifiers.find((i) => i.type === "VEHICLE")?.value || "—";
}
function getAccount(entity: LiveEntity): string {
  return entity.identifiers.find((i) => i.type === "ACCOUNT")?.value || "—";
}

const TYPE_FILTERS = [
  { id: "all", label: "ALL" },
  { id: "PERSON", label: "PERSONS" },
  { id: "ORGANIZATION", label: "ORGANIZATIONS" },
];
const RISK_FILTERS = [
  { id: "all", label: "ALL RISK" },
  { id: "HIGH", label: "HIGH" },
  { id: "MED", label: "MEDIUM" },
  { id: "LOW", label: "LOW" },
];

const ENGINE = "http://127.0.0.1:8756";

export function ProfilesDirectoryPane() {
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [riskFilter, setRiskFilter] = useState("all");
  const [entities, setEntities] = useState<LiveEntity[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState(0);

  const openTab = useCaseStore((s) => s.openTab);
  const caseId = useCaseStore((s) => s.caseId);
  const setIngestModalOpen = useCaseStore((s) => s.setIngestModalOpen);
  const lastIngestTime = useCaseStore((s) => s.lastIngestTime);

  const fetchEntities = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${ENGINE}/graph/entities/${encodeURIComponent(caseId)}`);
      if (!res.ok) throw new Error(`Engine returned ${res.status}`);
      const data: LiveEntity[] = await res.json();
      setEntities(data);
      setLastRefresh(Date.now());
    } catch (e: any) {
      setError(e.message || "Failed to load profiles from engine");
    } finally {
      setLoading(false);
    }
  }, [caseId]);

  // Initial load + re-fetch whenever an ingest completes (bumpIngestTime)
  useEffect(() => {
    fetchEntities();
  }, [fetchEntities, lastIngestTime]);

  // Auto-refresh every 15 seconds to pick up newly ingested data
  useEffect(() => {
    const interval = setInterval(fetchEntities, 15_000);
    return () => clearInterval(interval);
  }, [fetchEntities]);

  const filtered = entities.filter((e) => {
    const q = search.toLowerCase();
    const matchesSearch =
      !q ||
      e.name.toLowerCase().includes(q) ||
      e.aliases.some((a) => a.toLowerCase().includes(q)) ||
      e.identifiers.some((i) => i.value.toLowerCase().includes(q));
    const matchesType = typeFilter === "all" || e.type === typeFilter;
    const matchesRisk = riskFilter === "all" || getRiskLevel(e.risk_score) === riskFilter;
    return matchesSearch && matchesType && matchesRisk;
  });

  const handleOpenProfile = (e: LiveEntity) => {
    openTab({
      id: `profile-${e.id}`,
      type: "profile",
      title: `Profile: ${e.name}`,
      data: {
        entityId: e.id,
        entityName: e.name,
        role: e.type === "ORGANIZATION" ? "Shell Organization" : "Suspect",
        riskScore: e.risk_score,
      },
    });
  };

  const segBtn = (active: boolean): CSSProperties =>
    mono({
      height: 30,
      padding: "0 12px",
      background: active ? hexA(AC, 0.12) : "transparent",
      color: active ? AC : "#5c6773",
      border: "none",
      borderRight: "1px solid #1b212b",
      fontSize: 10,
      letterSpacing: ".1em",
      cursor: "pointer",
      whiteSpace: "nowrap",
    });

  const timeSince = lastRefresh
    ? Math.round((Date.now() - lastRefresh) / 1000) + "s ago"
    : "—";

  return (
    <div
      style={{
        display: "flex",
        height: "100%",
        flexDirection: "column",
        overflow: "hidden",
        background: "#060809",
        color: "#e8edf2",
        fontFamily: "'Instrument Sans',system-ui,sans-serif",
        fontSize: 13,
      }}
    >
      {/* ─── Header ─── */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "12px 24px",
          borderBottom: "1px solid #1b212b",
          flexWrap: "wrap",
        }}
      >
        {/* Search */}
        <div style={{ position: "relative", width: 280 }}>
          <span style={{ position: "absolute", left: 10, top: 9, color: "#5c6773", ...mono({ fontSize: 11 }) }}>⌕</span>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="name · alias · phone · account"
            style={{
              height: 32,
              width: "100%",
              background: "#0b0e12",
              border: "1px solid #1b212b",
              padding: "0 12px 0 28px",
              fontSize: 12,
              ...mono(),
              color: "#e8edf2",
              outline: "none",
              boxSizing: "border-box",
              letterSpacing: ".02em",
            }}
            onFocus={(e) => (e.currentTarget.style.borderColor = hexA(AC, 0.35))}
            onBlur={(e) => (e.currentTarget.style.borderColor = "#1b212b")}
          />
        </div>

        {/* Type filter */}
        <div style={{ display: "flex", alignItems: "center", border: "1px solid #1b212b" }}>
          {TYPE_FILTERS.map((f) => (
            <button key={f.id} onClick={() => setTypeFilter(f.id)} style={segBtn(typeFilter === f.id)}>
              {f.label}
            </button>
          ))}
        </div>

        {/* Risk filter */}
        <div style={{ display: "flex", alignItems: "center", border: "1px solid #1b212b" }}>
          {RISK_FILTERS.map((f) => (
            <button key={f.id} onClick={() => setRiskFilter(f.id)} style={segBtn(riskFilter === f.id)}>
              {f.label}
            </button>
          ))}
        </div>

        {/* Stats */}
        <span style={mono({ fontSize: 10, letterSpacing: ".1em", color: "#5c6773" })}>
          {loading ? "Loading…" : `${filtered.length}/${entities.length} SUBJECTS`}
        </span>

        {/* Refresh button */}
        <button
          onClick={fetchEntities}
          disabled={loading}
          style={mono({
            height: 30,
            padding: "0 12px",
            background: "transparent",
            border: "1px solid #1b212b",
            color: loading ? "#5c6773" : "#98a4b3",
            fontSize: 10,
            letterSpacing: ".1em",
            cursor: loading ? "default" : "pointer",
            display: "flex",
            alignItems: "center",
            gap: 6,
          })}
          title={`Last refreshed: ${timeSince}`}
        >
          <span style={{ display: "inline-block", animation: loading ? "spin 1s linear infinite" : "none" }}>⟳</span>
          {loading ? "LOADING" : "REFRESH"}
        </button>

        {/* Ingest new data */}
        <button
          onClick={() => setIngestModalOpen(true)}
          style={mono({
            marginLeft: "auto",
            height: 32,
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "0 16px",
            background: hexA(AC, 0.1),
            border: `1px solid ${hexA(AC, 0.35)}`,
            color: AC,
            fontSize: 11,
            fontWeight: 600,
            letterSpacing: ".12em",
            cursor: "pointer",
          })}
        >
          + INGEST DATA
        </button>
      </div>

      {/* ─── Error banner ─── */}
      {error && (
        <div
          style={{
            padding: "10px 24px",
            background: "#1a0808",
            borderBottom: "1px solid #3a1515",
            color: "#ff7070",
            fontSize: 12,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <span>⚠ Engine unreachable: {error}</span>
          <button
            onClick={fetchEntities}
            style={{ background: "none", border: "none", color: AC, cursor: "pointer", fontSize: 11 }}
          >
            RETRY
          </button>
        </div>
      )}

      {/* ─── Loading skeleton ─── */}
      {loading && entities.length === 0 && (
        <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12 }}>
          <div style={{ width: 32, height: 32, border: `2px solid ${AC}`, borderTopColor: "transparent", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
          <span style={mono({ fontSize: 11, color: "#5c6773", letterSpacing: ".14em" })}>FETCHING PROFILES FROM DATABASE…</span>
        </div>
      )}

      {/* ─── Empty state ─── */}
      {!loading && entities.length === 0 && !error && (
        <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 16 }}>
          <div style={{ fontSize: 40 }}>📂</div>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 15, fontWeight: 600, color: "#e8edf2", marginBottom: 6 }}>No Profiles Found</div>
            <div style={mono({ fontSize: 11, color: "#5c6773", letterSpacing: ".06em" })}>
              Upload an FIR or document to automatically populate suspect profiles
            </div>
          </div>
          <button
            onClick={() => setIngestModalOpen(true)}
            style={mono({
              height: 36,
              padding: "0 20px",
              background: hexA(AC, 0.12),
              border: `1px solid ${hexA(AC, 0.4)}`,
              color: AC,
              fontSize: 12,
              letterSpacing: ".1em",
              cursor: "pointer",
              fontWeight: 600,
            })}
          >
            + INGEST FIR / DOCUMENT
          </button>
        </div>
      )}

      {/* ─── Profiles Table ─── */}
      {entities.length > 0 && (
        <div style={{ flex: 1, overflowY: "auto", padding: "0 24px 24px" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left" }}>
            <thead>
              <tr style={{ height: 36, borderBottom: "1px solid #232b37" }}>
                <th style={{ ...th, width: 34 }}>##</th>
                <th style={th}>SUBJECT</th>
                <th style={th}>TYPE</th>
                <th style={th}>ALIASES</th>
                <th style={th}>PHONE</th>
                <th style={th}>VEHICLE / ACCOUNT</th>
                <th style={th}>LINKS</th>
                <th style={{ ...th, width: 160 }}>RISK INDEX</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((p, i) => {
                const rl = getRiskLevel(p.risk_score);
                const rc = RISK_C[rl];
                const filledBars = Math.round(p.risk_score * 10);
                const phone = getPhone(p);
                const vehicle = getVehicle(p);
                const account = getAccount(p);
                const identLabel = vehicle !== "—" ? vehicle : account;

                return (
                  <tr
                    key={p.id}
                    onDoubleClick={() => handleOpenProfile(p)}
                    onClick={() => handleOpenProfile(p)}
                    style={{ height: 44, borderBottom: "1px solid #12161d", cursor: "pointer", transition: "background 0.1s" }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = "#0b0e12")}
                    onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                  >
                    {/* Row number */}
                    <td style={mono({ padding: "0 10px", fontSize: 10, color: "#5c6773" })}>
                      {String(i + 1).padStart(2, "0")}
                    </td>

                    {/* Name */}
                    <td style={{ padding: "0 10px" }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: "#e8edf2" }}>{p.name}</div>
                    </td>

                    {/* Type badge */}
                    <td style={{ padding: "0 10px" }}>
                      <span
                        style={mono({
                          display: "inline-block",
                          fontSize: 9,
                          letterSpacing: ".1em",
                          padding: "2px 6px",
                          background: p.type === "PERSON" ? hexA("#4a9eff", 0.12) : hexA("#a855f7", 0.12),
                          color: p.type === "PERSON" ? "#4a9eff" : "#a855f7",
                          border: `1px solid ${p.type === "PERSON" ? hexA("#4a9eff", 0.3) : hexA("#a855f7", 0.3)}`,
                        })}
                      >
                        {p.type}
                      </span>
                    </td>

                    {/* Aliases */}
                    <td style={mono({ padding: "0 10px", fontSize: 10, color: "#98a4b3" })}>
                      {p.aliases.length > 0 ? `"${p.aliases[0]}"` : "—"}
                    </td>

                    {/* Phone */}
                    <td style={mono({ padding: "0 10px", fontSize: 10, color: "#5c6773" })}>
                      {phone}
                    </td>

                    {/* Vehicle / Account */}
                    <td style={mono({ padding: "0 10px", fontSize: 10, color: "#5c6773" })}>
                      {identLabel}
                    </td>

                    {/* Relationship count */}
                    <td style={{ padding: "0 10px" }}>
                      <span
                        style={mono({
                          fontSize: 10,
                          color: p.relationship_count > 0 ? "#e8c15a" : "#5c6773",
                          fontWeight: p.relationship_count > 5 ? 700 : 400,
                        })}
                      >
                        {p.relationship_count} links
                      </span>
                    </td>

                    {/* Risk bar */}
                    <td style={{ padding: "0 10px" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <div style={{ display: "flex", gap: 2, flex: 1, maxWidth: 80 }}>
                          {Array.from({ length: 10 }, (_, k) => (
                            <span key={k} style={{ height: 10, flex: 1, background: k < filledBars ? rc : "#161c25" }} />
                          ))}
                        </div>
                        <span style={mono({ fontSize: 10, fontWeight: 600, color: rc, minWidth: 28 })}>
                          {p.risk_score > 0 ? p.risk_score.toFixed(2) : rl}
                        </span>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {filtered.length === 0 && !loading && (
            <div style={{ padding: "32px 0", textAlign: "center", color: "#5c6773", ...mono({ fontSize: 11, letterSpacing: ".1em" }) }}>
              NO SUBJECTS MATCH CURRENT FILTERS
            </div>
          )}

          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              paddingTop: 14,
              ...mono({ fontSize: 9 }),
              letterSpacing: ".12em",
              color: "#5c6773",
            }}
          >
            <span>CLICK ROW → OPEN DOSSIER · LIVE DATA FROM SUPABASE</span>
            <span>
              {filtered.length} / {entities.length} RECORDS · REFRESHED {timeSince}
            </span>
          </div>
        </div>
      )}

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
