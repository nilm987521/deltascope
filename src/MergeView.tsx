import { useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useI18n } from "./i18n";
import type { ContainedCommit } from "./rows";
import ContainedRow from "./ContainedRow";

export interface MergeFrame {
  fullHash: string; // drill key + list_merge_commits argument
  shortHash: string; // header display
  name: string; // breadcrumb label (source branch, or short hash if unparsed)
}

/** Window-filling overlay (the merge view) for a merge's brought-in commits. Renders the top of the
 *  drill stack; nested merges drill deeper, regular commits open their diff. */
export default function MergeView({
  stack,
  contained,
  loading,
  onBack,
  onBreadcrumb,
  onDrill,
  onOpenDiff,
}: {
  stack: MergeFrame[]; // non-empty; last = current view
  contained: ContainedCommit[] | undefined; // for the current (top) frame
  loading: boolean;
  onBack: () => void;
  onBreadcrumb: (index: number) => void; // -1 = root (list)
  onDrill: (cc: ContainedCommit) => void;
  onOpenDiff: (cc: ContainedCommit) => void;
}) {
  const { t } = useI18n();
  const top = stack[stack.length - 1];
  const scrollRef = useRef<HTMLDivElement>(null);
  const items = contained ?? [];

  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 34,
    overscan: 12,
  });

  return (
    <div className="merge-overlay">
      <div className="mv-head">
        <button className="mv-back" onClick={onBack}>
          {t("diff.back")}
        </button>
        <div className="mv-crumb">
          <span className="mv-seg" onClick={() => onBreadcrumb(-1)}>
            {t("mergeView.crumbRoot")}
          </span>
          {stack.map((f, i) => {
            const cur = i === stack.length - 1;
            return (
              <span key={f.fullHash + ":" + i}>
                <span className="mv-sep">›</span>
                <span
                  className={"mv-seg" + (cur ? " cur" : "")}
                  onClick={() => !cur && onBreadcrumb(i)}
                >
                  {f.name}
                </span>
              </span>
            );
          })}
        </div>
        <div className="mv-meta">
          <span className="mv-hash">{top.shortHash}</span>
          {contained && contained.length > 0 && (
            <span>
              {t("mergeList.broughtInPre")} <b>{contained.length}</b>{" "}
              {t("mergeList.broughtInPost")}
            </span>
          )}
          <span className="mv-range">git log {top.shortHash}^1..^2</span>
        </div>
      </div>

      {loading || contained === undefined ? (
        <div className="mv-empty">
          <span className="glyph" style={{ animation: "spin 0.8s linear infinite" }}>
            ↻
          </span>
          <span className="msg">{t("mergeList.loadingContained")}</span>
        </div>
      ) : items.length === 0 ? (
        <div className="mv-empty">
          <span className="glyph">⌀</span>
          <span className="msg">{t("mergeView.emptyBrought")}</span>
          <span className="msg dim">{t("mergeView.emptyHint")}</span>
        </div>
      ) : (
        <div className="mv-body" ref={scrollRef}>
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
                <ContainedRow cc={items[vi.index]} onOpen={onOpenDiff} onDrill={onDrill} />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
