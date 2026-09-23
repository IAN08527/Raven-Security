import { navItemsForRole, type AppRole } from "../../lib/roles";
import { logout } from "../../lib/session";

export type HealthState = "online" | "degraded" | "down";

export interface SidebarUser {
  badge: string;
  name: string;
  role: AppRole;
}

// Role-based shell sidebar (M5-T4, design §5, §33): items for other
// roles are removed from the DOM, never merely disabled. Active item:
// slightly elevated surface, subtle border, high-contrast text -- no
// large colored fills (§5.3). Active-state change: 120ms transition,
// nothing else animates (§25).

export function Sidebar({
  role,
  user,
  health,
  active,
  onNavigate,
}: {
  role: AppRole;
  user: SidebarUser;
  health: HealthState;
  active: string;
  onNavigate: (id: string) => void;
}): JSX.Element {
  const items = navItemsForRole(role);
  return (
    <nav aria-label="Primary" className="flex h-full w-44 flex-col border-r border-[#30302D] bg-[#1B1B19] text-[#E8E5DD]">
      <div className="px-3 py-3 text-sm font-semibold tracking-widest">RAVEN</div>
      <ul className="flex flex-col gap-0.5 px-2">
        {items.map((item) => (
          <li key={item.id}>
            <button
              type="button"
              onClick={() => onNavigate(item.id)}
              aria-current={item.id === active ? "page" : undefined}
              className={
                item.id === active
                  ? "w-full border border-neutral-600 bg-neutral-800 px-2 py-1 text-left text-sm text-neutral-50 transition-colors duration-[120ms]"
                  : "w-full border border-transparent px-2 py-1 text-left text-sm text-neutral-300 transition-colors duration-[120ms] hover:bg-neutral-800"
              }
            >
              {item.label}
            </button>
          </li>
        ))}
      </ul>
      <div className="mt-auto flex flex-col gap-2 px-3 py-3 text-xs text-neutral-400">
        <span data-testid="health-indicator">
          {health === "online" ? (
            <span>
              <span className="mr-1 inline-block h-2 w-2 rounded-full bg-green-500" /> System Online
            </span>
          ) : health === "degraded" ? (
            <span>
              <span className="mr-1 inline-block h-2 w-2 rounded-full bg-amber-500" /> Degraded
            </span>
          ) : (
            <span>
              <span className="mr-1 inline-block h-2 w-2 rounded-full bg-red-500" /> System Down
            </span>
          )}
        </span>
        <span>
          {user.badge} · {user.name} · {user.role}
        </span>
        <button type="button" onClick={logout} className="text-left text-neutral-400 hover:text-neutral-100">
          Sign out
        </button>
      </div>
    </nav>
  );
}
