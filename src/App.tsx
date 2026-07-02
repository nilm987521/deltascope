import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  countMergeCommits,
  defaultBranch,
  listBranches,
  listMergeCommits,
  listMerges,
  pickRepo,
} from "./git";
import {
  buildRows,
  toContained,
  type BuiltData,
  type ContainedCommit,
  type Option,
  type Row,
} from "./rows";

type TypeFilter = "all" | "feature" | "hotfix";
type DateFilter = "all" | "7d" | "30d" | "90d";

const EMPTY: BuiltData = {
  rows: [],
  branchOptions: [{ value: "all", label: "全部分支 (0)" }],
  dateOptions: [
    { value: "all", label: "全部時間" },
    { value: "7d", label: "近 7 天" },
    { value: "30d", label: "近 30 天" },
    { value: "90d", label: "近 90 天" },
  ],
  maxDateMs: 0,
  totalCount: 0,
};

const DAY = 86_400_000;

// Collapse the home directory to ~ for a tidier path button.
function tildify(p: string): string {
  const home = "/Users/"; // best-effort; keeps full path if it doesn't match
  if (p.startsWith(home)) {
    const rest = p.slice(home.length);
    const slash = rest.indexOf("/");
    if (slash >= 0) return "~" + rest.slice(slash);
  }
  return p;
}
const basename = (p: string) => p.split("/").filter(Boolean).pop() || p;

export default function App() {
  // repo / data
  const [repoPath, setRepoPath] = useState<string | null>(null);
  const [data, setData] = useState<BuiltData>(EMPTY);
  const [branches, setBranches] = useState<string[]>([]);
  const [target, setTarget] = useState("");
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  // filters
  const [search, setSearch] = useState("");
  const [branch, setBranch] = useState("all");
  const [type, setType] = useState<TypeFilter>("all");
  const [date, setDate] = useState<DateFilter>("all");

  // expansion + lazily-loaded contained commits
  const [sel, setSel] = useState<string | null>(null);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [contained, setContained] = useState<Record<string, ContainedCommit[]>>(
    {},
  );
  const [loadingCommits, setLoadingCommits] = useState<Record<string, boolean>>(
    {},
  );

  // flash message
  const [flash, setFlash] = useState<{ msg: string; err: boolean } | null>(
    null,
  );
  const flashTimer = useRef<number | undefined>(undefined);
  const loadGen = useRef(0); // guards stale background count results

  const setFlashMsg = useCallback((msg: string, err = false) => {
    setFlash({ msg, err });
    window.clearTimeout(flashTimer.current);
    flashTimer.current = window.setTimeout(() => setFlash(null), 2400);
  }, []);

  // ---- data loading ----
  const load = useCallback(
    async (repo: string, targetToUse?: string) => {
      const gen = ++loadGen.current;
      setLoading(true);
      try {
        let def = "";
        try {
          def = await defaultBranch(repo);
        } catch {
          /* detached / bare — fall through */
        }
        const brs = await listBranches(repo);
        const tgt = (targetToUse ?? (def || brs[0] || "")).trim();
        const merges = await listMerges(repo, tgt);
        setBranches(brs);
        setTarget(tgt);
        setData(buildRows(merges));
        setSel(null);
        setContained({});
        setCounts({});
        // Fill in per-merge commit counts in the background — the list is already visible.
        countMergeCommits(
          repo,
          merges.map((m) => m.hash),
        )
          .then((list) => {
            if (gen !== loadGen.current) return; // a newer load superseded this one
            setCounts(Object.fromEntries(list.map((c) => [c.hash, c.count])));
          })
          .catch(() => {});
      } catch (e) {
        setData(EMPTY);
        setFlashMsg(String(e), true);
      } finally {
        setLoading(false);
      }
    },
    [setFlashMsg],
  );

  const onPick = useCallback(async () => {
    try {
      const dir = await pickRepo();
      if (!dir) return;
      setRepoPath(dir);
      await load(dir);
    } catch (e) {
      setFlashMsg(String(e), true);
    }
  }, [load, setFlashMsg]);

  const onRefresh = useCallback(async () => {
    if (!repoPath) return;
    setRefreshing(true);
    window.setTimeout(() => setRefreshing(false), 650);
    await load(repoPath, target);
    setFlashMsg("已重新讀取 · 剛剛");
  }, [repoPath, target, load, setFlashMsg]);

  const onTarget = useCallback(
    async (v: string) => {
      if (!repoPath) return;
      setTarget(v);
      await load(repoPath, v); // range changes → re-fetch
    },
    [repoPath, load],
  );

  const onToggle = useCallback(
    async (row: Row) => {
      const opening = sel !== row.id;
      setSel(opening ? row.id : null);
      if (opening && !contained[row.id] && repoPath) {
        setLoadingCommits((m) => ({ ...m, [row.id]: true }));
        try {
          const commits = await listMergeCommits(repoPath, row.id);
          setContained((m) => ({ ...m, [row.id]: commits.map(toContained) }));
        } catch (e) {
          setContained((m) => ({ ...m, [row.id]: [] }));
          setFlashMsg(String(e), true);
        } finally {
          setLoadingCommits((m) => ({ ...m, [row.id]: false }));
        }
      }
    },
    [sel, contained, repoPath, setFlashMsg],
  );

  // window controls (custom titlebar — decorations are off)
  const win = useMemo(() => {
    try {
      return getCurrentWindow();
    } catch {
      return null;
    }
  }, []);

  useEffect(() => () => window.clearTimeout(flashTimer.current), []);

  // ---- filtering (pure frontend, matches prototype renderVals) ----
  const filtered = useMemo(() => {
    let list = data.rows;
    if (type !== "all")
      list = list.filter((c) => (type === "hotfix" ? c.isHotfix : !c.isHotfix));
    if (branch !== "all") list = list.filter((c) => c.branch === branch);
    if (date !== "all") {
      const days = { "7d": 7, "30d": 30, "90d": 90 }[date];
      const cutoff = data.maxDateMs - days * DAY;
      list = list.filter((c) => c.dateMs >= cutoff);
    }
    const q = search.trim().toLowerCase();
    if (q) {
      list = list.filter((c) => {
        if (
          c.hash.includes(q) ||
          c.branch.toLowerCase().includes(q) ||
          c.title.toLowerCase().includes(q)
        )
          return true;
        const cc = contained[c.id];
        return (
          !!cc &&
          cc.some(
            (x) =>
              x.msg.toLowerCase().includes(q) ||
              x.author.toLowerCase().includes(q),
          )
        );
      });
    }
    return list;
  }, [data, type, branch, date, search, contained]);

  // virtualized list — only the visible rows are in the DOM. Dynamic row height
  // (rows grow when expanded) is handled via measureElement.
  const listRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: filtered.length,
    getScrollElement: () => listRef.current,
    estimateSize: () => 43, // ~row height; corrected by measureElement
    getItemKey: (i) => filtered[i].id, // keep measurements tied to the merge, not the index
    overscan: 10,
  });
  const virtualItems = virtualizer.getVirtualItems();

  const targetOptions: Option[] = useMemo(() => {
    const opts = branches.map((b) => ({ value: b, label: b }));
    if (target && !branches.includes(target))
      opts.unshift({ value: target, label: target });
    return opts;
  }, [branches, target]);

  const repoName = repoPath ? basename(repoPath) : "—";
  const command = `git log --merges --first-parent --oneline ${target}`.trim();
  const branchCount = data.branchOptions.length - 1;
  const hasRepo = repoPath !== null;

  return (
    <div className="app">
      {/* titlebar */}
      <div className="titlebar" data-tauri-drag-region>
        <div className="dots">
          <span className="dot r" title="關閉" onClick={() => win?.close()} />
          <span
            className="dot y"
            title="最小化"
            onClick={() => win?.minimize()}
          />
          <span
            className="dot g"
            title="縮放"
            onClick={() => win?.toggleMaximize()}
          />
        </div>
        <span className="app-name">MergeScope</span>
        <span className="app-title">{repoName} — 合併歷史</span>
        <span className="spacer" />
      </div>

      {/* toolbar */}
      <div className="toolbar">
        <button className="btn" onClick={onPick}>
          <span className="folder-ico" />
          <span className="path">
            {repoPath ? tildify(repoPath) : "選擇 Git repository"}
          </span>
          <span className="caret-dn">▾</span>
        </button>
        <button
          className="btn-icon"
          title="重新整理"
          onClick={onRefresh}
          disabled={!hasRepo}
        >
          <span className={"refresh-ico" + (refreshing ? " spinning" : "")}>
            ↻
          </span>
        </button>
        {flash && (
          <span className={"flash" + (flash.err ? " err" : "")}>
            {flash.msg}
          </span>
        )}
        <div className="target-wrap">
          <span className="lbl">目標分支</span>
          <span className="arr">→</span>
          <select
            className="select"
            value={target}
            onChange={(e) => onTarget(e.target.value)}
            disabled={!hasRepo}
          >
            {targetOptions.length === 0 && <option value="">—</option>}
            {targetOptions.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* filter bar */}
      <div className="filterbar">
        <div className="search">
          <span className="search-ico" />
          <input
            className="search-input"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="搜尋分支、訊息、作者、hash…"
          />
        </div>
        <div className="seg">
          <button
            className={"seg-btn" + (type === "all" ? " active" : "")}
            onClick={() => setType("all")}
          >
            全部
          </button>
          <button
            className={"seg-btn" + (type === "feature" ? " active" : "")}
            onClick={() => setType("feature")}
          >
            feature
          </button>
          <button
            className={"seg-btn" + (type === "hotfix" ? " active" : "")}
            onClick={() => setType("hotfix")}
          >
            hotfix
          </button>
        </div>
        <select
          className="select-sm select-branch"
          value={branch}
          onChange={(e) => setBranch(e.target.value)}
        >
          {data.branchOptions.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <select
          className="select-sm"
          value={date}
          onChange={(e) => setDate(e.target.value as DateFilter)}
        >
          {data.dateOptions.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <div className="result-count">
          顯示 <b>{filtered.length}</b> / {data.totalCount}
        </div>
      </div>

      {/* list */}
      <div className="list" ref={listRef}>
        {!hasRepo ? (
          <div className="empty">
            <span className="glyph">⑂</span>
            <span className="msg">選擇一個 Git repository 開始</span>
            <button className="btn pick" onClick={onPick}>
              <span className="folder-ico" />
              <span className="path">選擇資料夾…</span>
            </button>
          </div>
        ) : loading ? (
          <div className="empty">
            <span
              className="glyph"
              style={{ animation: "spin 0.8s linear infinite" }}
            >
              ↻
            </span>
            <span className="msg">讀取中…</span>
          </div>
        ) : filtered.length === 0 ? (
          <div className="empty">
            <span className="glyph">∅</span>
            <span className="msg">沒有符合條件的合併</span>
          </div>
        ) : (
          <div
            style={{
              height: virtualizer.getTotalSize(),
              position: "relative",
              width: "100%",
            }}
          >
            {virtualItems.map((vi) => {
              const c = filtered[vi.index];
              const isSel = sel === c.id;
              const cc = contained[c.id];
              const isLoadingCC = loadingCommits[c.id];
              // exact count once expanded; otherwise the background-loaded count
              const count = cc?.length ?? counts[c.id];
              const countKnown = count !== undefined;
              return (
                <div
                  key={vi.key}
                  data-index={vi.index}
                  ref={virtualizer.measureElement}
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    width: "100%",
                    transform: `translateY(${vi.start}px)`,
                  }}
                >
                  <div
                    className={"row" + (isSel ? " sel" : "")}
                    onClick={() => onToggle(c)}
                  >
                    <div className="node-col">
                      <div className="rail" />
                      <div className="node" style={{ background: c.node }} />
                    </div>
                    <div className="row-body">
                      <span className="caret">{isSel ? "▾" : "▸"}</span>
                      <span className="hash">{c.hash}</span>
                      <span className="tag" style={c.tagStyle}>
                        {c.branchShort}
                      </span>
                      <span className="title">{c.title}</span>
                      <span
                        className={"commit-count" + (countKnown ? "" : " dim")}
                      >
                        {countKnown ? `${count} commits` : "· commits"}
                      </span>
                      <span className="datetime">
                        {c.dateLabel} {c.timeLabel}
                      </span>
                    </div>
                  </div>
                  {isSel && (
                    <div className="expand">
                      <div className="node-col">
                        <div className="rail" />
                      </div>
                      <div className="expand-body">
                        <div className="expand-head">
                          <span style={{ color: c.node }}>└─</span>
                          {isLoadingCC ? (
                            <span className="expand-loading">
                              載入內含 commit…
                            </span>
                          ) : (
                            <>
                              此合併帶進 <b>{cc?.length ?? 0}</b> 個 commit
                            </>
                          )}
                          <span className="range">
                            · git log {c.hash}^1..^2
                          </span>
                        </div>
                        {cc && cc.length > 0 && (
                          <div
                            className="contained"
                            style={{ borderColor: c.node }}
                          >
                            {cc.map((x, i) => (
                              <div className="cc-row" key={x.hash + ":" + i}>
                                <span className="cc-hash">{x.hash}</span>
                                <span className="cc-msg">{x.msg}</span>
                                <span className="cc-author">◍ {x.author}</span>
                                <span className="cc-when">· {x.when}</span>
                              </div>
                            ))}
                          </div>
                        )}
                        {cc && cc.length === 0 && !isLoadingCC && (
                          <div
                            className="contained"
                            style={{ borderColor: c.node }}
                          >
                            <div className="cc-row">
                              <span className="cc-when">
                                （此合併沒有第二父，或為 fast-forward —
                                無內含 commit）
                              </span>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* status bar */}
      <div className="statusbar">
        <span className="dollar">$</span>
        <span>{command}</span>
        <span className="right">
          {filtered.length} merges · {branchCount} branches
        </span>
      </div>
    </div>
  );
}
