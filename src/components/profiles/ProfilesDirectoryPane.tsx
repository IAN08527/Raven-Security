import { CSSProperties, useState } from "react";
import { useCaseStore } from "../../store/case";

interface ProfileRecord {
  id: string;
  name: string;
  alias: string;
  role: string;
  roleTier: "leader" | "operator" | "logistics" | "mule" | "associate";
  aadhaar: string;
  phone: string;
  vehicle: string;
  cases: string;
  riskScore: number;
  riskLevel: "HIGH" | "MED" | "LOW";
  status: "Active Suspect" | "Under Watch" | "Detained";
}

const DEMO_PROFILES: ProfileRecord[] = [
  {
    id: "0a5f9733-d8c7-5ea7-a36c-94fbba2ec332",
    name: "Rakesh Sawant",
    alias: "Ricky",
    role: "Syndicate Leader",
    roleTier: "leader",
    aadhaar: "XXXX-XXXX-4521",
    phone: "+91 98765 43210",
    vehicle: "MH-02-AB-1234",
    cases: "OP-RAVEN-01, FIR-102",
    riskScore: 0.84,
    riskLevel: "HIGH",
    status: "Active Suspect",
  },
  {
    id: "8c35e396-4191-5369-9c5c-7ec65df27d5e",
    name: "Vikram Patel",
    alias: "Vicky",
    role: "Hawala Operator",
    roleTier: "operator",
    aadhaar: "XXXX-XXXX-8912",
    phone: "+91 98111 22334",
    vehicle: "MH-01-CD-5678",
    cases: "OP-RAVEN-01",
    riskScore: 0.62,
    riskLevel: "MED",
    status: "Active Suspect",
  },
  {
    id: "5761aefc-da70-5883-999a-00e998a4d468",
    name: "Mohd. Khan",
    alias: "Bhai",
    role: "Logistics Coordinator",
    roleTier: "logistics",
    aadhaar: "XXXX-XXXX-3341",
    phone: "+91 99222 44556",
    vehicle: "MH-04-EF-9012",
    cases: "OP-RAVEN-01",
    riskScore: 0.51,
    riskLevel: "MED",
    status: "Under Watch",
  },
  {
    id: "3e46c76c-3dc4-5264-a0c5-ee169992f4ad",
    name: "Sunil Gupta",
    alias: "Doctor",
    role: "Money Mule",
    roleTier: "mule",
    aadhaar: "XXXX-XXXX-7729",
    phone: "+91 98333 66778",
    vehicle: "MH-03-GH-3456",
    cases: "OP-RAVEN-01",
    riskScore: 0.40,
    riskLevel: "LOW",
    status: "Under Watch",
  },
  {
    id: "9c3e41b9-8e7c-50f9-bd17-91a5f4c6e93b",
    name: "Anita Roy",
    alias: "Madam",
    role: "Shell Company Director",
    roleTier: "operator",
    aadhaar: "XXXX-XXXX-1123",
    phone: "+91 98444 88990",
    vehicle: "MH-02-JK-7890",
    cases: "OP-RAVEN-01",
    riskScore: 0.35,
    riskLevel: "LOW",
    status: "Under Watch",
  },
  {
    id: "7b4c92a1-3d5f-51e8-9c12-34e56f789abc",
    name: "Deepak Kumar",
    alias: "DK",
    role: "Field Associate",
    roleTier: "associate",
    aadhaar: "XXXX-XXXX-9980",
    phone: "+91 98555 11223",
    vehicle: "MH-01-LM-2345",
    cases: "OP-RAVEN-01",
    riskScore: 0.28,
    riskLevel: "LOW",
    status: "Detained",
  },
];

// ── RAVEN-refactor theme tokens (match RavenShell) ──
const AC = "#e8c15a";
const hexA = (h: string, a: number) => h + Math.round(a * 255).toString(16).padStart(2, "0");
const MONO = "'Spline Sans Mono',monospace";
const mono = (extra?: CSSProperties): CSSProperties => ({ fontFamily: MONO, ...extra });

const ROLE_C: Record<ProfileRecord["roleTier"], string> = {
  leader: "#ff5a3c",
  operator: "#e0a63d",
  logistics: AC,
  mule: "#98a4b3",
  associate: "#98a4b3",
};
const RISK_C: Record<ProfileRecord["riskLevel"], string> = { HIGH: "#ff5a3c", MED: "#e0a63d", LOW: "#5ecf9a" };
const STATUS_C: Record<ProfileRecord["status"], string> = {
  "Active Suspect": "#ff5a3c",
  "Under Watch": "#e0a63d",
  Detained: "#5c6773",
};

const ROLE_FILTERS: { id: string; label: string }[] = [
  { id: "all", label: "ALL" },
  { id: "leader", label: "LEADER" },
  { id: "operator", label: "OPERATOR" },
  { id: "logistics", label: "LOGISTICS" },
  { id: "mule", label: "MULE" },
  { id: "associate", label: "ASSOCIATE" },
];
const STATUS_FILTERS: { id: string; label: string }[] = [
  { id: "all", label: "ALL" },
  { id: "Active Suspect", label: "ACTIVE" },
  { id: "Under Watch", label: "WATCH" },
  { id: "Detained", label: "DETAINED" },
];

const th: CSSProperties = mono({
  padding: "0 10px",
  fontSize: 9,
  fontWeight: 500,
  letterSpacing: ".18em",
  color: "#5c6773",
  textAlign: "left",
});

export function ProfilesDirectoryPane() {
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const openTab = useCaseStore((s) => s.openTab);
  const profiles = useCaseStore((s) => s.profiles);
  const openIngestModal = useCaseStore((s) => s.openIngestModal);

  const filtered = profiles.filter((p) => {
    const matchesSearch =
      p.name.toLowerCase().includes(search.toLowerCase()) ||
      p.alias.toLowerCase().includes(search.toLowerCase()) ||
      p.aadhaar.toLowerCase().includes(search.toLowerCase()) ||
      p.phone.toLowerCase().includes(search.toLowerCase()) ||
      p.vehicle.toLowerCase().includes(search.toLowerCase());

    const matchesRole = roleFilter === "all" || p.roleTier === roleFilter;
    const matchesStatus = statusFilter === "all" || p.status === statusFilter;
    return matchesSearch && matchesRole && matchesStatus;
  });

  const handleOpenProfile = (p: ProfileRecord) => {
    openTab({
      id: `profile-${p.id}`,
      type: "profile",
      title: `Profile: ${p.name}`,
      data: {
        entityId: p.id,
        entityName: p.name,
        role: p.role,
        riskScore: p.riskScore,
      },
    });
  };

  const segBtn = (active: boolean): CSSProperties =>
    mono({
      height: 32,
      padding: "0 12px",
      background: active ? hexA(AC, 0.12) : "transparent",
      color: active ? AC : "#5c6773",
      border: "none",
      borderRight: "1px solid #1b212b",
      fontSize: 10,
      letterSpacing: ".1em",
      cursor: "pointer",
    });

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
      {/* Toolbar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 16,
          padding: "14px 24px",
          borderBottom: "1px solid #1b212b",
          flexWrap: "wrap",
        }}
      >
        <div style={{ position: "relative", width: 320 }}>
          <span style={{ position: "absolute", left: 12, top: 9, color: "#5c6773", ...mono({ fontSize: 11 }) }}>/</span>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="name · alias · aadhaar · phone · vehicle"
            style={{
              height: 34,
              width: "100%",
              background: "#0b0e12",
              border: "1px solid #1b212b",
              padding: "0 12px 0 26px",
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

        {/* Role filter */}
        <div style={{ display: "flex", alignItems: "center", border: "1px solid #1b212b" }}>
          {ROLE_FILTERS.map((rf) => (
            <button key={rf.id} onClick={() => setRoleFilter(rf.id)} style={segBtn(roleFilter === rf.id)}>
              {rf.label}
            </button>
          ))}
        </div>

        {/* Status filter */}
        <div style={{ display: "flex", alignItems: "center", border: "1px solid #1b212b" }}>
          {STATUS_FILTERS.map((sf) => (
            <button key={sf.id} onClick={() => setStatusFilter(sf.id)} style={segBtn(statusFilter === sf.id)}>
              {sf.label}
            </button>
          ))}
        </div>

        <span style={mono({ fontSize: 10, letterSpacing: ".1em", color: "#5c6773" })}>
          {filtered.length}/{profiles.length} SUBJECTS
        </span>

        <button
          onClick={openIngestModal}
          style={mono({
            marginLeft: "auto",
            height: 34,
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
          + NEW SUBJECT
        </button>
      </div>

      {/* Table */}
      <div style={{ flex: 1, overflowY: "auto", padding: "0 24px 24px" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left" }}>
          <thead>
            <tr style={{ height: 38, borderBottom: "1px solid #232b37" }}>
              <th style={{ ...th, width: 34 }}>##</th>
              <th style={th}>SUBJECT</th>
              <th style={th}>ALIAS</th>
              <th style={th}>ROLE / TIER</th>
              <th style={th}>PHONE</th>
              <th style={th}>AADHAAR</th>
              <th style={{ ...th, width: 140 }}>RISK INDEX</th>
              <th style={{ ...th, width: 90 }}>STATUS</th>
              <th style={{ ...th, width: 90, textAlign: "right" }}>ACTION</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((p, i) => {
              const rc = RISK_C[p.riskLevel];
              const filledBars = Math.round(p.riskScore * 10);
              return (
                <tr
                  key={p.id}
                  onClick={() => handleOpenProfile(p)}
                  style={{ height: 46, borderBottom: "1px solid #12161d", cursor: "pointer" }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = "#0b0e12")}
                  onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                >
                  <td style={mono({ padding: "0 10px", fontSize: 10, color: "#5c6773" })}>
                    {String(i + 1).padStart(2, "0")}
                  </td>
                  <td style={{ padding: "0 10px" }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: "#e8edf2", letterSpacing: ".01em" }}>{p.name}</div>
                    <div style={mono({ fontSize: 9, color: "#5c6773" })}>ID: {p.id.slice(0, 8)}...</div>
                  </td>
                  <td style={mono({ padding: "0 10px", fontSize: 11, color: "#e8c15a", fontWeight: 600 })}>"{p.alias}"</td>
                  <td style={{ padding: "0 10px" }}>
                    <span
                      style={mono({
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 7,
                        fontSize: 10,
                        letterSpacing: ".08em",
                        color: ROLE_C[p.roleTier],
                      })}
                    >
                      <span
                        style={{
                          width: 7,
                          height: 7,
                          background: ROLE_C[p.roleTier],
                          clipPath: "polygon(0 0,100% 0,100% 65%,65% 100%,0 100%)",
                        }}
                      />
                      {p.role.toUpperCase()}
                    </span>
                  </td>
                  <td style={mono({ padding: "0 10px", fontSize: 11, color: "#98a4b3" })}>{p.phone}</td>
                  <td style={mono({ padding: "0 10px", fontSize: 10, color: "#5c6773" })}>{p.aadhaar}</td>
                  <td style={{ padding: "0 10px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
                      <div style={{ display: "flex", gap: 2, flex: 1, maxWidth: 80 }}>
                        {Array.from({ length: 10 }, (_, k) => (
                          <span key={k} style={{ height: 10, flex: 1, background: k < filledBars ? rc : "#161c25" }} />
                        ))}
                      </div>
                      <span style={mono({ fontSize: 10, fontWeight: 600, color: rc })}>{p.riskScore.toFixed(2)}</span>
                    </div>
                  </td>
                  <td style={{ padding: "0 10px" }}>
                    <span style={mono({ fontSize: 9, letterSpacing: ".12em", color: STATUS_C[p.status] })}>
                      {p.status.toUpperCase()}
                    </span>
                  </td>
                  <td style={{ padding: "0 10px", textAlign: "right" }}>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleOpenProfile(p);
                      }}
                      style={mono({
                        height: 24,
                        padding: "0 8px",
                        background: "rgba(232,193,90,0.1)",
                        border: "1px solid rgba(232,193,90,0.35)",
                        color: "#e8c15a",
                        fontSize: 9,
                        fontWeight: 600,
                        cursor: "pointer",
                      })}
                    >
                      OPEN →
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {/* Footer hint & pagination */}
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
          <span>DBL-CLICK ROW → OPEN DOSSIER</span>
          <span>PAGE 1/1 · {DEMO_PROFILES.length} RECORDS</span>
        </div>
      </div>
    </div>
  );
}
