import { useI18n } from "./i18n";
import type { ContainedCommit } from "./rows";

const MINUS = "−";

/** One row in a contained-commit list. A regular commit opens its diff; a commit
 *  that is itself a merge shows a source-branch tag + drill affordance and drills in. */
export default function ContainedRow({
  cc,
  onOpen,
  onDrill,
}: {
  cc: ContainedCommit;
  onOpen: (cc: ContainedCommit) => void;
  onDrill: (cc: ContainedCommit) => void;
}) {
  const { t } = useI18n();
  const handle = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (cc.isMerge) onDrill(cc);
    else onOpen(cc);
  };
  return (
    <div
      className={"cc-row" + (cc.isMerge ? " cc-merge" : "")}
      onClick={handle}
      title={cc.isMerge ? t("mergeView.drill") : t("diff.viewCode")}
    >
      <span className="cc-hash">{cc.hash}</span>
      {cc.isMerge && cc.branchShort ? (
        // A nested merge: the source→target pill stands in for the raw subject.
        <>
          <span className="tag" style={cc.tagStyle}>
            {cc.target ? `${cc.branchShort} → ${cc.target}` : cc.branchShort}
          </span>
          <span className="cc-fill" />
        </>
      ) : (
        <span className="cc-msg">{cc.msg}</span>
      )}
      <span className="cc-author">◍ {cc.author}</span>
      <span className="cc-when">· {cc.when}</span>
      {cc.isMerge ? (
        <span className="cc-drill">{t("mergeView.drill")} ⤵</span>
      ) : (
        <span className="cc-stats">
          <span className="cc-add">+{cc.add}</span>
          <span className="cc-del">
            {MINUS}
            {cc.del}
          </span>
          <span className="cc-chev">›</span>
        </span>
      )}
    </div>
  );
}
