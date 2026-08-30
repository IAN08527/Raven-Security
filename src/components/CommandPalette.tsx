import { useState, useEffect } from "react";
import { useCaseStore } from "../store/case";

interface CommandItem {
  id: string;
  category: "RECENT" | "FILE" | "VIEW" | "TOOLS";
  label: string;
  shortcut?: string;
  action: () => void;
}

export function CommandPalette() {
  const isOpen = useCaseStore((s) => s.commandPaletteOpen);
  const setIsOpen = useCaseStore((s) => s.setCommandPaletteOpen);
  const openTab = useCaseStore((s) => s.openTab);
  const setActiveNav = useCaseStore((s) => s.setActiveNav);

  const [search, setSearch] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);

  const commands: CommandItem[] = [
    {
      id: "macro-network",
      category: "RECENT",
      label: "Open Macro Network Graph",
      shortcut: "Ctrl+1",
      action: () => {
        setActiveNav("graph");
        openTab({ id: "tab-graph", type: "graph", title: "Macro Network" });
      },
    },
    {
      id: "profiles-directory",
      category: "RECENT",
      label: "Open Profiles Directory",
      shortcut: "Ctrl+P",
      action: () => {
        setActiveNav("profiles");
        openTab({ id: "tab-profiles-dir", type: "profiles-dir", title: "Profiles Directory" });
      },
    },
    {
      id: "cctv-monitor",
      category: "VIEW",
      label: "Switch to CCTV Live Monitor",
      shortcut: "Ctrl+2",
      action: () => {
        setActiveNav("cctv");
        openTab({ id: "tab-cctv", type: "vision", title: "CCTV Live Monitor - Cam 01" });
      },
    },
    {
      id: "audit-ledger",
      category: "VIEW",
      label: "Open Blockchain Audit Ledger",
      shortcut: "Ctrl+3",
      action: () => {
        setActiveNav("logs");
        openTab({ id: "tab-logs", type: "audit", title: "Audit Ledger" });
      },
    },
    {
      id: "profile-rakesh",
      category: "RECENT",
      label: "Open Profile: Rakesh Sawant",
      shortcut: "Ctrl+O",
      action: () => {
        openTab({
          id: "profile-0a5f9733-d8c7-5ea7-a36c-94fbba2ec332",
          type: "profile",
          title: "Profile: Rakesh Sawant",
          data: {
            entityId: "0a5f9733-d8c7-5ea7-a36c-94fbba2ec332",
            entityName: "Rakesh Sawant",
          },
        });
      },
    },
    {
      id: "profile-vikram",
      category: "FILE",
      label: "Open Profile: Vikram Patel",
      action: () => {
        openTab({
          id: "profile-8c35e396-4191-5369-9c5c-7ec65df27d5e",
          type: "profile",
          title: "Profile: Vikram Patel",
          data: {
            entityId: "8c35e396-4191-5369-9c5c-7ec65df27d5e",
            entityName: "Vikram Patel",
          },
        });
      },
    },
    {
      id: "detect-cctv",
      category: "TOOLS",
      label: "Run YOLOv8 CCTV Detection on Cam 01",
      action: () => {
        setActiveNav("cctv");
        openTab({ id: "tab-cctv", type: "vision", title: "CCTV Live Monitor - Cam 01" });
        useCaseStore.getState().triggerDetectAll();
      },
    },
  ];

  const filtered = commands.filter((cmd) =>
    cmd.label.toLowerCase().includes(search.toLowerCase())
  );

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setIsOpen(!isOpen);
      } else if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === "p") {
        e.preventDefault();
        setIsOpen(!isOpen);
      } else if (e.key === "Escape" && isOpen) {
        setIsOpen(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, setIsOpen]);

  if (!isOpen) return null;

  return (
    <div
      onClick={() => setIsOpen(false)}
      className="fixed inset-0 z-50 flex items-start justify-center bg-pd-base/80 backdrop-blur-sm pt-20 select-none animate-in fade-in duration-100"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-xl rounded-lg border border-pd-border bg-pd-surface shadow-2xl overflow-hidden animate-in zoom-in-95 duration-100"
      >
        {/* Search Input */}
        <div className="flex h-12 items-center border-b border-pd-border px-3 gap-2">
          <svg className="h-4 w-4 text-pd-text-tertiary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            autoFocus
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Type a command or search..."
            className="flex-1 bg-transparent text-pd-base text-pd-text-primary placeholder:text-pd-text-tertiary focus:outline-none"
          />
          <kbd className="font-mono text-[10px] bg-pd-elevated px-1.5 py-0.5 rounded text-pd-text-tertiary border border-pd-border">
            ESC
          </kbd>
        </div>

        {/* Results List */}
        <div className="max-h-80 overflow-y-auto p-1.5 space-y-1 text-pd-sm">
          {filtered.length === 0 ? (
            <div className="p-4 text-center text-pd-xs text-pd-text-tertiary">
              No matching commands found.
            </div>
          ) : (
            filtered.map((cmd, idx) => {
              const isSelected = idx === selectedIndex;
              return (
                <div
                  key={cmd.id}
                  onClick={() => {
                    cmd.action();
                    setIsOpen(false);
                  }}
                  className={`flex h-9 items-center justify-between rounded px-3 cursor-pointer transition-colors ${
                    isSelected
                      ? "bg-pd-accent/15 text-pd-accent font-medium"
                      : "text-pd-text-primary hover:bg-pd-elevated"
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-mono uppercase text-pd-text-tertiary bg-pd-elevated px-1 rounded">
                      {cmd.category}
                    </span>
                    <span>{cmd.label}</span>
                  </div>
                  {cmd.shortcut && (
                    <kbd className="font-mono text-[10px] text-pd-text-tertiary bg-pd-elevated px-1.5 py-0.5 rounded border border-pd-border/60">
                      {cmd.shortcut}
                    </kbd>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
