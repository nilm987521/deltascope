import { useCallback, useEffect, useMemo, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { pickRepo } from "./git";
import RepoWorkspace from "./RepoWorkspace";
import TabBar from "./TabBar";
import { loadTabs, makeTab, saveTabs, type Tab } from "./tabs";
import { useI18n, type Lang } from "./i18n";

export default function App() {
  const { lang, setLang, t } = useI18n();

  // Open repos as tabs. Each tab's transient per-repo state lives in its
  // <RepoWorkspace>; here we track only identity + the active tab. Restored
  // synchronously on first render (migrates the old single-repo key).
  const [restored] = useState(loadTabs);
  const [tabs, setTabs] = useState<Tab[]>(restored.tabs);
  const [activeId, setActiveId] = useState<string | null>(restored.activeId);

  // Persist on any change to the tab set / active tab / a tab's branch.
  useEffect(() => {
    saveTabs(tabs, activeId);
  }, [tabs, activeId]);

  const addTab = useCallback((repoPath: string) => {
    setTabs((prev) => {
      const tab = makeTab(
        repoPath,
        prev.map((x) => x.color),
      );
      setActiveId(tab.id);
      return [...prev, tab];
    });
  }, []);

  const onNew = useCallback(async () => {
    const dir = await pickRepo();
    if (!dir) return;
    addTab(dir);
  }, [addTab]);

  const onClose = useCallback((id: string) => {
    setTabs((prev) => {
      const idx = prev.findIndex((x) => x.id === id);
      if (idx < 0) return prev;
      const next = prev.filter((x) => x.id !== id);
      setActiveId((cur) => {
        if (cur !== id) return cur; // closing a background tab keeps the active one
        if (next.length === 0) return null;
        // activate the right neighbor, else the (new) last tab
        return (next[idx] ?? next[next.length - 1]).id;
      });
      return next;
    });
  }, []);

  const onReorder = useCallback((fromId: string, toId: string) => {
    setTabs((prev) => {
      const from = prev.findIndex((x) => x.id === fromId);
      const to = prev.findIndex((x) => x.id === toId);
      if (from < 0 || to < 0 || from === to) return prev;
      const next = [...prev];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
  }, []);

  // A tab reported its resolved/selected branch — update the label + persist.
  const handleViewBranchChange = useCallback((id: string, branch: string) => {
    setTabs((prev) =>
      prev.map((x) =>
        x.id === id && x.viewBranch !== branch ? { ...x, viewBranch: branch } : x,
      ),
    );
  }, []);

  // The folder button swapped a tab's repo — reset its branch; the workspace
  // reloads (repoPath prop changed) and reports the new branch back.
  const handleRepoChange = useCallback((id: string, repoPath: string) => {
    setTabs((prev) =>
      prev.map((x) =>
        x.id === id ? { ...x, repoPath, viewBranch: "" } : x,
      ),
    );
  }, []);

  // window controls (custom titlebar — decorations are off)
  const win = useMemo(() => {
    try {
      return getCurrentWindow();
    } catch {
      return null;
    }
  }, []);

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
        <span className="app-title">{t("tabbar.multiRepo")}</span>
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

      {/* tab bar */}
      <TabBar
        tabs={tabs}
        activeId={activeId}
        onSelect={setActiveId}
        onClose={onClose}
        onNew={onNew}
        onReorder={onReorder}
      />

      {/* workspaces (one per open tab; only the active one is visible) */}
      {tabs.length === 0 ? (
        <div className="workspaces">
          <div className="empty">
            <span className="glyph">⑂</span>
            <span className="msg">{t("repo.pickStart")}</span>
            <button className="btn pick" onClick={onNew}>
              <span className="folder-ico" />
              <span className="path">{t("repo.pickFolder")}</span>
            </button>
          </div>
        </div>
      ) : (
        <div className="workspaces">
          {tabs.map((tab) => (
            <RepoWorkspace
              key={tab.id}
              repoPath={tab.repoPath}
              initialViewBranch={tab.viewBranch}
              hidden={tab.id !== activeId}
              onViewBranchChange={(branch) =>
                handleViewBranchChange(tab.id, branch)
              }
              onRepoChange={(path) => handleRepoChange(tab.id, path)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
