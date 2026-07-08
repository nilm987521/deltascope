import { useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { listRenamedFiles } from "./git";
import type { RenamedFile } from "./data-contract";
import { HUES, tagStyleFor } from "./rows";
import { useI18n } from "./i18n";

type Mode = "list" | "commit";

const pad = (n: number) => String(n).padStart(2, "0");

function splitPath(p: string): { dir: string; name: string } {
  const i = p.lastIndexOf("/");
  return i >= 0 ? { dir: p.slice(0, i + 1), name: p.slice(i + 1) } : { dir: "", name: p };
}
function extOf(p: string): string {
  const name = p.slice(p.lastIndexOf("/") + 1);
  const i = name.lastIndexOf(".");
  return i > 0 ? name.slice(i + 1) : "";
}
function dateLabel(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
}
function whenLabel(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
/** A rename that also edited content (similarity < 100%) is a "搬移+改動". */
const isEdited = (r: RenamedFile) => r.score < 100;

const keyOf = (r: RenamedFile) => r.hash + ":" + r.newPath;

interface Props {
  repoPath: string | null;
  reloadNonce: number;
  onFlash: (msg: string, err?: boolean) => void;
}

export default function RenamedFilesView({ repoPath, reloadNonce, onFlash }: Props) {
  const { t } = useI18n();
  const [files, setFiles] = useState<RenamedFile[]>([]);
  const [loading, setLoading] = useState(false);

  const [search, setSearch] = useState("");
  const [extFilter, setExtFilter] = useState("all");
  const [branchFilter, setBranchFilter] = useState("all");
  const [mode, setMode] = useState<Mode>("list");
  const [sel, setSel] = useState<string | null>(null);

  useEffect(() => {
    if (!repoPath) {
      setFiles([]);
      return;
    }
    let alive = true;
    setLoading(true);
    setSel(null);
    listRenamedFiles(repoPath)
      .then((list) => {
        if (alive) setFiles(list);
      })
      .catch((e) => {
        if (alive) {
          setFiles([]);
          onFlash(String(e), true);
        }
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [repoPath, reloadNonce, onFlash]);

  // per-branch tag colors, matching the branch view's first-appearance hues
  const hueByBranch = useMemo(() => {
    const m: Record<string, number> = {};
    let hi = 0;
    for (const f of files) {
      const b = f.branch;
      if (b && !(b in m)) m[b] = b === "hotfix" ? 45 : HUES[hi++ % HUES.length];
    }
    return m;
  }, [files]);
  const tagFor = (branch: string) =>
    tagStyleFor(hueByBranch[branch] ?? 200, branch === "hotfix");

  const extOptions = useMemo(() => {
    const set = new Set<string>();
    for (const f of files) set.add(extOf(f.newPath) || "—");
    return [...set].sort();
  }, [files]);
  const branchOptions = useMemo(() => {
    const set = new Set<string>();
    for (const f of files) if (f.branch) set.add(f.branch);
    return [...set].sort();
  }, [files]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return files.filter((f) => {
      if (extFilter !== "all" && (extOf(f.newPath) || "—") !== extFilter) return false;
      if (branchFilter !== "all" && f.branch !== branchFilter) return false;
      if (!q) return true;
      return (
        f.newPath.toLowerCase().includes(q) ||
        f.oldPath.toLowerCase().includes(q) ||
        f.author.toLowerCase().includes(q) ||
        f.subject.toLowerCase().includes(q) ||
        f.short.toLowerCase().includes(q) ||
        f.hash.toLowerCase().includes(q) ||
        f.branch.toLowerCase().includes(q)
      );
    });
  }, [files, search, extFilter, branchFilter]);

  const groups = useMemo(() => {
    if (mode !== "commit") return [];
    const byHash = new Map<string, RenamedFile[]>();
    for (const f of filtered) {
      const arr = byHash.get(f.hash);
      if (arr) arr.push(f);
      else byHash.set(f.hash, [f]);
    }
    return [...byHash.values()].map((arr) => ({ head: arr[0], files: arr }));
  }, [filtered, mode]);

  const commitCount = useMemo(
    () => new Set(files.map((f) => f.hash)).size,
    [files],
  );

  const listRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: mode === "list" ? filtered.length : 0,
    getScrollElement: () => listRef.current,
    estimateSize: () => 39,
    getItemKey: (i) => keyOf(filtered[i]),
    overscan: 12,
  });

  const selected = useMemo(
    () => filtered.find((f) => keyOf(f) === sel) ?? null,
    [filtered, sel],
  );

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      onFlash(t("common.copied"));
    } catch (e) {
      onFlash(String(e), true);
    }
  };

  const hasRepo = repoPath !== null;

  const renderRow = (f: RenamedFile, opts?: { grouped?: boolean }) => {
    const oldName = splitPath(f.oldPath).name;
    const nnew = splitPath(f.newPath);
    const edited = isEdited(f);
    return (
      <div
        className={"del-row" + (keyOf(f) === sel ? " sel" : "")}
        onClick={() => setSel(keyOf(f) === sel ? null : keyOf(f))}
      >
        <span className="ren-move-ico">⇄</span>
        <span className="del-path">
          <span className="ren-old">{f.oldPath}</span>
          <span className="ren-arrow">→</span>
          <span className="del-dir">{nnew.dir}</span>
          <span className="ren-new-name">{nnew.name}</span>
        </span>
        <span className={"ren-badge" + (edited ? " edited" : "")}>
          {edited ? t("renamed.moveEditBadge", { n: f.score }) : t("renamed.pureMove")}
        </span>
        {!opts?.grouped && f.branch && (
          <span className="tag" style={tagFor(f.branch)}>
            {f.branch.replace(/^feature\//, "")}
          </span>
        )}
        {!opts?.grouped && <span className="del-hash">{f.short}</span>}
        {!opts?.grouped && <span className="del-author">◍ {f.author}</span>}
        <span className="del-date" title={oldName}>
          {dateLabel(f.dateIso)}
        </span>
      </div>
    );
  };

  return (
    <>
      {/* filter bar */}
      <div className="filterbar">
        <div className="search">
          <span className="search-ico" />
          <input
            className="search-input"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("renamed.searchPlaceholder")}
          />
        </div>
        <select
          className="select-sm"
          value={extFilter}
          onChange={(e) => setExtFilter(e.target.value)}
        >
          <option value="all">{t("filter.allTypes", { n: extOptions.length })}</option>
          {extOptions.map((x) => (
            <option key={x} value={x}>
              {x}
            </option>
          ))}
        </select>
        <select
          className="select-sm select-branch"
          value={branchFilter}
          onChange={(e) => setBranchFilter(e.target.value)}
        >
          <option value="all">{t("filter.allBranches", { n: branchOptions.length })}</option>
          {branchOptions.map((b) => (
            <option key={b} value={b}>
              {b}
            </option>
          ))}
        </select>
        <div className="seg">
          <button
            className={"seg-btn" + (mode === "list" ? " active" : "")}
            onClick={() => setMode("list")}
          >
            {t("renamed.tabMoveEdit")}
          </button>
          <button
            className={"seg-btn" + (mode === "commit" ? " active" : "")}
            onClick={() => setMode("commit")}
          >
            {t("common.byCommit")}
          </button>
        </div>
        <div className="result-count">
          {t("renamed.renamedCountPre")} <b>{filtered.length}</b> / {files.length} · commit {commitCount}
        </div>
      </div>

      {/* list + detail */}
      <div className="list-region">
        <div className="del-main">
          <div className="del-list" ref={listRef}>
            {!hasRepo ? (
              <div className="empty">
                <span className="glyph">⇄</span>
                <span className="msg">{t("repo.pickStart")}</span>
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
                <span className="msg">
                  {files.length === 0
                    ? t("repo.noRenamed")
                    : t("common.noMatch")}
                </span>
              </div>
            ) : mode === "list" ? (
              <div
                style={{
                  height: virtualizer.getTotalSize(),
                  position: "relative",
                  width: "100%",
                }}
              >
                {virtualizer.getVirtualItems().map((vi) => (
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
                    {renderRow(filtered[vi.index])}
                  </div>
                ))}
              </div>
            ) : (
              <div>
                {groups.map((g) => (
                  <div className="del-group" key={g.head.hash}>
                    <div className="del-group-head">
                      <span className="del-group-hash">{g.head.short}</span>
                      <span className="del-group-msg">{g.head.subject}</span>
                      {g.head.branch && (
                        <span className="tag" style={tagFor(g.head.branch)}>
                          {g.head.branch.replace(/^feature\//, "")}
                        </span>
                      )}
                      <span className="del-group-when">
                        {whenLabel(g.head.dateIso)}
                      </span>
                      <span className="ren-group-count">⇄{g.files.length}</span>
                    </div>
                    {g.files.map((f) => (
                      <div key={keyOf(f)} className="del-group-item">
                        {renderRow(f, { grouped: true })}
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* detail panel */}
          {selected && (
            <aside className="del-detail">
              <div className="del-detail-top">
                <span className="ren-detail-eyebrow">
                  {isEdited(selected) ? t("renamed.moveEditTitle") : t("renamed.pureMove")}
                </span>
                <button
                  className="del-detail-close"
                  title={t("titlebar.close")}
                  onClick={() => setSel(null)}
                >
                  ✕
                </button>
              </div>

              <div className="del-field">
                <div className="del-field-label">{t("renamed.oldPath")}</div>
                <div className="del-field-value ren-old">{selected.oldPath}</div>
              </div>
              <div className="del-field">
                <div className="del-field-label">{t("renamed.newPath")}</div>
                <div className="del-field-value">{selected.newPath}</div>
              </div>
              <div className="del-field">
                <div className="del-field-label">{t("renamed.similarity")}</div>
                <div className="del-field-value">
                  {selected.score}%{" "}
                  {isEdited(selected) ? t("renamed.contentChanged") : t("renamed.moveOnly")}
                </div>
              </div>
              <div className="del-field">
                <div className="del-field-label">{t("renamed.renameCommit")}</div>
                <div className="del-field-value">
                  <span className="del-hash">{selected.short}</span>{" "}
                  {selected.subject}
                </div>
              </div>
              <div className="del-field">
                <div className="del-field-label">{t("common.author")}</div>
                <div className="del-field-value">◍ {selected.author}</div>
              </div>
              <div className="del-field">
                <div className="del-field-label">{t("common.branch")}</div>
                <div className="del-field-value">{selected.branch || "—"}</div>
              </div>
              <div className="del-field">
                <div className="del-field-label">{t("common.time")}</div>
                <div className="del-field-value">
                  {whenLabel(selected.dateIso)}
                </div>
              </div>

              <div className="del-field">
                <div className="del-field-label">{t("renamed.trackHistory")}</div>
                <div className="del-cmd">
                  <code>git log --follow -- {selected.newPath}</code>
                  <button
                    className="del-copy"
                    onClick={() =>
                      copy(`git log --follow -- ${selected.newPath}`)
                    }
                  >
                    {t("common.copy")}
                  </button>
                </div>
              </div>
              <div className="del-field">
                <div className="del-field-label">{t("renamed.viewRename")}</div>
                <div className="del-cmd">
                  <code>git show {selected.short}</code>
                  <button
                    className="del-copy"
                    onClick={() => copy(`git show ${selected.short}`)}
                  >
                    {t("common.copy")}
                  </button>
                </div>
              </div>
            </aside>
          )}
        </div>
      </div>

      {/* status bar */}
      <div className="statusbar">
        <span className="dollar">$</span>
        <span>git log --all --diff-filter=R -M --name-status</span>
        <span className="right">
          {files.length} renamed · {commitCount} commits ·{" "}
          {branchOptions.length} branches
        </span>
      </div>
    </>
  );
}
