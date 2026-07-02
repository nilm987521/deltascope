// data-contract.ts
// Types shared between frontend and backend. The Rust serde structs serialize to these
// shapes (camelCase fields — see #[serde(rename_all = "camelCase")] in git.rs).

/** One merge (a row of `git log --merges --first-parent`, plus the parsed source branch). */
export interface Merge {
  hash: string; // full SHA (%H)
  short: string; // short SHA (%h)
  dateIso: string; // commit date, ISO 8601 (%cI) — formatted on the frontend
  refs: string; // ref names (%D), e.g. "origin/sit, sit"
  subject: string; // merge subject (%s), e.g. "Merge branch 'feature/young' into sit"
  branch: string; // source branch parsed from the subject, e.g. "feature/young" ("" if unparseable)
  target: string; // the branch merged into, e.g. "sit"
  isHotfix: boolean; // branch === "hotfix"
}

/** The number of commits a merge brought in (git rev-list --count <merge>^1..<merge>^2). */
export interface MergeCount {
  hash: string; // full SHA
  count: number;
}

/** A commit brought in by a merge (git log <merge>^1..<merge>^2). */
export interface MergeCommit {
  short: string; // %h
  subject: string; // %s
  author: string; // %an
  dateIso: string; // %cI
}
