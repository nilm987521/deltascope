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

/** One file deletion found anywhere in history
 *  (git log --all --diff-filter=D --name-only). One entry per (deleting commit, path). */
export interface DeletedFile {
  path: string; // full path git reported for the deletion
  short: string; // deleting commit short hash
  hash: string; // deleting commit full SHA (for the restore command)
  author: string;
  dateIso: string;
  subject: string; // deleting commit message
  branch: string; // source branch, cleaned ("" if none)
}

/** One file rename/move found anywhere in history
 *  (git log --all --diff-filter=R -M --name-status). One entry per (renaming commit, rename). */
export interface RenamedFile {
  oldPath: string; // path before the rename
  newPath: string; // path after the rename
  score: number; // rename similarity: 100 = pure move; <100 = moved + edited
  short: string; // renaming commit short hash
  hash: string; // renaming commit full SHA
  author: string;
  dateIso: string;
  subject: string; // renaming commit message
  branch: string; // source branch, cleaned ("" if none)
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
