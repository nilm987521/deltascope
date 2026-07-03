import type { CSSProperties } from "react";
import type { BranchCommit, MergeCommit } from "./data-contract";

/** Feature-branch hue pool, assigned in first-appearance order. hotfix is fixed to hue 45 (amber). */
export const HUES = [
  255, 150, 300, 195, 278, 110, 330, 212, 168, 318, 132, 238, 288, 182, 58, 222,
];

export interface ContainedCommit {
  hash: string;
  msg: string;
  author: string;
  when: string;
  add: number;
  del: number;
}

export interface Row {
  id: string; // full SHA — expand key + argument to list_merge_commits
  hash: string; // short SHA
  branch: string; // full source branch name ("all"-filterable)
  branchShort: string;
  target: string;
  isHotfix: boolean;
  isMerge: boolean; // merge view: always true; branch view: per commit
  author?: string; // branch-view regular commits show the author
  title: string;
  dateMs: number;
  dateLabel: string;
  timeLabel: string;
  node: string; // dot / rail color
  tagStyle: CSSProperties; // per-branch label colors (static parts live in .tag)
}

export interface Option {
  value: string;
  label: string;
}

export interface BuiltData {
  rows: Row[];
  dateOptions: Option[];
  maxDateMs: number;
  totalCount: number;
}

const pad = (n: number) => String(n).padStart(2, "0");

/** Derive a friendly title from a branch short name (sheds a leading YYYY_MM_ prefix). */
export function titleOf(short: string): string {
  const m = short.match(/^(\d{4})_(\d{2})_(.+)$/);
  return m ? m[3].replace(/_/g, " ") : short.replace(/[_-]/g, " ");
}

/** From a merge subject "Merge branch 'x' into develop" pull the target branch
 *  ("develop") — the token after the final "into". "" when the subject has none. */
export function mergeTargetOf(subject: string): string {
  const m = subject.match(/\binto\s+(\S+)\s*$/);
  return m ? m[1].replace(/^origin\//, "") : "";
}

export function tagStyleFor(hue: number, isHotfix: boolean): CSSProperties {
  const c = isHotfix ? 0.09 : 0.05;
  const ct = isHotfix ? 0.14 : 0.11;
  const cb = isHotfix ? 0.1 : 0.07;
  return {
    background: `oklch(0.28 ${c} ${hue})`,
    color: `oklch(0.84 ${ct} ${hue})`,
    borderColor: `oklch(0.42 ${cb} ${hue})`,
  };
}

function nodeColor(hue: number, isHotfix: boolean): string {
  return isHotfix ? `oklch(0.72 0.16 ${hue})` : `oklch(0.74 0.13 ${hue})`;
}

/** Map a raw MergeCommit into the shape the expanded row renders. */
export function toContained(c: MergeCommit): ContainedCommit {
  const d = new Date(c.dateIso);
  return {
    hash: c.short,
    msg: c.subject,
    author: c.author,
    when: `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`,
    add: c.add,
    del: c.del,
  };
}

/** Build display rows for a single branch's first-parent history. */
export function buildBranchRows(commits: BranchCommit[]): BuiltData {
  const hueByBranch: Record<string, number> = {};
  let hi = 0;
  let maxDateMs = 0;

  const rows: Row[] = commits.map((c) => {
    const d = new Date(c.dateIso);
    const dateMs = d.getTime();
    if (dateMs > maxDateMs) maxDateMs = dateMs;
    const branchShort = c.branch
      .replace(/^feature\//, "")
      .replace(/^origin\//, "");
    const isHotfix = c.branch === "hotfix";

    let node: string;
    let tagStyle: CSSProperties;
    if (c.isMerge && c.branch) {
      if (!(c.branch in hueByBranch)) {
        hueByBranch[c.branch] = isHotfix ? 45 : HUES[hi++ % HUES.length];
      }
      const hue = hueByBranch[c.branch];
      node = nodeColor(hue, isHotfix);
      tagStyle = tagStyleFor(hue, isHotfix);
    } else {
      node = "oklch(0.55 0.02 160)"; // neutral rail node for regular commits
      tagStyle = {};
    }

    return {
      id: c.hash,
      hash: c.short,
      branch: c.branch,
      branchShort: branchShort || c.branch,
      target: c.isMerge ? mergeTargetOf(c.subject) : "",
      isHotfix,
      isMerge: c.isMerge,
      author: c.author,
      title: c.isMerge ? titleOf(branchShort) || c.subject : c.subject,
      dateMs,
      dateLabel: `${d.getMonth() + 1}/${d.getDate()}`,
      timeLabel: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
      node,
      tagStyle,
    };
  });

  const dateOptions: Option[] = [
    { value: "all", label: "全部時間" },
    { value: "7d", label: "近 7 天" },
    { value: "30d", label: "近 30 天" },
    { value: "90d", label: "近 90 天" },
  ];

  return { rows, dateOptions, maxDateMs, totalCount: rows.length };
}
