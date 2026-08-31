import { CSSProperties, useEffect, useMemo, useState } from "react";

/**
 * RAVEN Refactor — full-shell UI refactor ported from the Claude Design canvas
 * project "RAVEN Refactor.dc.html". Self-contained visual preview: top command
 * bar + horizontal numbered module nav + canvas dispatcher (Profiles / Network /
 * Optics / Ledger / Sources) + status ticker. Mock data baked in so the team can
 * navigate every module and see the new look. Backend wiring is intentionally
 * out of scope for this preview.
 */

// ── design tokens ──
const AC = "#e8c15a";
const hexA = (h: string, a: number) =>
  h + Math.round(a * 255).toString(16).padStart(2, "0");
const acDim = hexA(AC, 0.1);
const acBorder = hexA(AC, 0.35);

const MONO = "'Spline Sans Mono',monospace";

// ── static data (ported from the design's renderVals) ──
const MODS = [
  { id: "profiles", num: "01", label: "PROFILES", title: "SUBJECT ROSTER" },
  { id: "graph", num: "02", label: "NETWORK", title: "MACRO NETWORK" },
  { id: "cctv", num: "03", label: "OPTICS", title: "CCTV LIVE MONITOR" },
  { id: "logs", num: "04", label: "LEDGER", title: "AUDIT LEDGER" },
  { id: "databases", num: "05", label: "SOURCES", title: "DATA SOURCES" },
] as const;
type Nav = (typeof MODS)[number]["id"];

const ROLE_C: Record<string, string> = {
  leader: "#ff5a3c",
  operator: "#e0a63d",
  logistics: AC,
  other: "#98a4b3",
};
const RISK_C: Record<string, string> = { HIGH: "#ff5a3c", MED: "#e0a63d", LOW: "#5ecf9a" };
const ST_C: Record<string, string> = {
  "ACTIVE SUSPECT": "#ff5a3c",
  "UNDER WATCH": "#e0a63d",
  DETAINED: "#5c6773",
};

type Raw = [string, string, string, string, string, string, number, string, string];
const RAW: Raw[] = [
  ["Rakesh Sawant", "Ricky", "Syndicate Leader", "leader", "XXXX-XXXX-4521", "OP-RAVEN-01 · FIR-102", 0.84, "HIGH", "ACTIVE SUSPECT"],
  ["Vikram Patel", "Vicky", "Hawala Operator", "operator", "XXXX-XXXX-8912", "OP-RAVEN-01", 0.62, "MED", "ACTIVE SUSPECT"],
  ["Mohd. Khan", "Bhai", "Logistics Coordinator", "logistics", "XXXX-XXXX-3341", "OP-RAVEN-01", 0.51, "MED", "UNDER WATCH"],
  ["Sunil Gupta", "Doctor", "Money Mule", "other", "XXXX-XXXX-7729", "OP-RAVEN-01", 0.4, "LOW", "UNDER WATCH"],
  ["Anita Roy", "Madam", "Shell Company Director", "operator", "XXXX-XXXX-1123", "OP-RAVEN-01", 0.35, "LOW", "UNDER WATCH"],
  ["Deepak Kumar", "DK", "Field Associate", "other", "XXXX-XXXX-9980", "OP-RAVEN-01", 0.28, "LOW", "DETAINED"],
];
const RF: [string, string][] = [
  ["ALL", "ALL"],
  ["leader", "LEADER"],
  ["operator", "OPERATOR"],
  ["logistics", "LOGISTICS"],
  ["other", "OTHER"],
];

const TYPE_C: Record<string, string> = {
  PERSON: "#ff5a3c",
  ORGANIZATION: "#e0a63d",
  ACCOUNT: AC,
  LOCATION: "#5ecf9a",
  VEHICLE: "#b18cff",
};
const SIDES: Record<string, number> = { PERSON: 6, ORGANIZATION: 8, ACCOUNT: 6, LOCATION: 4, VEHICLE: 4 };
type Node = [string, string, string, number, number, number, number, number];
const NODES: Node[] = [
  ["p-sawant", "Rakesh Sawant", "PERSON", 560, 340, 16, 22, 92],
  ["p-patel", "Vikram Patel", "PERSON", 720, 420, 14, 18, 92],
  ["p-khan", "Mohd. Khan", "PERSON", 420, 460, 13, 14, 92],
  ["p-gaikwad", "Deepak Gaikwad", "PERSON", 460, 210, 12, 10, 92],
  ["p-roy", "Anita Roy", "PERSON", 880, 300, 12, 8, 92],
  ["p-more", "Rahul More", "PERSON", 640, 560, 13, 12, 92],
  ["p-patil", "Suresh Patil", "PERSON", 840, 560, 13, 14, 92],
  ["p-jadhav", "Sanjay Jadhav", "PERSON", 480, 630, 12, 10, 92],
  ["p-deshmukh", "Vijay Deshmukh", "PERSON", 300, 580, 13, 12, 92],
  ["fir-102", "FIR-102 DHARAVI PS", "ORGANIZATION", 580, 470, 9, 15, 85],
  ["fir-044", "FIR-044 CRIME BRANCH", "ORGANIZATION", 990, 240, 8, 10, 85],
  ["org-quickpay", "QUICKPAY SOLUTIONS", "ORGANIZATION", 830, 180, 8, 9, 85],
  ["acc-icici", "ICICI 00245678901", "ACCOUNT", 700, 110, 8, 6, 60],
  ["acc-sbi", "SBI 37890123456", "ACCOUNT", 620, 690, 7, 5, 60],
  ["acc-hdfc", "HDFC 0012948201", "ACCOUNT", 880, 440, 8, 7, 60],
  ["veh-scorpio", "MH02AB1234 SCORPIO", "VEHICLE", 360, 280, 8, 8, 60],
  ["veh-creta", "MH01XX9900 CRETA", "VEHICLE", 780, 640, 8, 5, 60],
  ["veh-bolero", "MH12XY9988 BOLERO", "VEHICLE", 320, 690, 8, 6, 60],
  ["loc-dharavi", "DHARAVI BASE HQ", "LOCATION", 470, 360, 8, 8, 60],
  ["loc-sakinaka", "SAKINAKA JUNCTION", "LOCATION", 480, 540, 8, 6, 60],
  ["loc-andheri", "SAFEHOUSE-402 ANDHERI", "LOCATION", 250, 430, 7, 5, 60],
];
const EDGES: [string, string, number][] = [
  ["p-sawant", "fir-102", 1.8], ["p-patel", "fir-102", 1.6], ["p-khan", "fir-102", 1.5],
  ["p-more", "fir-102", 1.3], ["p-patil", "fir-102", 1.3], ["p-sawant", "org-quickpay", 1.5],
  ["p-patel", "org-quickpay", 1.5], ["p-roy", "org-quickpay", 1.4], ["p-roy", "fir-044", 1.3],
  ["org-quickpay", "acc-icici", 1.4], ["p-gaikwad", "acc-icici", 1.2], ["p-jadhav", "acc-sbi", 1.2],
  ["p-patel", "acc-hdfc", 1.3], ["p-patil", "acc-sbi", 1.2], ["p-sawant", "veh-scorpio", 1.5],
  ["p-gaikwad", "veh-scorpio", 1.3], ["p-patel", "veh-creta", 1.3], ["p-deshmukh", "veh-bolero", 1.3],
  ["p-jadhav", "veh-bolero", 1.2], ["p-sawant", "loc-dharavi", 1.6], ["p-khan", "loc-dharavi", 1.4],
  ["p-more", "loc-sakinaka", 1.3], ["p-deshmukh", "loc-sakinaka", 1.2], ["p-khan", "loc-andheri", 1.3],
  ["p-patil", "loc-andheri", 1.2], ["p-sawant", "p-patel", 1.8], ["p-sawant", "p-khan", 1.6],
  ["p-patel", "p-more", 1.4], ["p-more", "p-jadhav", 1.3], ["p-patil", "p-deshmukh", 1.3],
  ["p-gaikwad", "p-jadhav", 1.2],
];
const LAYERS: [string, string, boolean][] = [
  ["SUSPECTS", "#ff5a3c", true],
  ["ORGS/FIR", "#e0a63d", false],
  ["ACCOUNTS", AC, false],
  ["VEHICLES", "#b18cff", false],
];

const CAMS: Record<string, string> = {
  "CAM-01": "Main Gate — East Wing",
  "CAM-02": "North Crossing — Cam B",
  "CAM-03": "South Highway Tollgate",
  "CAM-04": "Metro Station Exit 2",
};

type Led = [string, string, string, number, string, string, string];
const LEDGER: Led[] = [
  ["f-01", "fir_102_final.pdf", "7a3f4c2d1e8b9a0f3e2d1c4b5a6f7e8d9c0b1a2f3e4d5c6b7a8f9e0d1c2b3a4f", 14209, "VERIFIED", "IO A. Kumar", "1.2 MB"],
  ["f-02", "cdr_batch_march_2024.csv", "b4e29f1a8c7d6e5f4a3b2c1d0e9f8a7b6c5d4e3f2a1b0c9d8e7f6a5b4c3d2e1f", 14210, "VERIFIED", "Analyst B. Singh", "4.8 MB"],
  ["f-03", "suspect_wiretap_log_audio.wav", "9c8b7a6f5e4d3c2b1a0f9e8d7c6b5a4f3e2d1c0b9a8f7e6d5c4b3a2f1e0d9c8b", 14212, "TAMPERED", "External Gateway (Mismatch)", "14.2 MB"],
  ["f-04", "cctv_cam01_footage_clip.mp4", "1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b", 14215, "VERIFIED", "IO A. Kumar", "45.0 MB"],
  ["f-05", "bank_ledger_syndicate_accts.xlsx", "3f4e5d6c7b8a9f0e1d2c3b4a5f6e7d8c9b0a1f2e3d4c5b6a7f8e9d0c1b2a3f4e", 14218, "PENDING", "System Saga Ingestion", "820 KB"],
];

const DOT: Record<string, string> = { up: "#5ecf9a", degraded: "#e0a63d", down: "#ff5a3c" };
const HL: Record<string, string> = { up: "LIVE", degraded: "DEGRADED", down: "DOWN" };
const CK: Record<string, string> = { pass: "#5ecf9a", warn: "#e0a63d", fail: "#ff5a3c" };
const CHECKS: Record<string, [string, string, string][]> = {
  "supabase-pg": [["Schema present (19/19 tables)", "pass", "all migrations found"], ["Foreign-key orphans", "pass", "0 orphaned rows"], ["source_files ↔ Storage parity", "pass", "87/87 matched"]],
  neo4j: [["Entity ↔ Postgres id sync", "warn", "6 pending merge"], ["Relationship weight recompute", "pass", "561 edges consistent"]],
  "supabase-storage": [["Blob SHA-256 round-trip", "pass", "sampled 20/20 OK"]],
  "fabric-ledger": [["Anchor coverage", "warn", "21 docs unanchored"], ["Gateway reachable", "fail", "peer down — mock fallback"]],
};
type Store = [string, string, string, string, string, string, number, string, string];
const STORES: Store[] = [
  ["supabase-pg", "S1", "Supabase Postgres", "Primary relational store", "cloud · ap-south-1", "up", 100, "4,821 rows · 19 tbl", "JUST NOW"],
  ["neo4j", "S2", "Neo4j Graph", "Criminal-network graph", "local · docker :7687", "up", 98, "342 nodes · 561 rel", "12S AGO"],
  ["supabase-storage", "S3", "Supabase Storage", "Evidence blob bucket", "cloud · bucket: evidence", "up", 100, "87 blobs", "1M AGO"],
  ["fabric-ledger", "S4", "Fabric Ledger", "Tamper-proof audit anchors", "local · mock fallback", "degraded", 76, "87 anchors · 21 pend", "4M AGO"],
];
const PIPE: [string, string][] = [
  ["Hash & register", "SHA-256 stream · source_files row"],
  ["Parse & extract", "CSV cols / PDF OCR + NER"],
  ["Map to schema", "match fields → target table"],
  ["Store rows", "Postgres + Storage blob"],
  ["Isolate unmapped", "park unknowns for review"],
  ["Commit & anchor", "ledger anchor + audit emit"],
];

function poly(cx: number, cy: number, r: number, sides: number, rot: number) {
  const pts: string[] = [];
  for (let i = 0; i < sides; i++) {
    const a = rot + (i * 2 * Math.PI) / sides;
    pts.push((cx + r * Math.cos(a)).toFixed(1) + "," + (cy + r * Math.sin(a)).toFixed(1));
  }
  return pts.join(" ");
}

const GLOBAL_CSS = `
@import url('https://fonts.googleapis.com/css2?family=Instrument+Sans:wght@400;500;600;700&family=Spline+Sans+Mono:wght@400;500;600;700&display=swap');
.rv-root, .rv-root *{box-sizing:border-box}
.rv-root ::selection{background:rgba(143,216,234,.25)}
.rv-root ::-webkit-scrollbar{width:8px;height:8px}
.rv-root ::-webkit-scrollbar-track{background:transparent}
.rv-root ::-webkit-scrollbar-thumb{background:#232b37;border-radius:0}
@keyframes rvPulse{0%,100%{opacity:1}50%{opacity:.25}}
@keyframes rvPing{0%{transform:scale(1);opacity:.7}80%,100%{transform:scale(2.4);opacity:0}}
@keyframes rvSweep{from{transform:scaleX(0)}to{transform:scaleX(1)}}
.rv-modbtn:hover{background:#0c1015 !important}
.rv-row:hover{background:#0b0e12 !important}
.rv-focus:focus{border-color:${acBorder} !important}
.rv-hoverAc:hover{border-color:${acBorder} !important;color:${AC} !important}
`;

const mono = (extra?: CSSProperties): CSSProperties => ({ fontFamily: MONO, ...extra });

export default function RavenRefactor() {
  const [nav, setNav] = useState<Nav>("profiles");
  const [search, setSearch] = useState("");
  const [roleF, setRoleF] = useState("ALL");
  const [selAudit, setSelAudit] = useState(0);
  const [openDb, setOpenDb] = useState<string | null>("fabric-ledger");
  const [selNode, setSelNode] = useState<string | null>(null);
  const [lockedId, setLockedId] = useState("03");
  const [cam, setCam] = useState("CAM-01");
  const [zulu, setZulu] = useState("");

  useEffect(() => {
    const tick = () =>
      setZulu(
        new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false }) +
          " ZULU"
      );
    tick();
    const t = setInterval(tick, 15000);
    return () => clearInterval(t);
  }, []);

  const cur = MODS.find((m) => m.id === nav)!;

  const profiles = useMemo(() => {
    const q = search.toLowerCase();
    return RAW.filter(
      (r) =>
        (roleF === "ALL" || r[3] === roleF) &&
        (!q || r[0].toLowerCase().includes(q) || r[1].toLowerCase().includes(q) || r[4].toLowerCase().includes(q))
    ).map((r, i) => {
      const rc = RISK_C[r[7]];
      const filled = Math.round(r[6] * 10);
      return {
        idx: String(i + 1).padStart(2, "0"),
        name: r[0], alias: r[1], roleUp: r[2].toUpperCase(), roleFg: ROLE_C[r[3]],
        aadhaar: r[4], cases: r[5], risk: r[6].toFixed(2), riskColor: rc,
        bars: Array.from({ length: 10 }, (_, k) => (k < filled ? rc : "#161c25")),
        status: r[8], stColor: ST_C[r[8]],
      };
    });
  }, [search, roleF]);

  const graph = useMemo(() => {
    const pos: Record<string, [number, number]> = {};
    const gNodes = NODES.map((n) => {
      const [id, label, type, x, y, r, degree, threat] = n;
      pos[id] = [x, y];
      const c = TYPE_C[type];
      const isP = type === "PERSON";
      const seld = selNode === id;
      const rot = type === "LOCATION" ? 0 : Math.PI / SIDES[type];
      return {
        id, degree, threat, type, label,
        pts: poly(x, y, r, SIDES[type], rot),
        rpts: poly(x, y, r + 5, SIDES[type], rot),
        ringOp: seld ? 1 : isP ? 0.35 : 0,
        c, fillC: seld ? c : hexA(c, isP ? 0.28 : 0.16),
        fs: isP ? 10.5 : 8.5, tc: seld ? c : isP ? "#e8edf2" : hexA(c, 0.75),
        tx: x, ty: isP ? y - r - 11 : y + r + 15,
      };
    });
    const gEdges = EDGES.map((e) => ({ x1: pos[e[0]][0], y1: pos[e[0]][1], x2: pos[e[1]][0], y2: pos[e[1]][1], w: e[2] }));
    return { gNodes, gEdges };
  }, [selNode]);

  const selN = NODES.find((n) => n[0] === selNode);

  const ledger = LEDGER.map((r, i) => {
    const tam = r[4] === "TAMPERED";
    const sel = selAudit === i;
    return {
      i, fileId: r[0].toUpperCase(), filename: r[1],
      hashShort: r[2].substring(0, 14) + "…" + r[2].substring(58),
      block: r[3], status: r[4], accessedBy: r[5],
      statusMark: tam ? "✕" : r[4] === "VERIFIED" ? "✓" : "◌",
      rowBg: tam ? "rgba(255,90,60,.05)" : sel ? hexA(AC, 0.06) : "transparent",
      edge: tam ? "#ff5a3c" : sel ? AC : "transparent",
      stFg: tam ? "#ff5a3c" : r[4] === "VERIFIED" ? "#5ecf9a" : "#e0a63d",
    };
  });
  const sel = LEDGER[selAudit];
  const selTam = sel[4] === "TAMPERED";

  const stores = STORES.map((s) => ({
    key: s[0], num: s[1], name: s[2], role: s[3], location: s[4],
    dotColor: DOT[s[5]], healthLabel: HL[s[5]],
    integrity: s[6], intColor: s[6] >= 99 ? "#5ecf9a" : s[6] >= 85 ? "#e0a63d" : "#ff5a3c",
    records: s[7], lastSync: s[8], open: openDb === s[0],
    checks: CHECKS[s[0]].map((c) => ({ label: c[0], color: CK[c[1]], detail: c[2] })),
  }));

  const th: CSSProperties = mono({ padding: "0 10px", fontSize: 9, fontWeight: 500, letterSpacing: ".18em", color: "#5c6773" });
  const ledTh: CSSProperties = mono({ padding: "0 8px", fontSize: 9, fontWeight: 500, letterSpacing: ".16em", color: "#5c6773" });

  return (
    <div
      className="rv-root"
      style={{
        display: "flex", flexDirection: "column", height: "100vh",
        background: "#060809", color: "#e8edf2", overflow: "hidden", userSelect: "none",
        fontFamily: "'Instrument Sans',system-ui,sans-serif", fontSize: 13,
      }}
    >
      <style dangerouslySetInnerHTML={{ __html: GLOBAL_CSS }} />

      {/* ══ TOP BAR ══ */}
      <header style={{ display: "flex", height: 48, alignItems: "center", borderBottom: "1px solid #1b212b", background: "#080b0e", flexShrink: 0, padding: "0 16px", gap: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
          <span style={{ width: 10, height: 10, background: AC, clipPath: "polygon(0 0,100% 0,100% 65%,65% 100%,0 100%)" }} />
          <span style={mono({ fontWeight: 700, fontSize: 15, letterSpacing: ".28em", color: "#e8edf2" })}>RAVEN</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 9, flexShrink: 0, borderLeft: "1px solid #1b212b", paddingLeft: 16, whiteSpace: "nowrap" }}>
          <span style={mono({ fontSize: 13, fontWeight: 600, letterSpacing: ".06em", color: AC })}>OP-RAVEN-01</span>
          <span title="Case live" style={{ width: 6, height: 6, borderRadius: "50%", background: "#5ecf9a", animation: "rvPulse 2.4s infinite" }} />
        </div>
        <nav style={{ display: "flex", alignItems: "stretch", height: "100%", flex: 1, minWidth: 0, overflow: "hidden" }}>
          {MODS.map((m) => {
            const act = nav === m.id;
            return (
              <button key={m.id} className="rv-modbtn" onClick={() => setNav(m.id)}
                style={{ position: "relative", display: "flex", alignItems: "center", gap: 8, padding: "0 clamp(8px,1.4vw,18px)", background: act ? "#0c1015" : "transparent", border: "none", cursor: "pointer", fontFamily: "inherit", flex: "0 0 auto" }}>
                <span style={mono({ fontSize: 11, fontWeight: 700, color: act ? AC : "#3d4653" })}>{m.num}</span>
                <span style={{ fontSize: 12, fontWeight: 600, letterSpacing: ".1em", color: act ? "#e8edf2" : "#7d8894", whiteSpace: "nowrap" }}>{m.label}</span>
                {act && <span style={{ position: "absolute", left: 0, bottom: -1, height: 2, width: "100%", background: AC, transformOrigin: "left", animation: "rvSweep .28s cubic-bezier(.16,1,.3,1)" }} />}
              </button>
            );
          })}
        </nav>
        <button className="rv-hoverAc" style={{ display: "flex", alignItems: "center", gap: 10, flex: "0 1 170px", minWidth: 90, height: 30, padding: "0 12px", background: "#0b0e12", border: "1px solid #1b212b", color: "#5c6773", ...mono({ fontSize: 11 }), cursor: "pointer", letterSpacing: ".04em" }}>
          <span style={{ color: AC }}>›_</span>
          <span style={{ flex: 1, textAlign: "left", overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>search</span>
          <kbd style={{ fontSize: 9, border: "1px solid #232b37", padding: "1px 5px", color: "#5c6773", fontFamily: "inherit" }}>⌃K</kbd>
        </button>
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexShrink: 0, borderLeft: "1px solid #1b212b", paddingLeft: 16, ...mono({ fontSize: 10 }), letterSpacing: ".08em", whiteSpace: "nowrap" }}>
          <span title="IO A. Kumar" style={{ width: 22, height: 22, display: "flex", alignItems: "center", justifyContent: "center", border: `1px solid ${acBorder}`, background: acDim, color: AC, fontSize: 9, fontWeight: 700 }}>AK</span>
          <span style={{ color: AC, fontWeight: 600 }}>{zulu}</span>
        </div>
      </header>

      {/* ══ CANVAS ══ */}
      <div style={{ minHeight: 0, flex: 1, position: "relative", overflow: "hidden", background: "#060809" }}>
        <div style={{ position: "absolute", inset: 0, pointerEvents: "none", zIndex: 1, backgroundImage: "linear-gradient(rgba(143,216,234,.014) 1px,transparent 1px)", backgroundSize: "100% 3px", mixBlendMode: "screen" }} />

        {/* ── 01 PROFILES ── */}
        {nav === "profiles" && (
          <div style={{ display: "flex", height: "100%", flexDirection: "column", overflow: "hidden" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 18, padding: "14px 24px", borderBottom: "1px solid #1b212b", flexWrap: "wrap" }}>
              <div style={{ position: "relative", width: 340 }}>
                <span style={{ position: "absolute", left: 12, top: 9, color: "#5c6773", ...mono({ fontSize: 11 }) }}>/</span>
                <input type="text" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="name · alias · aadhaar · phone · vehicle"
                  className="rv-focus" style={{ height: 34, width: "100%", background: "#0b0e12", border: "1px solid #1b212b", padding: "0 12px 0 26px", fontSize: 12, ...mono(), color: "#e8edf2", outline: "none", letterSpacing: ".02em" }} />
              </div>
              <div style={{ display: "flex", alignItems: "center", border: "1px solid #1b212b" }}>
                {RF.map(([id, label]) => (
                  <button key={id} onClick={() => setRoleF(id)}
                    style={{ height: 32, padding: "0 13px", background: roleF === id ? hexA(AC, 0.12) : "transparent", color: roleF === id ? AC : "#5c6773", border: "none", borderRight: "1px solid #1b212b", ...mono({ fontSize: 10 }), letterSpacing: ".1em", cursor: "pointer" }}>{label}</button>
                ))}
              </div>
              <span style={mono({ fontSize: 10, letterSpacing: ".1em", color: "#5c6773" })}>{profiles.length}/6 SUBJECTS</span>
              <button style={{ marginLeft: "auto", height: 34, display: "flex", alignItems: "center", gap: 8, padding: "0 16px", background: acDim, border: `1px solid ${acBorder}`, color: AC, ...mono({ fontSize: 11, fontWeight: 600 }), letterSpacing: ".12em", cursor: "pointer" }}>+ NEW SUBJECT</button>
            </div>
            <div style={{ flex: 1, overflowY: "auto", padding: "0 24px 24px" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left" }}>
                <thead>
                  <tr style={{ height: 38, borderBottom: "1px solid #232b37" }}>
                    <th style={{ ...th, width: 34 }}>##</th>
                    <th style={th}>SUBJECT</th>
                    <th style={th}>ALIAS</th>
                    <th style={th}>ROLE / TIER</th>
                    <th style={th}>AADHAAR</th>
                    <th style={th}>CASES</th>
                    <th style={{ ...th, width: 170 }}>RISK INDEX</th>
                    <th style={{ ...th, width: 90, textAlign: "right" }}>STATUS</th>
                  </tr>
                </thead>
                <tbody>
                  {profiles.map((p) => (
                    <tr key={p.idx + p.name} className="rv-row" style={{ height: 46, borderBottom: "1px solid #12161d", cursor: "pointer" }}>
                      <td style={mono({ padding: "0 10px", fontSize: 10, color: "#5c6773" })}>{p.idx}</td>
                      <td style={{ padding: "0 10px" }}><span style={{ fontSize: 13, fontWeight: 600, color: "#e8edf2", letterSpacing: ".01em" }}>{p.name}</span></td>
                      <td style={mono({ padding: "0 10px", fontSize: 11, color: "#98a4b3" })}>"{p.alias}"</td>
                      <td style={{ padding: "0 10px" }}>
                        <span style={mono({ display: "inline-flex", alignItems: "center", gap: 7, fontSize: 10, letterSpacing: ".08em", color: p.roleFg })}>
                          <span style={{ width: 7, height: 7, background: p.roleFg, clipPath: "polygon(0 0,100% 0,100% 65%,65% 100%,0 100%)" }} />{p.roleUp}
                        </span>
                      </td>
                      <td style={mono({ padding: "0 10px", fontSize: 10, color: "#5c6773" })}>{p.aadhaar}</td>
                      <td style={mono({ padding: "0 10px", fontSize: 10, color: "#98a4b3" })}>{p.cases}</td>
                      <td style={{ padding: "0 10px" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
                          <div style={{ display: "flex", gap: 2, flex: 1, maxWidth: 96 }}>
                            {p.bars.map((c, k) => <span key={k} style={{ height: 12, flex: 1, background: c }} />)}
                          </div>
                          <span style={mono({ fontSize: 10, fontWeight: 600, color: p.riskColor })}>{p.risk}</span>
                        </div>
                      </td>
                      <td style={{ padding: "0 10px", textAlign: "right" }}><span style={mono({ fontSize: 9, letterSpacing: ".12em", color: p.stColor })}>{p.status}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", paddingTop: 14, ...mono({ fontSize: 9 }), letterSpacing: ".12em", color: "#5c6773" }}>
                <span>DBL-CLICK ROW → OPEN DOSSIER</span><span>PAGE 1/1 · 6 RECORDS</span>
              </div>
            </div>
          </div>
        )}

        {/* ── 02 NETWORK ── */}
        {nav === "graph" && (
          <div style={{ display: "flex", height: "100%", width: "100%", overflow: "hidden", position: "relative" }}>
            <div style={{ flex: 1, height: "100%", position: "relative", backgroundImage: "radial-gradient(#10141a 1px,transparent 1px)", backgroundSize: "26px 26px" }}>
              <svg viewBox="0 0 1200 760" style={{ width: "100%", height: "100%", display: "block" }}>
                {graph.gEdges.map((e, i) => (
                  <line key={i} x1={e.x1} y1={e.y1} x2={e.x2} y2={e.y2} stroke="#1e2733" strokeWidth={e.w} />
                ))}
                {graph.gNodes.map((n) => (
                  <g key={n.id} onClick={() => setSelNode(n.id)} style={{ cursor: "pointer" }}>
                    <polygon points={n.rpts} fill="none" stroke={n.c} strokeWidth={1} opacity={n.ringOp} />
                    <polygon points={n.pts} fill={n.fillC} stroke={n.c} strokeWidth={1.4} />
                    <text x={n.tx} y={n.ty} fontSize={n.fs} fontWeight={600} fill={n.tc} textAnchor="middle" fontFamily={MONO} letterSpacing="0.06em">{n.label}</text>
                  </g>
                ))}
              </svg>
              <div style={{ position: "absolute", top: 18, left: 20, display: "flex", flexDirection: "column", gap: 8 }}>
                <div style={{ display: "flex", gap: 8 }}>
                  {LAYERS.map(([label, dot, lockOn]) => (
                    <button key={label} style={{ height: 28, display: "flex", alignItems: "center", gap: 7, padding: "0 11px", background: "#0b0e12", border: `1px solid ${lockOn ? hexA(dot, 0.4) : "#1b212b"}`, color: lockOn ? "#e8edf2" : "#5c6773", ...mono({ fontSize: 9 }), letterSpacing: ".12em", cursor: "pointer" }}>
                      <span style={{ width: 6, height: 6, background: dot }} />{label}
                    </button>
                  ))}
                </div>
                <span style={mono({ fontSize: 9, letterSpacing: ".12em", color: "#5c6773" })}>LAYOUT FORCE · 21 NODES · 31 EDGES</span>
              </div>
              <div style={{ position: "absolute", top: 18, right: 20, display: "flex", gap: 8 }}>
                <button className="rv-hoverAc" style={{ height: 28, padding: "0 12px", background: "#0b0e12", border: "1px solid #1b212b", color: "#98a4b3", ...mono({ fontSize: 9 }), letterSpacing: ".14em", cursor: "pointer" }}>RESET</button>
                <button style={{ height: 28, padding: "0 12px", background: "#0b0e12", border: "1px solid #1b212b", color: AC, ...mono({ fontSize: 9 }), letterSpacing: ".14em", cursor: "pointer" }}>EXPORT PNG</button>
              </div>
              <div style={{ position: "absolute", bottom: 18, left: 20, display: "flex", gap: 14, ...mono({ fontSize: 9 }), letterSpacing: ".1em" }}>
                <span style={{ display: "flex", alignItems: "center", gap: 6, color: "#98a4b3" }}><span style={{ width: 7, height: 7, background: "#ff5a3c", clipPath: "polygon(50% 0,100% 25%,100% 75%,50% 100%,0 75%,0 25%)" }} />SUSPECT</span>
                <span style={{ display: "flex", alignItems: "center", gap: 6, color: "#5c6773" }}><span style={{ width: 7, height: 7, background: "#e0a63d" }} />ORG/FIR</span>
                <span style={{ display: "flex", alignItems: "center", gap: 6, color: "#5c6773" }}><span style={{ width: 7, height: 7, background: AC }} />ACCOUNT</span>
                <span style={{ display: "flex", alignItems: "center", gap: 6, color: "#5c6773" }}><span style={{ width: 7, height: 7, background: "#5ecf9a", transform: "rotate(45deg)" }} />LOCATION</span>
                <span style={{ display: "flex", alignItems: "center", gap: 6, color: "#5c6773" }}><span style={{ width: 7, height: 7, background: "#b18cff" }} />VEHICLE</span>
              </div>
            </div>
            {selN && (
              <div style={{ width: 320, borderLeft: "1px solid #1b212b", background: "#080b0e", display: "flex", flexDirection: "column", flexShrink: 0 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 18px", borderBottom: "1px solid #1b212b" }}>
                  <span style={mono({ fontSize: 9, letterSpacing: ".18em", color: AC })}>◈ NODE INTEL</span>
                  <button onClick={() => setSelNode(null)} style={{ background: "none", border: "none", color: "#5c6773", cursor: "pointer", fontSize: 13, fontFamily: "inherit" }}>✕</button>
                </div>
                <div style={{ padding: 18, display: "flex", flexDirection: "column", gap: 16, overflowY: "auto" }}>
                  <div>
                    <div style={{ fontSize: 19, fontWeight: 700, letterSpacing: "-.01em", color: "#e8edf2" }}>{selN[1]}</div>
                    <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 6 }}>
                      <span style={mono({ fontSize: 9, letterSpacing: ".14em", padding: "3px 8px", border: `1px solid ${hexA(TYPE_C[selN[2]], 0.4)}`, color: TYPE_C[selN[2]] })}>{selN[2] === "PERSON" ? "PRIMARY SUSPECT" : selN[2]}</span>
                      <span style={mono({ fontSize: 9, color: "#5c6773" })}>ID · {selN[0].toUpperCase()}</span>
                    </div>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                    <div style={{ border: "1px solid #1b212b", background: "#0b0e12", padding: 11 }}><div style={mono({ fontSize: 8, letterSpacing: ".16em", color: "#5c6773" })}>LINKS</div><div style={mono({ fontSize: 19, fontWeight: 700, color: AC, marginTop: 3 })}>{selN[6]}</div></div>
                    <div style={{ border: "1px solid #1b212b", background: "#0b0e12", padding: 11 }}><div style={mono({ fontSize: 8, letterSpacing: ".16em", color: "#5c6773" })}>THREAT</div><div style={mono({ fontSize: 19, fontWeight: 700, color: "#ff5a3c", marginTop: 3 })}>{selN[7]}%</div></div>
                  </div>
                  <div>
                    <div style={mono({ fontSize: 9, letterSpacing: ".16em", color: "#5c6773", marginBottom: 9 })}>EVIDENCE CHAIN</div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                      {[
                        { logId: "LOG-0842", time: "03-12 14:32", text: `Active link established in case record (weight ${selN[6]})` },
                        { logId: "LOG-0843", time: "03-14 09:15", text: "Telecom CDR ping match — tower MH-MUM-0847" },
                        { logId: "LOG-0844", time: "03-18 22:40", text: "Corroborating on-chain forensic audit anchored" },
                      ].map((ev) => (
                        <div key={ev.logId} style={{ borderLeft: `2px solid ${acBorder}`, background: "#0b0e12", padding: "9px 11px" }}>
                          <div style={mono({ display: "flex", justifyContent: "space-between", fontSize: 9 })}><span style={{ color: AC }}>{ev.logId}</span><span style={{ color: "#5c6773" }}>{ev.time}</span></div>
                          <div style={{ fontSize: 11, color: "#98a4b3", marginTop: 4, lineHeight: 1.45 }}>{ev.text}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                  <button style={{ height: 38, background: acDim, border: `1px solid ${acBorder}`, color: AC, ...mono({ fontSize: 10, fontWeight: 600 }), letterSpacing: ".14em", cursor: "pointer" }}>OPEN FULL DOSSIER →</button>
                  <button style={{ height: 32, background: "transparent", border: "1px solid #1b212b", color: "#98a4b3", ...mono({ fontSize: 9 }), letterSpacing: ".14em", cursor: "pointer" }}>ISOLATE 1-HOP NEIGHBORHOOD</button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── 03 OPTICS ── */}
        {nav === "cctv" && (
          <div style={{ display: "flex", height: "100%", flexDirection: "column", overflow: "hidden" }}>
            <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
              <div style={{ width: 250, borderRight: "1px solid #1b212b", background: "#080b0e", display: "flex", flexDirection: "column", flexShrink: 0 }}>
                <div style={{ padding: "14px 16px", borderBottom: "1px solid #1b212b", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={mono({ fontSize: 9, letterSpacing: ".16em", color: "#5c6773" })}>DETECTED · 5</span>
                  <span style={mono({ fontSize: 9, color: AC })}>YOLOv8n</span>
                </div>
                <div style={{ flex: 1, overflowY: "auto", padding: 10, display: "flex", flexDirection: "column", gap: 7 }}>
                  {[["01", 90], ["02", 95], ["03", 98], ["04", 91], ["05", 88]].map(([id, conf]) => {
                    const isL = lockedId === id;
                    return (
                      <button key={id as string} onClick={() => setLockedId(id as string)}
                        style={{ display: "flex", alignItems: "center", gap: 11, padding: "10px 11px", background: isL ? "rgba(255,90,60,.07)" : "#0b0e12", border: `1px solid ${isL ? "rgba(255,90,60,.4)" : "#12161d"}`, cursor: "pointer", fontFamily: "inherit", textAlign: "left" }}>
                        <span style={mono({ fontSize: 15, fontWeight: 700, color: isL ? "#ff5a3c" : "#5c6773" })}>{id}</span>
                        <span style={{ flex: 1, display: "flex", flexDirection: "column", gap: 1 }}>
                          <span style={mono({ fontSize: 9, letterSpacing: ".1em", color: isL ? "#ff5a3c" : "#98a4b3" })}>{isL ? "TARGET LOCK-ON" : "PEDESTRIAN"}</span>
                          <span style={mono({ fontSize: 9, color: "#5c6773" })}>CONF {conf}%</span>
                        </span>
                        <span style={mono({ fontSize: 10, color: isL ? "#ff5a3c" : "#5c6773" })}>{isL ? "◉" : "⌖"}</span>
                      </button>
                    );
                  })}
                </div>
                <div style={{ padding: 12 }}>
                  <button style={{ width: "100%", height: 36, background: acDim, border: `1px solid ${acBorder}`, color: AC, ...mono({ fontSize: 10, fontWeight: 600 }), letterSpacing: ".12em", cursor: "pointer" }}>⌖ LOCK-ON TARGET {lockedId}</button>
                </div>
              </div>
              <div style={{ flex: 1, display: "flex", flexDirection: "column", background: "#040506", minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "10px 18px", borderBottom: "1px solid #1b212b", background: "#07090c" }}>
                  <div style={{ display: "flex", border: "1px solid #1b212b" }}>
                    {Object.keys(CAMS).map((id) => (
                      <button key={id} onClick={() => setCam(id)} style={{ height: 28, padding: "0 12px", background: cam === id ? hexA(AC, 0.12) : "transparent", color: cam === id ? AC : "#5c6773", border: "none", borderRight: "1px solid #1b212b", ...mono({ fontSize: 10 }), letterSpacing: ".08em", cursor: "pointer", whiteSpace: "nowrap" }}>{id}</button>
                    ))}
                  </div>
                  <span style={{ fontSize: 11, color: "#98a4b3", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", minWidth: 0 }}>{CAMS[cam]}</span>
                  <span style={mono({ display: "flex", alignItems: "center", gap: 6, fontSize: 9, letterSpacing: ".1em", color: "#5ecf9a", whiteSpace: "nowrap", flexShrink: 0 })}><span style={{ width: 6, height: 6, borderRadius: "50%", background: "#5ecf9a", animation: "rvPulse 2s infinite" }} />LIVE 1080p 30fps</span>
                  <span style={mono({ fontSize: 9, letterSpacing: ".08em", color: "#5c6773", whiteSpace: "nowrap", flexShrink: 0 })}>YOLOv8 + OSNet RE-ID</span>
                  <button style={{ marginLeft: "auto", height: 30, padding: "0 14px", background: acDim, border: `1px solid ${acBorder}`, color: AC, ...mono({ fontSize: 10, fontWeight: 600 }), letterSpacing: ".1em", cursor: "pointer", whiteSpace: "nowrap", flexShrink: 0 }}>▸ START TRACKING</button>
                </div>
                <div style={{ flex: 1, position: "relative", margin: 16, border: "1px solid #1b212b", overflow: "hidden", background: "#07090c" }}>
                  <div style={{ position: "absolute", inset: 0, backgroundImage: "radial-gradient(#12161d 1px,transparent 1px)", backgroundSize: "18px 18px", opacity: 0.6 }} />
                  <span style={{ position: "absolute", top: 10, left: 10, width: 18, height: 18, borderTop: `1px solid ${AC}`, borderLeft: `1px solid ${AC}`, opacity: 0.7 }} />
                  <span style={{ position: "absolute", top: 10, right: 10, width: 18, height: 18, borderTop: `1px solid ${AC}`, borderRight: `1px solid ${AC}`, opacity: 0.7 }} />
                  <span style={{ position: "absolute", bottom: 10, left: 10, width: 18, height: 18, borderBottom: `1px solid ${AC}`, borderLeft: `1px solid ${AC}`, opacity: 0.7 }} />
                  <span style={{ position: "absolute", bottom: 10, right: 10, width: 18, height: 18, borderBottom: `1px solid ${AC}`, borderRight: `1px solid ${AC}`, opacity: 0.7 }} />
                  <div style={{ position: "absolute", top: 16, left: 38, right: 170, ...mono({ fontSize: 10 }), letterSpacing: ".06em", color: "#98a4b3", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{cam} · {CAMS[cam]} · 2024-08-28 14:32:07 UTC</div>
                  <div style={{ position: "absolute", top: 16, right: 38, display: "flex", alignItems: "center", gap: 7, ...mono({ fontSize: 10 }), letterSpacing: ".1em", color: "#ff5a3c" }}>
                    <span style={{ position: "relative", display: "flex", width: 7, height: 7 }}><span style={{ position: "absolute", width: 7, height: 7, borderRadius: "50%", background: "#ff5a3c", animation: "rvPing 1.4s infinite" }} /><span style={{ width: 7, height: 7, borderRadius: "50%", background: "#ff5a3c" }} /></span>REC 00:02:15
                  </div>
                  <div style={{ position: "absolute", top: "34%", left: "24%", height: "31%", width: "7%", border: "1px solid rgba(143,216,234,.55)" }}><span style={{ position: "absolute", top: -17, left: -1, ...mono({ fontSize: 9 }), color: AC, letterSpacing: ".06em" }}>01·90</span></div>
                  <div style={{ position: "absolute", top: "39%", left: "41%", height: "34%", width: "8%", border: "1px solid rgba(143,216,234,.55)" }}><span style={{ position: "absolute", top: -17, left: -1, ...mono({ fontSize: 9 }), color: AC, letterSpacing: ".06em" }}>02·95</span></div>
                  <div style={{ position: "absolute", top: "28%", left: "59%", height: "42%", width: "10%", border: "1.5px solid #ff5a3c", boxShadow: "0 0 22px rgba(255,90,60,.35)", animation: "rvPulse 2.6s infinite" }}>
                    <span style={{ position: "absolute", top: -19, left: -2, ...mono({ fontSize: 10, fontWeight: 700 }), color: "#060809", background: "#ff5a3c", padding: "1px 6px", letterSpacing: ".06em" }}>TARGET 03·98</span>
                    <span style={{ position: "absolute", bottom: -17, left: 0, right: 0, textAlign: "center", ...mono({ fontSize: 8 }), letterSpacing: ".14em", color: "#ff5a3c", whiteSpace: "nowrap" }}>LOCKED</span>
                  </div>
                  <div style={{ position: "absolute", top: "44%", left: "77%", height: "27%", width: "6%", border: "1px solid rgba(143,216,234,.55)" }}><span style={{ position: "absolute", top: -17, left: -1, ...mono({ fontSize: 9 }), color: AC, letterSpacing: ".06em" }}>04·91</span></div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 16, padding: "0 18px 14px", ...mono({ fontSize: 10 }), color: "#5c6773" }}>
                  <span style={{ cursor: "pointer", color: "#98a4b3" }}>⏸</span>
                  <span>00:02:15 / 00:05:00</span>
                  <div style={{ flex: 1, height: 3, background: "#12161d", position: "relative" }}><div style={{ position: "absolute", left: 0, top: 0, height: "100%", width: "45%", background: AC }} /><div style={{ position: "absolute", left: "45%", top: -3, width: 1, height: 9, background: AC }} /></div>
                  <span>1.0× · 30FPS</span>
                </div>
              </div>
              <div style={{ width: 250, borderLeft: "1px solid #1b212b", background: "#080b0e", display: "flex", flexDirection: "column", flexShrink: 0 }}>
                <div style={{ padding: "14px 16px", borderBottom: "1px solid #1b212b", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={mono({ fontSize: 9, letterSpacing: ".16em", color: "#5c6773" })}>SIGHTINGS · 0</span>
                  <span style={mono({ fontSize: 9, color: AC })}>OSNet</span>
                </div>
                <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
                  <span style={mono({ fontSize: 10, lineHeight: 1.7, color: "#5c6773", textAlign: "center", letterSpacing: ".04em" })}>NO DOWNSTREAM SIGHTINGS<br /><span style={{ color: "#3d4653" }}>lock a target to arm<br />cross-camera handoff</span></span>
                </div>
                <div style={{ padding: "14px 16px", borderTop: "1px solid #1b212b", ...mono({ fontSize: 9 }), letterSpacing: ".08em", color: "#5c6773" }}>RE-ID CONF <span style={{ color: "#5ecf9a", fontWeight: 700 }}>92.4%</span></div>
              </div>
            </div>
            <div style={{ height: 52, borderTop: "1px solid #1b212b", background: "#07090c", display: "flex", alignItems: "center", padding: "0 18px", flexShrink: 0 }}>
              <span style={mono({ fontSize: 9, letterSpacing: ".16em", color: "#5c6773", marginRight: 18 })}>TOPOLOGY</span>
              <div style={{ display: "flex", alignItems: "center", flex: 1, ...mono({ fontSize: 10 }), letterSpacing: ".06em" }}>
                <span style={{ display: "flex", alignItems: "center", gap: 7, color: "#5ecf9a", border: "1px solid rgba(94,207,154,.35)", background: "rgba(94,207,154,.08)", padding: "5px 12px" }}><span style={{ width: 6, height: 6, borderRadius: "50%", background: "#5ecf9a" }} />CAM-01 ACTIVE</span>
                <span style={{ flex: "0 0 70px", height: 1, background: `linear-gradient(90deg,#5ecf9a,${AC})`, position: "relative" }}><span style={{ position: "absolute", top: -14, left: "50%", transform: "translateX(-50%)", fontSize: 8, color: "#5c6773", letterSpacing: ".08em", whiteSpace: "nowrap" }}>3M EST</span></span>
                <span style={{ display: "flex", alignItems: "center", gap: 7, color: AC, border: `1px solid ${acBorder}`, background: acDim, padding: "5px 12px" }}><span style={{ width: 6, height: 6, borderRadius: "50%", background: AC, animation: "rvPulse 1.8s infinite" }} />CAM-02 ARMED</span>
                <span style={{ flex: "0 0 46px", height: 1, background: "#232b37" }} />
                <span style={{ color: "#5c6773", border: "1px solid #1b212b", padding: "5px 12px" }}>CAM-03 STANDBY</span>
                <span style={{ flex: "0 0 46px", height: 1, background: "#232b37" }} />
                <span style={{ color: "#5c6773", border: "1px solid #1b212b", padding: "5px 12px" }}>CAM-04 STANDBY</span>
              </div>
            </div>
          </div>
        )}

        {/* ── 04 LEDGER ── */}
        {nav === "logs" && (
          <div style={{ display: "flex", height: "100%", flexDirection: "column", overflow: "hidden" }}>
            <div style={{ display: "flex", borderBottom: "1px solid #1b212b" }}>
              <div style={{ flex: 1, padding: "16px 24px", borderRight: "1px solid #1b212b" }}><div style={mono({ fontSize: 9, letterSpacing: ".16em", color: "#5c6773" })}>TOTAL ENTRIES</div><div style={mono({ fontSize: 26, fontWeight: 700, color: "#e8edf2", marginTop: 4 })}>2,847</div><div style={{ fontSize: 10, color: "#5c6773", marginTop: 2 }}>immutable on-chain records</div></div>
              <div style={{ flex: 1, padding: "16px 24px", borderRight: "1px solid #1b212b" }}><div style={mono({ fontSize: 9, letterSpacing: ".16em", color: "#5c6773" })}>VERIFIED HASHES</div><div style={mono({ fontSize: 26, fontWeight: 700, color: "#5ecf9a", marginTop: 4 })}>2,831</div><div style={{ fontSize: 10, color: "#5c6773", marginTop: 2 }}>SHA-256 match rate 100%</div></div>
              <div style={{ flex: 1, padding: "16px 24px", borderRight: "1px solid #1b212b" }}><div style={mono({ fontSize: 9, letterSpacing: ".16em", color: "#5c6773" })}>PENDING ANCHOR</div><div style={mono({ fontSize: 26, fontWeight: 700, color: "#e0a63d", marginTop: 4 })}>14</div><div style={{ fontSize: 10, color: "#5c6773", marginTop: 2 }}>awaiting Fabric block commit</div></div>
              <div style={{ flex: 1, padding: "16px 24px", background: "rgba(255,90,60,.06)" }}><div style={mono({ fontSize: 9, letterSpacing: ".16em", color: "#ff5a3c", display: "flex", alignItems: "center", gap: 7 })}><span style={{ position: "relative", display: "flex", width: 6, height: 6 }}><span style={{ position: "absolute", width: 6, height: 6, borderRadius: "50%", background: "#ff5a3c", animation: "rvPing 1.4s infinite" }} /><span style={{ width: 6, height: 6, borderRadius: "50%", background: "#ff5a3c" }} /></span>TAMPERED EVIDENCE</div><div style={mono({ fontSize: 26, fontWeight: 700, color: "#ff5a3c", marginTop: 4 })}>2</div><div style={{ fontSize: 10, color: "#ff5a3c", marginTop: 2 }}>hash mismatch detected</div></div>
            </div>
            <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
              <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 24px", borderBottom: "1px solid #12161d" }}>
                  <span style={mono({ fontSize: 9, letterSpacing: ".16em", color: "#5c6773" })}>HYPERLEDGER FABRIC · BLOCKCHAIN LEDGER</span>
                  <span style={mono({ fontSize: 9, letterSpacing: ".08em", color: "#5ecf9a", display: "flex", alignItems: "center", gap: 6 })}><span style={{ width: 6, height: 6, borderRadius: "50%", background: "#5ecf9a" }} />CONSENSUS HEALTHY · RAFT</span>
                </div>
                <div style={{ flex: 1, overflowY: "auto", padding: "0 24px" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left" }}>
                    <thead>
                      <tr style={{ height: 34, borderBottom: "1px solid #232b37" }}>
                        <th style={ledTh}>ID</th><th style={ledTh}>FILENAME</th><th style={ledTh}>SHA-256</th><th style={ledTh}>BLOCK</th><th style={ledTh}>STATUS</th><th style={ledTh}>ACCESSED BY</th>
                      </tr>
                    </thead>
                    <tbody>
                      {ledger.map((r) => (
                        <tr key={r.fileId} className="rv-row" onClick={() => setSelAudit(r.i)} style={{ height: 42, borderBottom: "1px solid #12161d", cursor: "pointer", background: r.rowBg, borderLeft: `2px solid ${r.edge}` }}>
                          <td style={mono({ padding: "0 8px", fontSize: 10, color: "#5c6773" })}>{r.fileId}</td>
                          <td style={{ padding: "0 8px", fontSize: 12, fontWeight: 600, color: "#e8edf2" }}>{r.filename}</td>
                          <td style={mono({ padding: "0 8px", fontSize: 10, color: "#5c6773" })}>{r.hashShort}</td>
                          <td style={mono({ padding: "0 8px", fontSize: 10, color: AC })}>#{r.block}</td>
                          <td style={{ padding: "0 8px" }}><span style={mono({ fontSize: 9, letterSpacing: ".12em", color: r.stFg })}>{r.statusMark} {r.status}</span></td>
                          <td style={{ padding: "0 8px", fontSize: 11, color: "#98a4b3" }}>{r.accessedBy}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <div style={{ display: "flex", justifyContent: "space-between", padding: "12px 8px", ...mono({ fontSize: 9 }), letterSpacing: ".12em", color: "#5c6773" }}><span>5 OF 2,847 COMMITTED BLOCKS</span><span>SYNC DELAY 12MS</span></div>
                </div>
              </div>
              <div style={{ width: 330, borderLeft: "1px solid #1b212b", background: "#080b0e", padding: 18, display: "flex", flexDirection: "column", gap: 16, overflowY: "auto", flexShrink: 0 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <span style={mono({ fontSize: 9, letterSpacing: ".16em", color: "#5c6773" })}>VERIFICATION INSPECTOR</span>
                  <span style={mono({ fontSize: 9, fontWeight: 700, letterSpacing: ".12em", padding: "3px 8px", background: selTam ? "#ff5a3c" : "rgba(94,207,154,.1)", color: selTam ? "#060809" : "#5ecf9a", border: `1px solid ${selTam ? "#ff5a3c" : "rgba(94,207,154,.35)"}` })}>{sel[4]}</span>
                </div>
                <div><div style={{ fontSize: 14, fontWeight: 700, color: "#e8edf2" }}>{sel[1]}</div><div style={mono({ fontSize: 10, color: "#5c6773", marginTop: 3 })}>{sel[6]} · BLOCK #{sel[3]}</div></div>
                <div style={{ border: "1px solid #1b212b", background: "#060809", padding: 13, display: "flex", flexDirection: "column", gap: 11 }}>
                  <div style={mono({ fontSize: 8, letterSpacing: ".18em", color: "#5c6773" })}>SHA-256 COMPARISON</div>
                  <div><div style={mono({ fontSize: 8, letterSpacing: ".1em", color: "#5c6773", marginBottom: 3 })}>LEDGER ANCHOR</div><div style={mono({ fontSize: 10, color: "#5ecf9a", wordBreak: "break-all", lineHeight: 1.5 })}>{sel[2]}</div></div>
                  <div><div style={mono({ fontSize: 8, letterSpacing: ".1em", color: "#5c6773", marginBottom: 3 })}>CURRENT STORAGE</div><div style={mono({ fontSize: 10, wordBreak: "break-all", lineHeight: 1.5, color: selTam ? "#ff5a3c" : "#5ecf9a", fontWeight: selTam ? 700 : 400 })}>{selTam ? "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855 (MISMATCH)" : sel[2]}</div></div>
                </div>
                <div>
                  <div style={mono({ fontSize: 9, letterSpacing: ".16em", color: "#5c6773", marginBottom: 10 })}>CHAIN OF CUSTODY</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 11, borderLeft: "1px solid #232b37", paddingLeft: 14 }}>
                    {[
                      ["Ingested & Stored", "2024-08-28 14:30:00 · IO A. KUMAR"],
                      ["SHA-256 On-Chain Anchor", `2024-08-28 14:30:02 · BLOCK #${sel[3]}`],
                      ["NER Extraction Run", "2024-08-28 14:31:15 · OLLAMA PHI-3"],
                    ].map(([title, meta]) => (
                      <div key={title} style={{ position: "relative" }}><span style={{ position: "absolute", left: -17, top: 4, width: 5, height: 5, background: AC }} /><div style={{ fontSize: 12, fontWeight: 600, color: "#e8edf2" }}>{title}</div><div style={mono({ fontSize: 9, color: "#5c6773", marginTop: 2 })}>{meta}</div></div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ── 05 SOURCES ── */}
        {nav === "databases" && (
          <div style={{ display: "flex", height: "100%", flexDirection: "column", overflowY: "auto" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "18px 24px", borderBottom: "1px solid #1b212b" }}>
              <div>
                <div style={{ fontSize: 17, fontWeight: 700, letterSpacing: "-.01em", color: "#e8edf2" }}>Data Sources</div>
                <div style={mono({ fontSize: 10, letterSpacing: ".06em", color: "#5c6773", marginTop: 3 })}>4/4 STORES LIVE · 94% AVG INTEGRITY · ALL INGEST VIA UPLOAD PIPELINE</div>
              </div>
              <div style={{ display: "flex", gap: 10 }}>
                <button className="rv-hoverAc" style={{ height: 34, padding: "0 15px", background: "transparent", border: "1px solid #1b212b", color: "#98a4b3", ...mono({ fontSize: 10 }), letterSpacing: ".1em", cursor: "pointer" }}>↑ UPLOAD CSV/PDF</button>
                <button style={{ height: 34, padding: "0 15px", background: acDim, border: `1px solid ${acBorder}`, color: AC, ...mono({ fontSize: 10, fontWeight: 600 }), letterSpacing: ".1em", cursor: "pointer" }}>+ CONNECT DATABASE</button>
              </div>
            </div>
            <div style={{ padding: "20px 24px" }}>
              <div style={mono({ fontSize: 9, letterSpacing: ".18em", color: "#5c6773", marginBottom: 12 })}>CONNECTED STORES</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                {stores.map((s) => (
                  <div key={s.key} style={{ border: "1px solid #1b212b", background: "#080b0e" }}>
                    <button className="rv-row" onClick={() => setOpenDb(openDb === s.key ? null : s.key)}
                      style={{ display: "flex", width: "100%", alignItems: "center", gap: 14, padding: "14px 16px", background: "transparent", border: "none", cursor: "pointer", fontFamily: "inherit", color: "inherit", textAlign: "left" }}>
                      <span style={mono({ fontSize: 15, fontWeight: 700, color: s.dotColor })}>{s.num}</span>
                      <span style={{ minWidth: 0, flex: 1, display: "flex", flexDirection: "column", gap: 2 }}>
                        <span style={{ display: "flex", alignItems: "center", gap: 9 }}><span style={{ fontSize: 13, fontWeight: 600, color: "#e8edf2" }}>{s.name}</span><span style={mono({ fontSize: 8, letterSpacing: ".14em", color: s.dotColor })}>● {s.healthLabel}</span></span>
                        <span style={mono({ fontSize: 9, letterSpacing: ".04em", color: "#5c6773", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" })}>{s.role} · {s.location}</span>
                      </span>
                      <span style={{ textAlign: "right", flexShrink: 0, display: "flex", flexDirection: "column", gap: 2 }}>
                        <span style={mono({ fontSize: 14, fontWeight: 700, color: s.intColor })}>{s.integrity}%</span>
                        <span style={mono({ fontSize: 9, color: "#5c6773" })}>{s.records}</span>
                      </span>
                      <span style={mono({ color: "#5c6773", fontSize: 11, transform: `rotate(${s.open ? "90deg" : "0deg"})` })}>›</span>
                    </button>
                    {s.open && (
                      <div style={{ borderTop: "1px solid #12161d", padding: "12px 16px" }}>
                        <div style={mono({ display: "flex", justifyContent: "space-between", fontSize: 8, letterSpacing: ".16em", color: "#5c6773", marginBottom: 9 })}><span>DATA INTEGRITY</span><span>LAST SYNC {s.lastSync}</span></div>
                        {s.checks.map((c) => (
                          <div key={c.label} style={{ display: "flex", alignItems: "center", gap: 9, padding: "3px 0", fontSize: 11 }}><span style={{ width: 6, height: 6, flexShrink: 0, background: c.color }} /><span style={{ color: "#98a4b3" }}>{c.label}</span><span style={mono({ marginLeft: "auto", fontSize: 9, color: "#5c6773" })}>{c.detail}</span></div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
            <div style={{ padding: "4px 24px 26px" }}>
              <div style={mono({ fontSize: 9, letterSpacing: ".18em", color: "#5c6773", marginBottom: 12 })}>UPLOAD PIPELINE · STORES EVERYTHING IN SEQUENCE</div>
              <div style={{ display: "flex", alignItems: "stretch", border: "1px solid #1b212b", background: "#080b0e" }}>
                {PIPE.map((p, i) => (
                  <div key={p[0]} style={{ flex: 1, display: "flex", alignItems: "center", minWidth: 0 }}>
                    <div style={{ flex: 1, padding: "14px 16px", minWidth: 0 }}>
                      <div style={mono({ fontSize: 10, fontWeight: 700, color: AC, letterSpacing: ".06em" })}>{"0" + (i + 1)}</div>
                      <div style={{ fontSize: 12, fontWeight: 600, color: "#e8edf2", marginTop: 4 }}>{p[0]}</div>
                      <div style={mono({ fontSize: 9, color: "#5c6773", marginTop: 3, lineHeight: 1.5 })}>{p[1]}</div>
                    </div>
                    {i < PIPE.length - 1 && <span style={{ color: "#232b37", fontSize: 14, paddingRight: 2 }}>›</span>}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ══ STATUS TICKER ══ */}
      <footer style={{ display: "flex", height: 28, alignItems: "center", justifyContent: "space-between", borderTop: "1px solid #1b212b", background: "#080b0e", padding: "0 18px", ...mono({ fontSize: 9 }), letterSpacing: ".1em", flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14, overflow: "hidden", whiteSpace: "nowrap" }}>
          <span style={{ color: "#98a4b3" }}>{cur.title}</span><span style={{ color: "#232b37" }}>▪</span>
          <span style={{ color: "#5c6773" }}>14 PERSONS · 6 ORGS · 8 ACCOUNTS</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 14, whiteSpace: "nowrap" }}>
          <span style={{ display: "flex", alignItems: "center", gap: 6, color: "#5ecf9a" }}><span style={{ width: 5, height: 5, borderRadius: "50%", background: "#5ecf9a", animation: "rvPulse 2.4s infinite" }} />ALL SYSTEMS LIVE</span><span style={{ color: "#232b37" }}>▪</span>
          <span style={{ color: "#5c6773", cursor: "pointer" }}>HEALTH BOARD</span>
        </div>
      </footer>
    </div>
  );
}
