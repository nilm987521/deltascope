mod git;
mod sys;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // Folder-picker dialog (frontend calls @tauri-apps/plugin-dialog's open({ directory: true })).
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            git::default_branch,
            git::list_branches,
            git::list_merges,
            git::count_merge_commits,
            git::list_merge_commits,
            git::commit_diff,
            git::list_branch_commits,
            sys::open_path,
        ])
        .run(tauri::generate_context!())
        .expect("error while running MergeScope");
}
