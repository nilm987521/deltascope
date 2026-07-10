import { useState } from "react";
import type { Tab } from "./tabs";
import { useI18n } from "./i18n";

const basename = (p: string) => p.split("/").filter(Boolean).pop() || p;

// Tab label = "目錄名(分支名)", e.g. deltascope(main). Falls back to just the
// directory name while the branch is still resolving.
function labelOf(tab: Tab): string {
  const name = basename(tab.repoPath);
  return tab.viewBranch ? `${name}(${tab.viewBranch})` : name;
}

export interface TabBarProps {
  tabs: Tab[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  onNew: () => void;
  onReorder: (fromId: string, toId: string) => void;
}

export default function TabBar({
  tabs,
  activeId,
  onSelect,
  onClose,
  onNew,
  onReorder,
}: TabBarProps) {
  const { t } = useI18n();
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);

  return (
    <div className="tabbar">
      {tabs.map((tab) => (
        <div
          key={tab.id}
          className={
            "tab" +
            (tab.id === activeId ? " active" : "") +
            (tab.id === overId && dragId && dragId !== tab.id ? " dragover" : "")
          }
          style={
            tab.id === activeId
              ? ({ "--tab-color": tab.color } as React.CSSProperties)
              : undefined
          }
          onClick={() => onSelect(tab.id)}
          draggable
          onDragStart={(e) => {
            setDragId(tab.id);
            e.dataTransfer.effectAllowed = "move";
          }}
          onDragOver={(e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = "move";
            if (tab.id !== overId) setOverId(tab.id);
          }}
          onDrop={(e) => {
            e.preventDefault();
            if (dragId && dragId !== tab.id) onReorder(dragId, tab.id);
            setDragId(null);
            setOverId(null);
          }}
          onDragEnd={() => {
            setDragId(null);
            setOverId(null);
          }}
        >
          <span className="tab-dot" style={{ background: tab.color }} />
          <span className="tab-label">{labelOf(tab)}</span>
          <span
            className="tab-close"
            title={t("titlebar.close")}
            onClick={(e) => {
              e.stopPropagation();
              onClose(tab.id);
            }}
          >
            ×
          </span>
        </div>
      ))}
      <button className="tab-new" title={t("tabbar.newTab")} onClick={onNew}>
        +
      </button>
    </div>
  );
}
