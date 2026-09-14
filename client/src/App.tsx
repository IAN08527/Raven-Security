import { useEffect, useState } from "react";
import { LoginScreen } from "./components/Auth/LoginScreen";
import { AuditPane } from "./components/Audit/AuditPane";
import { HomeDashboard } from "./components/Home/HomeDashboard";
import { IngestionScreen } from "./components/Ingestion/IngestionScreen";
import { ReviewScreen } from "./components/Review/ReviewScreen";
import { Sidebar, type HealthState } from "./components/Shell/Sidebar";
import { TopBar } from "./components/Shell/TopBar";
import { getSession, subscribeSession, type Session } from "./lib/session";

// Role-based shell (M5-T4, design §5): persistent sidebar with
// role-filtered nav, top bar with search + role label, user badge and
// health indicator at the sidebar bottom. Unsigned users see only the
// login screen (design screen 01). Screen changes fade 180ms via the
// View Transitions API with a no-op fallback (design §25).

function healthOf(report: { dependencies?: { healthy?: boolean }[] } | null): HealthState {
  if (!report) {
    return "down";
  }
  const deps = report.dependencies ?? [];
  if (deps.length === 0) {
    return "down";
  }
  if (deps.every((dep) => dep.healthy)) {
    return "online";
  }
  return "degraded";
}

function navigateWithFade(setActive: (id: string) => void, id: string): void {
  const doc = document as Document & {
    startViewTransition?: (update: () => void) => void;
  };
  if (doc.startViewTransition) {
    doc.startViewTransition(() => setActive(id));
  } else {
    setActive(id);
  }
}

export function App(): JSX.Element {
  const [session, setSession] = useState<Session | null>(() => getSession());
  const [active, setActive] = useState("home");
  const [health, setHealth] = useState<HealthState>("down");
  const [caseId, setCaseId] = useState("");
  const [reviewCaseId, setReviewCaseId] = useState("");

  useEffect(() => subscribeSession(() => setSession(getSession())), []);

  useEffect(() => {
    if (!session) {
      return;
    }
    let cancelled = false;
    const base =
      (import.meta as unknown as { env?: Record<string, string> }).env?.VITE_SERVER_URL ??
      "https://localhost:8443";
    fetch(`${base.replace(/\/$/, "")}/v1/health`)
      .then((response) => (response.ok ? response.json() : null))
      .then((report) => {
        if (!cancelled) {
          setHealth(healthOf(report));
        }
      })
      .catch(() => {
        if (!cancelled) {
          setHealth("down");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [session]);

  if (!session) {
    return <LoginScreen onSignedIn={() => setSession(getSession())} />;
  }

  const go = (id: string): void => navigateWithFade(setActive, id);

  return (
    <div className="flex h-screen bg-neutral-950 text-neutral-100">
      <Sidebar
        role={session.role}
        user={{ badge: session.userId.slice(0, 8), name: session.email, role: session.role }}
        health={health}
        active={active}
        onNavigate={go}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar role={session.role} email={session.email} />
        <main className="min-h-0 flex-1 overflow-auto">
          {active === "home" ? (
            <HomeDashboard onNavigate={go} />
          ) : active === "ingestion" ? (
            <IngestionScreen
              onOpenReview={(id) => {
                setReviewCaseId(id);
                go("review");
              }}
            />
          ) : active === "review" ? (
            <ReviewScreen caseId={reviewCaseId} />
          ) : active === "audit" ? (
            caseId ? (
              <AuditPane caseId={caseId} />
            ) : (
              <div className="flex flex-col gap-2 p-4 text-sm text-neutral-400">
                <p>Select a case to review its audit log.</p>
                <label className="flex flex-col gap-1">
                  Case id
                  <input
                    aria-label="Case id"
                    type="text"
                    placeholder="00000000-0000-0000-0000-000000000000"
                    className="w-80 border border-neutral-700 bg-neutral-900 px-2 py-1 text-neutral-100"
                    onChange={(event) => setCaseId(event.target.value.trim())}
                  />
                </label>
              </div>
            )
          ) : (
            <p className="p-4 text-sm text-neutral-400">
              {active} workspace (role: {session.role}).
            </p>
          )}
        </main>
      </div>
    </div>
  );
}
