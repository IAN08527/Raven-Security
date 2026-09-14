import { useState } from "react";
import { CameraSettings } from "./CameraSettings";
import { SystemHealth } from "./SystemHealth";
import { UserManagement } from "./UserManagement";

type Section = "Cameras" | "Users" | "Health";

const SECTIONS: Section[] = ["Cameras", "Users", "Health"];

/**
 * Screens 14–16. Settings and administration (design §19, FR-8).
 * Admin role only — the shell hides this screen from other roles and
 * the server rejects them. Sections share one shell because they are
 * all platform administration, not case content.
 */
export function AdminSettings(): JSX.Element {
  const [section, setSection] = useState<Section>("Cameras");
  return (
    <div className="flex h-full w-full flex-col gap-4 p-6">
      <header>
        <h1 className="text-2xl text-neutral-50">Settings &amp; Administration</h1>
        <p className="text-sm text-neutral-400">
          Platform management. Case content is never shown here.
        </p>
      </header>
      <div className="flex shrink-0 gap-1 border-b border-neutral-800" role="tablist" aria-label="Admin sections">
        {SECTIONS.map((name) => (
          <button
            key={name}
            type="button"
            role="tab"
            aria-selected={section === name}
            onClick={() => setSection(name)}
            className={`rounded-t-sm px-2.5 py-1.5 text-xs font-semibold ${
              section === name ? "bg-neutral-800 text-neutral-50" : "text-neutral-500 hover:text-neutral-300"
            }`}
          >
            {name}
          </button>
        ))}
      </div>
      <div key={section} className="min-h-0 flex-1 overflow-y-auto motion-safe:animate-fade-in">
        {section === "Cameras" && <CameraSettings />}
        {section === "Users" && <UserManagement />}
        {section === "Health" && <SystemHealth />}
      </div>
    </div>
  );
}
