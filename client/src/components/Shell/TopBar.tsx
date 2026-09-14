import type { AppRole } from "../../lib/roles";

// Top bar (M5-T4, design §6): global search (Ctrl+K), notifications
// bell, user avatar, role label. The search box opens the command
// palette; it performs no search of its own.

export function TopBar({
  role,
  email,
  onOpenPalette,
}: {
  role: AppRole;
  email: string;
  onOpenPalette: () => void;
}): JSX.Element {
  return (
    <header className="flex items-center gap-3 border-b border-neutral-800 bg-neutral-950 px-4 py-2 text-neutral-200">
      <button
        type="button"
        aria-label="Global search"
        onClick={onOpenPalette}
        className="w-96 truncate border border-neutral-700 bg-neutral-900 px-2 py-1 text-left text-sm text-neutral-500 hover:text-neutral-300"
      >
        Search people, cases, documents… (Ctrl+K)
      </button>
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
