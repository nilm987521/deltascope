import { invoke } from "@tauri-apps/api/core";

/** Open a repo-relative file with the OS default application. */
export function openPath(repo: string, path: string): Promise<void> {
  return invoke<void>("open_path", { repo, path });
}
