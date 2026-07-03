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
import DeletedFilesView from "./DeletedFilesView";
import RenamedFilesView from "./RenamedFilesView";
import MergeView, { type MergeFrame } from "./MergeView";
import ContainedRow from "./ContainedRow";
import type { CommitDiff } from "./data-contract";
import {
  branchColors,
  buildBranchRows,
  toContained,
  type BuiltData,
  type ContainedCommit,
  type Row,
} from "./rows";
import { useI18n, type Lang } from "./i18n";

const MINUS = "−"; // − : matches the design's deletion label glyph

type DateFilter = "all" | "7d" | "30d" | "90d";

const EMPTY: BuiltData = {
  rows: [],
  dateOptions: [
    { value: "all", labelKey: "filter.all" },
    { value: "7d", labelKey: "filter.last7d" },
    { value: "30d", labelKey: "filter.last30d" },
    { value: "90d", labelKey: "filter.last90d" },
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
  const { lang, setLang, t } = useI18n();

  // repo / data
  const [repoPath, setRepoPath] = useState<string | null>(null);
  const [data, setData] = useState<BuiltData>(EMPTY);
  const [branches, setBranches] = useState<string[]>([]);
  const [viewBranch, setViewBranch] = useState("");
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  // which screen is showing: branch history / deleted files / renamed files
  const [view, setView] = useState<"branches" | "deleted" | "renamed">(
    "branches",
  );
  const [deletedNonce, setDeletedNonce] = useState(0); // bumps to reload deleted view
  const [renamedNonce, setRenamedNonce] = useState(0); // bumps to reload renamed view

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

  // full-screen merge view: drill stack (empty = closed)
  const [mergeStack, setMergeStack] = useState<MergeFrame[]>([]);

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
        setMergeStack([]);
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
    if (view === "deleted") {
      setDeletedNonce((n) => n + 1);
    } else if (view === "renamed") {
      setRenamedNonce((n) => n + 1);
    } else {
      await loadBranch(repoPath, viewBranch);
    }
    setFlashMsg(t("status.reloaded"));
  }, [repoPath, view, viewBranch, loadBranch, setFlashMsg]);

  const onViewBranch = useCallback(
    (b: string) => {
      setViewBranch(b);
      if (repoPath) loadBranch(repoPath, b);
    },
    [repoPath, loadBranch],
  );

  // Lazily fetch + cache a merge's brought-in commits, keyed by full hash.
  const ensureContained = useCallback(
    async (fullHash: string) => {
      if (contained[fullHash] || !repoPath) return;
      setLoadingCommits((m) => ({ ...m, [fullHash]: true }));
      try {
        const commits = await listMergeCommits(repoPath, fullHash);
        setContained((m) => ({ ...m, [fullHash]: commits.map(toContained) }));
      } catch (e) {
        setContained((m) => ({ ...m, [fullHash]: [] }));
        setFlashMsg(String(e), true);
      } finally {
        setLoadingCommits((m) => ({ ...m, [fullHash]: false }));
      }
    },
    [contained, repoPath, setFlashMsg],
  );

  const onToggle = useCallback(
    (row: Row) => {
      const opening = sel !== row.id;
      setSel(opening ? row.id : null);
      if (opening) ensureContained(row.id);
    },
    [sel, ensureContained],
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
        fullHash: row.id,
        msg: row.title,
        author: row.author ?? "",
        when: `${row.dateLabel} ${row.timeLabel}`,
        add: 0,
        del: 0,
        isMerge: row.isMerge,
        branchShort: row.branchShort,
        target: row.target,
      }),
    [openDiff],
  );

  const frameFromRow = useCallback(
    (r: Row): MergeFrame => ({
      fullHash: r.id,
      shortHash: r.hash,
      name: r.branchShort || r.hash,
      node: r.node,
      tagStyle: r.tagStyle,
    }),
    [],
  );

  const frameFromContained = useCallback((cc: ContainedCommit): MergeFrame => {
    const { node, tagStyle } = branchColors(cc.branchShort);
    return {
      fullHash: cc.fullHash,
      shortHash: cc.hash,
      name: cc.branchShort || cc.hash,
      node,
      tagStyle,
    };
  }, []);

  // open a top-level merge full-screen (double-click on a merge row)
  const openMergeView = useCallback(
    (row: Row) => {
      setMergeStack([frameFromRow(row)]);
      ensureContained(row.id);
    },
    [frameFromRow, ensureContained],
  );

  // drill into a nested merge from within the merge view
  const drillMerge = useCallback(
    (cc: ContainedCommit) => {
      setMergeStack((s) => [...s, frameFromContained(cc)]);
      ensureContained(cc.fullHash);
    },
    [frameFromContained, ensureContained],
  );

  // drill straight from the inline accordion (seeds [parent, nested])
  const drillFromAccordion = useCallback(
    (parent: Row, cc: ContainedCommit) => {
      setMergeStack([frameFromRow(parent), frameFromContained(cc)]);
      ensureContained(cc.fullHash);
    },
    [frameFromRow, frameFromContained, ensureContained],
  );

  const mergeBack = useCallback(() => setMergeStack((s) => s.slice(0, -1)), []);
  const gotoCrumb = useCallback(
    (i: number) => setMergeStack((s) => (i < 0 ? [] : s.slice(0, i + 1))),
    [],
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
          <span
            className="dot r"
            title={t("titlebar.close")}
            onClick={() => win?.close()}
          />
          <span
            className="dot y"
            title={t("titlebar.minimize")}
            onClick={() => win?.minimize()}
          />
          <span
            className="dot g"
            title={t("titlebar.zoom")}
            onClick={() => win?.toggleMaximize()}
          />
        </div>
        <span className="app-name">DeltaScope</span>
        <span className="app-title">
          {repoName} —{" "}
          {view === "deleted"
            ? t("tabs.deletedFiles")
            : view === "renamed"
              ? t("tabs.renamedFiles")
              : t("tabs.branchHistory")}
        </span>
        <span className="spacer" />
        <div className="lang-switch">
          {(["zh-TW", "en", "ja"] as Lang[]).map((l) => (
            <button
              key={l}
              className={"lang-opt" + (lang === l ? " on" : "")}
              onClick={() => setLang(l)}
            >
              {l === "zh-TW" ? "繁" : l === "en" ? "EN" : "日"}
            </button>
          ))}
        </div>
      </div>

      {/* toolbar */}
      <div className="toolbar">
        <button className="btn" onClick={onPick}>
          <span className="folder-ico" />
          <span className="path">
            {repoPath ? tildify(repoPath) : t("repo.pick")}
          </span>
          <span className="caret-dn">▾</span>
        </button>
        <button
          className="btn-icon"
          title={t("titlebar.refresh")}
          onClick={onRefresh}
          disabled={!hasRepo}
        >
          <span className={"refresh-ico" + (refreshing ? " spinning" : "")}>
            ↻
          </span>
        </button>
        <div className="seg view-seg">
          <button
            className={"seg-btn" + (view === "branches" ? " active" : "")}
            onClick={() => setView("branches")}
          >
            {t("tabs.segBranch")}
          </button>
          <button
            className={"seg-btn" + (view === "deleted" ? " active" : "")}
            onClick={() => setView("deleted")}
          >
            {t("tabs.segRemove")}
          </button>
          <button
            className={"seg-btn" + (view === "renamed" ? " active" : "")}
            onClick={() => setView("renamed")}
          >
            {t("tabs.segRename")}
          </button>
        </div>
        {flash && (
          <span className={"flash" + (flash.err ? " err" : "")}>
            {flash.msg}
          </span>
        )}
        {view === "branches" && (
          <div className="target-wrap">
            <span className="lbl">{t("branchView.toggle")}</span>
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
        )}
      </div>

      {view === "branches" ? (
        <>
      {/* filter bar */}
      <div className="filterbar">
        <div className="search">
          <span className="search-ico" />
          <input
            className="search-input"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("mergeList.searchPlaceholder")}
          />
        </div>
        <select
          className="select-sm"
          value={date}
          onChange={(e) => setDate(e.target.value as DateFilter)}
        >
          {data.dateOptions.map((o) => (
            <option key={o.value} value={o.value}>
              {t(o.labelKey)}
            </option>
          ))}
        </select>
        <div className="result-count">
          {t("list.showing")} <b>{filtered.length}</b> / {data.totalCount}
        </div>
      </div>

      {/* list */}
      <div className="list-region">
      <div className="list" ref={listRef}>
        {!hasRepo ? (
          <div className="empty">
            <span className="glyph">⑂</span>
            <span className="msg">{t("repo.pickStart")}</span>
            <button className="btn pick" onClick={onPick}>
              <span className="folder-ico" />
              <span className="path">{t("repo.pickFolder")}</span>
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
            <span className="msg">{t("common.loading")}</span>
          </div>
        ) : filtered.length === 0 ? (
          <div className="empty">
            <span className="glyph">∅</span>
            <span className="msg">{t("mergeList.empty")}</span>
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
                    onDoubleClick={() => {
                      if (c.isMerge) openMergeView(c);
                    }}
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
                              {t("mergeList.loadingContained")}
                            </span>
                          ) : (
                            <>
                              {t("mergeList.broughtInPre")}{" "}
                              <b>{cc?.length ?? 0}</b>{" "}
                              {t("mergeList.broughtInPost")}
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
                              <ContainedRow
                                key={x.hash + ":" + i}
                                cc={x}
                                onOpen={openDiff}
                                onDrill={(nested) => drillFromAccordion(c, nested)}
                              />
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
                                {t("mergeList.noSecondParent")}
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

      {mergeStack.length > 0 && (
        <MergeView
          stack={mergeStack}
          contained={contained[mergeStack[mergeStack.length - 1].fullHash]}
          loading={!!loadingCommits[mergeStack[mergeStack.length - 1].fullHash]}
          onBack={mergeBack}
          onBreadcrumb={gotoCrumb}
          onDrill={drillMerge}
          onOpenDiff={openDiff}
        />
      )}

      {diffCommit && (
        <div className="diff-overlay">
          {/* diff header */}
          <div className="diff-header">
            <button className="diff-back" onClick={closeDiff}>
              {t("diff.back")}
            </button>
            <span className="diff-hash">{diffCommit.hash}</span>
            <span className="diff-msg">{diffCommit.msg}</span>
            <span className="diff-author">◍ {diffCommit.author}</span>
            <span className="diff-when">{diffCommit.when}</span>
            <div className="diff-stats">
              {diffData ? (
                <>
                  <span className="dh-files">
                    {diffData.files.length} {t("diff.filesSuffix")}
                  </span>
                  <span className="dh-add">+{diffData.add}</span>
                  <span className="dh-del">
                    {MINUS}
                    {diffData.del}
                  </span>
                </>
              ) : (
                <span className="dh-files">{t("common.loadingShort")}</span>
              )}
            </div>
          </div>

          {/* diff body */}
          {diffLoading || !diffData ? (
            <div className="diff-loading">
              <span className="glyph">↻</span>
              <span>{t("diff.loadingCode")}</span>
            </div>
          ) : diffData.files.length === 0 ? (
            <div className="diff-loading">
              <span className="glyph">∅</span>
              <span>{t("diff.noFileChanges")}</span>
            </div>
          ) : (
            (() => {
              const fi = Math.min(diffFile, diffData.files.length - 1);
              const sf = diffData.files[fi];
              return (
                <div className="diff-body">
                  {/* file list */}
                  <div className="file-list">
                    <div className="file-list-label">
                      {t("diff.changedFiles")}
                    </div>
                    {diffData.files.map((f, i) => (
                      <div
                        className={"file-row" + (i === fi ? " sel" : "")}
                        key={f.path + ":" + i}
                        title={t("diff.openDefault")}
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
                      <div className="diff-binary">{t("diff.binary")}</div>
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
        </>
      ) : view === "deleted" ? (
        <DeletedFilesView
          repoPath={repoPath}
          reloadNonce={deletedNonce}
          onFlash={setFlashMsg}
        />
      ) : (
        <RenamedFilesView
          repoPath={repoPath}
          reloadNonce={renamedNonce}
          onFlash={setFlashMsg}
        />
      )}
    </div>
  );
}
