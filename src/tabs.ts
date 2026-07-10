// Multi-repo tab model + persistence.
//
// Each open repo is a Tab. The tab's transient per-repo state (loaded history,
// filters, selection, diff/merge drill) lives inside its <RepoWorkspace>; only
// the identity we need to restore across restarts is stored here: repoPath, the
// chosen target branch, and a stable identity color.

export interface Tab {
  id: string;
  repoPath: string;
  viewBranch: string; // "" until the workspace resolves/loads a branch
  color: string; // dot / active-border color (oklch)
}

const STORAGE_KEY = "deltascope.tabs";
const LEGACY_LAST_REPO = "deltascope.lastRepo"; // pre-tabs single-repo key
const SCHEMA_VERSION = 1;

// Distinct identity hues, reused from the rows.ts oklch node palette family.
const PALETTE = [
  "oklch(0.72 0.14 150)", // green
  "oklch(0.7 0.13 250)", // blue
  "oklch(0.7 0.14 300)", // purple
  "oklch(0.74 0.14 60)", // orange
  "oklch(0.7 0.15 25)", // red
  "oklch(0.72 0.12 190)", // teal
  "oklch(0.72 0.13 350)", // pink
  "oklch(0.76 0.13 90)", // yellow
];

// Pick a color not currently in use; fall back to cycling by count.
export function pickColor(used: string[]): string {
  const free = PALETTE.find((c) => !used.includes(c));
  return free ?? PALETTE[used.length % PALETTE.length];
}

export function newTabId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `t${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
  }
}

export function makeTab(repoPath: string, used: string[], viewBranch = ""): Tab {
  return { id: newTabId(), repoPath, viewBranch, color: pickColor(used) };
}

interface PersistShape {
  version: number;
  activeId: string | null;
  tabs: Tab[];
}

function isTab(v: unknown): v is Tab {
  if (!v || typeof v !== "object") return false;
  const t = v as Record<string, unknown>;
  return (
    typeof t.id === "string" &&
    typeof t.repoPath === "string" &&
    typeof t.viewBranch === "string" &&
    typeof t.color === "string"
  );
}

// Load persisted tabs. Migrates the pre-tabs `deltascope.lastRepo` into a single
// tab on first run, then drops the legacy key so migration happens only once.
export function loadTabs(): { tabs: Tab[]; activeId: string | null } {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as PersistShape;
      const tabs = Array.isArray(parsed.tabs) ? parsed.tabs.filter(isTab) : [];
      const activeId =
        typeof parsed.activeId === "string" &&
        tabs.some((t) => t.id === parsed.activeId)
          ? parsed.activeId
          : (tabs[0]?.id ?? null);
      return { tabs, activeId };
    }
  } catch {
    // corrupt / unavailable — fall through to migration/empty
  }

  // Migration: seed one tab from the old single-repo key.
  try {
    const last = localStorage.getItem(LEGACY_LAST_REPO);
    if (last) {
      const tab = makeTab(last, []);
      saveTabs([tab], tab.id);
      localStorage.removeItem(LEGACY_LAST_REPO);
      return { tabs: [tab], activeId: tab.id };
    }
  } catch {
    // ignore migration failure
  }

  return { tabs: [], activeId: null };
}

export function saveTabs(tabs: Tab[], activeId: string | null): void {
  try {
    const payload: PersistShape = { version: SCHEMA_VERSION, activeId, tabs };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // ignore persistence failure
  }
}
