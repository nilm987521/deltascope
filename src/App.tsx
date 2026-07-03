import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  commitDiff,
  countMergeCommits,
  defaultBranch,
  listBranches,
  listBranchCommits,
  listMergeCommits,
  pickRepo,
} from "./git";
import { openPath } from "./sys";
import type { CommitDiff } from "./data-contract";
import {
  buildBranchRows,
  toContained,
  type BuiltData,
  type ContainedCommit,
  type Row,
} from "./rows";

const MINUS = "−"; // − : matches the design's deletion label glyph

type DateFilter = "all" | "7d" | "30d" | "90d";

const EMPTY: BuiltData = {
  rows: [],
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
  const [viewBranch, setViewBranch] = useState("");
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  // filters
  const [search, setSearch] = useState("");
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

  // diff view — overlays the list when a contained commit is opened
  const [diffCommit, setDiffCommit] = useState<ContainedCommit | null>(null);
  const [diffData, setDiffData] = useState<CommitDiff | null>(null);
  const [diffFile, setDiffFile] = useState(0);
  const [diffLoading, setDiffLoading] = useState(false);

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
  const loadBranch = useCallback(
    async (repo: string, branchName: string) => {
      const gen = ++loadGen.current;
      setLoading(true);
      try {
        const commits = await listBranchCommits(repo, branchName);
        const built = buildBranchRows(commits);
        setData(built);
        setSel(null);
        setContained({});
        setCounts({});
        setDiffCommit(null);
        setDiffData(null);
        // brought-in counts for the merge rows only
        const mergeHashes = built.rows
          .filter((r) => r.isMerge)
          .map((r) => r.id);
        if (mergeHashes.length) {
          countMergeCommits(repo, mergeHashes)
            .then((list) => {
              if (gen !== loadGen.current) return;
              setCounts(Object.fromEntries(list.map((c) => [c.hash, c.count])));
            })
            .catch(() => {});
        }
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
      // Load the repo's default branch (fallback: first branch) into the view.
      let def = "";
      try {
        def = (await defaultBranch(dir)).trim();
      } catch {
        /* detached / bare — fall through */
      }
      const brs = await listBranches(dir);
      setBranches(brs);
      const b = (def || brs[0] || "").trim();
      setViewBranch(b);
      if (b) {
        await loadBranch(dir, b);
      } else {
        setData(EMPTY);
      }
    } catch (e) {
      setFlashMsg(String(e), true);
    }
  }, [loadBranch, setFlashMsg]);

  const onRefresh = useCallback(async () => {
    if (!repoPath) return;
    setRefreshing(true);
    window.setTimeout(() => setRefreshing(false), 650);
    await loadBranch(repoPath, viewBranch);
    setFlashMsg("已重新讀取 · 剛剛");
  }, [repoPath, viewBranch, loadBranch, setFlashMsg]);

  const onViewBranch = useCallback(
    (b: string) => {
      setViewBranch(b);
      if (repoPath) loadBranch(repoPath, b);
    },
    [repoPath, loadBranch],
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

  const openDiff = useCallback(
    async (cc: ContainedCommit) => {
      if (!repoPath) return;
      setDiffCommit(cc);
      setDiffData(null);
      setDiffFile(0);
      setDiffLoading(true);
      try {
        const d = await commitDiff(repoPath, cc.hash);
        setDiffData(d);
      } catch (e) {
        setFlashMsg(String(e), true);
        setDiffCommit(null); // couldn't load — fall back to the list
      } finally {
        setDiffLoading(false);
      }
    },
    [repoPath, setFlashMsg],
  );

  const closeDiff = useCallback(() => {
    setDiffCommit(null);
    setDiffData(null);
  }, []);

  const openFile = useCallback(
    async (path: string) => {
      if (!repoPath) return;
      try {
        await openPath(repoPath, path);
      } catch (e) {
        setFlashMsg(String(e), true);
      }
    },
    [repoPath, setFlashMsg],
  );

  const openCommitDiff = useCallback(
    (row: Row) =>
      openDiff({
        hash: row.hash,
        msg: row.title,
        author: row.author ?? "",
        when: `${row.dateLabel} ${row.timeLabel}`,
        add: 0,
        del: 0,
      }),
    [openDiff],
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
          c.title.toLowerCase().includes(q) ||
          (c.author?.toLowerCase().includes(q) ?? false)
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
  }, [data, date, search, contained]);

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

  const repoName = repoPath ? basename(repoPath) : "—";
  const command = `git log --first-parent ${viewBranch}`.trim();
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
        <span className="app-name">DeltaScope</span>
        <span className="app-title">{repoName} — 分支歷史</span>
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
          <span className="lbl">檢視分支</span>
          <span className="arr">→</span>
          <select
            className="select"
            value={viewBranch}
            onChange={(e) => onViewBranch(e.target.value)}
            disabled={!hasRepo}
          >
            {branches.map((b) => (
              <option key={b} value={b}>
                {b}
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
      <div className="list-region">
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
            <span className="msg">沒有符合條件的 commit</span>
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
                    onClick={() => (c.isMerge ? onToggle(c) : openCommitDiff(c))}
                  >
                    <div className="node-col">
                      <div className="rail" />
                      <div className="node" style={{ background: c.node }} />
                    </div>
                    <div className="row-body">
                      <span className="caret">
                        {c.isMerge ? (isSel ? "▾" : "▸") : "●"}
                      </span>
                      <span className="hash">{c.hash}</span>
                      {c.isMerge && c.branchShort ? (
                        <span className="tag" style={c.tagStyle}>
                          {c.target
                            ? `${c.branchShort} → ${c.target}`
                            : c.branchShort}
                        </span>
                      ) : (
                        <span className="row-author">◍ {c.author}</span>
                      )}
                      {/* empty for merges: the target now lives in the tag; keep
                          the span so it still flex-fills and right-aligns the meta */}
                      <span className="title">{c.isMerge ? "" : c.title}</span>
                      {c.isMerge && (
                        <span
                          className={"commit-count" + (countKnown ? "" : " dim")}
                        >
                          {countKnown ? `${count} commits` : "· commits"}
                        </span>
                      )}
                      <span className="datetime">
                        {c.dateLabel} {c.timeLabel}
                      </span>
                    </div>
                  </div>
                  {isSel && c.isMerge && (
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
                              <div
                                className="cc-row"
                                key={x.hash + ":" + i}
                                title="檢視程式碼異動"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  openDiff(x);
                                }}
                              >
                                <span className="cc-hash">{x.hash}</span>
                                <span className="cc-msg">{x.msg}</span>
                                <span className="cc-author">◍ {x.author}</span>
                                <span className="cc-when">· {x.when}</span>
                                <span className="cc-stats">
                                  <span className="cc-add">+{x.add}</span>
                                  <span className="cc-del">
                                    {MINUS}
                                    {x.del}
                                  </span>
                                  <span className="cc-chev">›</span>
                                </span>
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

      {diffCommit && (
        <div className="diff-overlay">
          {/* diff header */}
          <div className="diff-header">
            <button className="diff-back" onClick={closeDiff}>
              ← 返回清單
            </button>
            <span className="diff-hash">{diffCommit.hash}</span>
            <span className="diff-msg">{diffCommit.msg}</span>
            <span className="diff-author">◍ {diffCommit.author}</span>
            <span className="diff-when">{diffCommit.when}</span>
            <div className="diff-stats">
              {diffData ? (
                <>
                  <span className="dh-files">
                    {diffData.files.length} 個檔案
                  </span>
                  <span className="dh-add">+{diffData.add}</span>
                  <span className="dh-del">
                    {MINUS}
                    {diffData.del}
                  </span>
                </>
              ) : (
                <span className="dh-files">載入中…</span>
              )}
            </div>
          </div>

          {/* diff body */}
          {diffLoading || !diffData ? (
            <div className="diff-loading">
              <span className="glyph">↻</span>
              <span>載入程式碼異動…</span>
            </div>
          ) : diffData.files.length === 0 ? (
            <div className="diff-loading">
              <span className="glyph">∅</span>
              <span>此 commit 沒有檔案異動（可能是合併節點）</span>
            </div>
          ) : (
            (() => {
              const fi = Math.min(diffFile, diffData.files.length - 1);
              const sf = diffData.files[fi];
              return (
                <div className="diff-body">
                  {/* file list */}
                  <div className="file-list">
                    <div className="file-list-label">變更的檔案</div>
                    {diffData.files.map((f, i) => (
                      <div
                        className={"file-row" + (i === fi ? " sel" : "")}
                        key={f.path + ":" + i}
                        title="雙擊以系統預設程式開啟"
                        onClick={() => setDiffFile(i)}
                        onDoubleClick={() => openFile(f.path)}
                      >
                        <span className="fstatus" data-status={f.status}>
                          {f.status}
                        </span>
                        <span className="fpath">{f.path}</span>
                        <span className="fadd">+{f.add}</span>
                        <span className="fdel">
                          {MINUS}
                          {f.del}
                        </span>
                      </div>
                    ))}
                  </div>

                  {/* diff pane */}
                  <div className="diff-pane">
                    <div className="diff-file-head">
                      <span className="dfh-path">{sf.path}</span>
                      <span className="dfh-add">+{sf.add}</span>
                      <span className="dfh-del">
                        {MINUS}
                        {sf.del}
                      </span>
                    </div>
                    {sf.binary ? (
                      <div className="diff-binary">二進位檔案，無法顯示差異</div>
                    ) : (
                      <div className="diff-lines">
                        {sf.lines.map((l, i) =>
                          l.kind === "hunk" ? (
                            <div className="hunk" key={i}>
                              <span className="hunk-gutter" />
                              <span className="hunk-text">{l.text}</span>
                            </div>
                          ) : (
                            <div className={"dline " + l.kind} key={i}>
                              <span className="ln-old">{l.oldNo ?? ""}</span>
                              <span className="ln-new">{l.newNo ?? ""}</span>
                              <span className="dtext">
                                {(l.kind === "add"
                                  ? "+ "
                                  : l.kind === "del"
                                    ? "- "
                                    : "  ") + l.text}
                              </span>
                            </div>
                          ),
                        )}
                      </div>
                    )}
                  </div>
                </div>
              );
            })()
          )}
        </div>
      )}
      </div>

      {/* status bar */}
      <div className="statusbar">
        <span className="dollar">$</span>
        <span>{command}</span>
        <span className="right">{filtered.length} commits</span>
      </div>
    </div>
  );
}
