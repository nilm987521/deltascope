// data-contract.ts
// Types shared between frontend and backend. The Rust serde structs serialize to these
// shapes (camelCase fields — see #[serde(rename_all = "camelCase")] in git.rs).

/** The number of commits a merge brought in (git rev-list --count <merge>^1..<merge>^2). */
export interface MergeCount {
  hash: string; // full SHA
  count: number;
}

/** A commit brought in by a merge (git log <merge>^1..<merge>^2 --numstat). */
export interface MergeCommit {
  short: string; // %h
  subject: string; // %s
  author: string; // %an
  dateIso: string; // %cI
  add: number; // lines added (numstat total)
  del: number; // lines deleted (numstat total)
  files: number; // files touched
}

/** One commit on a branch's first-parent line (git log <branch> --first-parent). */
export interface BranchCommit {
  hash: string; // full SHA (%H) — expand key for merges
  short: string; // %h
  dateIso: string; // %cI
  author: string; // %an
  subject: string; // %s
  isMerge: boolean; // more than one parent
  branch: string; // source branch for merges; "" for regular commits
}

/** One line of a unified diff, resolved to old/new line numbers. */
export interface DiffLine {
  kind: "hunk" | "add" | "del" | "context";
  oldNo: number | null; // null when the line has no old-side number
  newNo: number | null; // null when the line has no new-side number
  text: string; // content without the +/-/space prefix; for "hunk", the @@ header
}

/** One file's changes within a commit (git show <sha>). */
export interface FileDiff {
  path: string;
  status: string; // "A" | "M" | "D" | "R" | "C"
  add: number;
  del: number;
  binary: boolean;
  lines: DiffLine[];
}

/** A commit's full diff. */
export interface CommitDiff {
  short: string;
  subject: string;
  author: string;
  dateIso: string;
  add: number;
  del: number;
  files: FileDiff[];
}
