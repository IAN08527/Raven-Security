import { useState } from "react";
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

export function ProfilesDirectoryPane() {
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const openTab = useCaseStore((s) => s.openTab);

  const filtered = DEMO_PROFILES.filter((p) => {
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

  return (
    <div className="flex h-full flex-col bg-pd-base text-pd-text-primary p-4 overflow-y-auto">
      {/* Top Search & Filter Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-pd-border">
        <div className="flex flex-wrap items-center gap-2.5 flex-1 min-w-[300px]">
          {/* Search Input */}
          <div className="relative flex-1 min-w-[280px] max-w-md">
            <svg
              className="absolute left-2.5 top-2.5 h-4 w-4 text-pd-text-tertiary"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by Name, Alias, Aadhaar, Phone, Vehicle..."
              className="h-8.5 w-full rounded-sm border border-pd-border bg-pd-surface pl-8 pr-3 text-pd-base text-pd-text-primary placeholder:text-pd-text-tertiary focus:border-pd-accent focus:outline-none"
            />
          </div>

          {/* Role Filter */}
          <select
            value={roleFilter}
            onChange={(e) => setRoleFilter(e.target.value)}
            className="h-8.5 rounded-sm border border-pd-border bg-pd-surface px-2.5 text-pd-sm text-pd-text-secondary focus:border-pd-accent focus:outline-none"
          >
            <option value="all">All Roles</option>
            <option value="leader">Syndicate Leader</option>
            <option value="operator">Hawala / Operator</option>
            <option value="logistics">Logistics</option>
            <option value="mule">Money Mule</option>
            <option value="associate">Associate</option>
          </select>

          {/* Status Filter */}
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="h-8.5 rounded-sm border border-pd-border bg-pd-surface px-2.5 text-pd-sm text-pd-text-secondary focus:border-pd-accent focus:outline-none"
          >
            <option value="all">All Statuses</option>
            <option value="Active Suspect">Active Suspect</option>
            <option value="Under Watch">Under Watch</option>
            <option value="Detained">Detained</option>
          </select>

          <span className="text-pd-xs text-pd-text-tertiary">
            Showing {filtered.length} of {DEMO_PROFILES.length} Profiles
          </span>
        </div>

        {/* Action Button */}
        <button
          onClick={() => alert("Create Profile modal: Ingest FIR / NAFIS match")}
          className="flex h-8 items-center gap-1.5 rounded-sm bg-pd-accent px-3 text-pd-sm font-medium text-pd-base hover:bg-pd-accent-hover transition-colors shadow-sm"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          New Profile
        </button>
      </div>

      {/* Profiles Data Table */}
      <div className="mt-4 flex-1 rounded-sm border border-pd-border bg-pd-surface overflow-hidden flex flex-col">
        <div className="overflow-x-auto flex-1">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="h-8 border-b border-pd-border bg-pd-elevated text-pd-xs uppercase tracking-wider text-pd-text-secondary select-none">
                <th className="px-3 py-1 font-semibold w-12 text-center">Avatar</th>
                <th className="px-3 py-1 font-semibold">Name</th>
                <th className="px-3 py-1 font-semibold">Primary Alias</th>
                <th className="px-3 py-1 font-semibold">Role / Syndicate Tier</th>
                <th className="px-3 py-1 font-semibold font-mono">Aadhaar / ID</th>
                <th className="px-3 py-1 font-semibold">Connected Cases</th>
                <th className="px-3 py-1 font-semibold">Risk Score</th>
                <th className="px-3 py-1 font-semibold text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-pd-border/40 text-pd-sm">
              {filtered.map((p) => (
                <tr
                  key={p.id}
                  onDoubleClick={() => handleOpenProfile(p)}
                  className="h-10 hover:bg-pd-elevated/70 transition-colors cursor-pointer group"
                >
                  <td className="px-3 py-1 text-center">
                    <div className="mx-auto flex h-6 w-6 items-center justify-center rounded-full bg-pd-accent/15 text-[10px] font-bold text-pd-accent border border-pd-accent/30">
                      {p.name.substring(0, 2).toUpperCase()}
                    </div>
                  </td>
                  <td className="px-3 py-1 font-medium text-pd-text-primary group-hover:text-pd-accent transition-colors">
                    {p.name}
                  </td>
                  <td className="px-3 py-1 text-pd-text-secondary italic">
                    "{p.alias}"
                  </td>
                  <td className="px-3 py-1">
                    <span
                      className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium ${
                        p.roleTier === "leader"
                          ? "bg-pd-danger/15 text-pd-danger border border-pd-danger/30"
                          : p.roleTier === "operator"
                          ? "bg-pd-warning/15 text-pd-warning border border-pd-warning/30"
                          : p.roleTier === "logistics"
                          ? "bg-pd-accent/15 text-pd-accent border border-pd-accent/30"
                          : "bg-pd-surface text-pd-text-secondary border border-pd-border"
                      }`}
                    >
                      {p.role}
                    </span>
                  </td>
                  <td className="px-3 py-1 font-mono text-pd-xs text-pd-text-tertiary">
                    {p.aadhaar}
                  </td>
                  <td className="px-3 py-1 text-pd-text-secondary font-mono text-pd-xs">
                    {p.cases}
                  </td>
                  <td className="px-3 py-1">
                    <span
                      className={`font-mono text-pd-xs font-semibold ${
                        p.riskLevel === "HIGH"
                          ? "text-pd-danger"
                          : p.riskLevel === "MED"
                          ? "text-pd-warning"
                          : "text-pd-success"
                      }`}
                    >
                      {p.riskScore.toFixed(2)} {p.riskLevel}
                    </span>
                  </td>
                  <td className="px-3 py-1 text-right">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleOpenProfile(p);
                      }}
                      className="inline-flex items-center gap-1 rounded border border-pd-border bg-pd-elevated px-2 py-1 text-pd-xs font-medium text-pd-accent hover:border-pd-accent hover:bg-pd-accent/10 transition-colors"
                    >
                      Open Profile
                      <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                      </svg>
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Footer Hint & Pagination */}
        <div className="flex items-center justify-between border-t border-pd-border bg-pd-elevated px-3 py-2 text-pd-xs text-pd-text-tertiary">
          <span className="italic">Tip: Double-click any suspect row to open their dedicated Profile tab.</span>
          <div className="flex items-center gap-2">
            <span>1-6 of {DEMO_PROFILES.length}</span>
            <button className="rounded px-1.5 py-0.5 border border-pd-border bg-pd-surface hover:bg-pd-elevated disabled:opacity-40" disabled>
              Prev
            </button>
            <button className="rounded px-1.5 py-0.5 border border-pd-border bg-pd-surface hover:bg-pd-elevated disabled:opacity-40" disabled>
              Next
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
