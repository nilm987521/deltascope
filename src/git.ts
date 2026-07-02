import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import type {
  CommitDiff,
  Merge,
  MergeCommit,
  MergeCount,
} from "./data-contract";

/** Open the system folder picker; returns the chosen path or null. */
export async function pickRepo(): Promise<string | null> {
  const dir = await open({
    directory: true,
    multiple: false,
    title: "選擇 Git repository",
  });
  return typeof dir === "string" ? dir : null;
}

export function listBranches(repo: string): Promise<string[]> {
  return invoke<string[]>("list_branches", { repo });
}

export function defaultBranch(repo: string): Promise<string> {
  return invoke<string>("default_branch", { repo });
}

export function listMerges(repo: string, target: string): Promise<Merge[]> {
  return invoke<Merge[]>("list_merges", { repo, target: target || "" });
}

export function countMergeCommits(
  repo: string,
  hashes: string[],
): Promise<MergeCount[]> {
  return invoke<MergeCount[]>("count_merge_commits", { repo, hashes });
}

export function listMergeCommits(
  repo: string,
  merge: string,
): Promise<MergeCommit[]> {
  return invoke<MergeCommit[]>("list_merge_commits", { repo, merge });
}

export function commitDiff(repo: string, sha: string): Promise<CommitDiff> {
  return invoke<CommitDiff>("commit_diff", { repo, sha });
}
