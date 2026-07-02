import type { CSSProperties } from "react";
import type { Merge, MergeCommit } from "./data-contract";

/** Feature-branch hue pool, assigned in first-appearance order. hotfix is fixed to hue 45 (amber). */
const HUES = [255, 150, 300, 195, 278, 110, 330, 212, 168, 318, 132, 238, 288, 182, 58, 222];

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
  branchOptions: Option[];
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

function tagStyleFor(hue: number, isHotfix: boolean): CSSProperties {
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

/** Build the display rows and derived option lists from raw merges. */
export function buildRows(merges: Merge[]): BuiltData {
  const hueByBranch: Record<string, number> = {};
  const countByBranch: Record<string, number> = {};
  let hi = 0;
  let maxDateMs = 0;

  const rows: Row[] = merges.map((m) => {
    const branchShort = m.branch
      .replace(/^feature\//, "")
      .replace(/^origin\//, "");
    if (!(m.branch in hueByBranch)) {
      hueByBranch[m.branch] = m.isHotfix ? 45 : HUES[hi++ % HUES.length];
    }
    countByBranch[m.branch] = (countByBranch[m.branch] || 0) + 1;
    const hue = hueByBranch[m.branch];
    const d = new Date(m.dateIso);
    const dateMs = d.getTime();
    if (dateMs > maxDateMs) maxDateMs = dateMs;
    return {
      id: m.hash,
      hash: m.short,
      branch: m.branch,
      branchShort: branchShort || m.branch || "(unknown)",
      target: m.target,
      isHotfix: m.isHotfix,
      title: titleOf(branchShort) || m.subject,
      dateMs,
      dateLabel: `${d.getMonth() + 1}/${d.getDate()}`,
      timeLabel: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
      node: nodeColor(hue, m.isHotfix),
      tagStyle: tagStyleFor(hue, m.isHotfix),
    };
  });

  const branchList = Object.keys(countByBranch)
    .map((b) => ({
      branch: b,
      short: b.replace(/^feature\//, "").replace(/^origin\//, ""),
      count: countByBranch[b],
    }))
    .sort((a, b) => b.count - a.count);

  const branchOptions: Option[] = [
    { value: "all", label: `全部分支 (${branchList.length})` },
    ...branchList.map((b) => ({
      value: b.branch,
      label: `${b.short || b.branch} (${b.count})`,
    })),
  ];

  const dateOptions: Option[] = [
    { value: "all", label: "全部時間" },
    { value: "7d", label: "近 7 天" },
    { value: "30d", label: "近 30 天" },
    { value: "90d", label: "近 90 天" },
  ];

  return { rows, branchOptions, dateOptions, maxDateMs, totalCount: rows.length };
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
