import type { AppRole } from "../../lib/roles";

// Top bar (M5-T4, design §6): global search (Ctrl+K), notifications
// bell, user avatar, role label. Search is a placeholder input until
// the global-search endpoint lands; it performs no network call.

export function TopBar({ role, email }: { role: AppRole; email: string }): JSX.Element {
  return (
    <header className="flex items-center gap-3 border-b border-neutral-800 bg-neutral-950 px-4 py-2 text-neutral-200">
      <input
        aria-label="Global search"
        type="search"
        placeholder="Search people, cases, documents… (Ctrl+K)"
        className="w-96 border border-neutral-700 bg-neutral-900 px-2 py-1 text-sm"
      />
      <span className="ml-auto text-sm text-neutral-400" aria-label="Notifications">
        Notifications
      </span>
      <span className="flex h-7 w-7 items-center justify-center border border-neutral-700 bg-neutral-800 text-xs" aria-label="User avatar">
        {email.slice(0, 1).toUpperCase()}
      </span>
      <span className="border border-neutral-700 px-1.5 py-0.5 text-xs text-neutral-300">{role}</span>
    </header>
  );
}
