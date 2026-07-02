// src-tauri/src/sys.rs
// OS integration. Like git.rs, this shells out via std::process::Command rather than
// pulling in a plugin, so no extra capability/permission wiring is needed.

use std::path::{Path, PathBuf};
use std::process::Command;

/// Open a repo-relative path with the operating system's default application.
/// `path` is joined onto `repo`, so it opens the file as it exists in the working tree.
#[tauri::command]
pub fn open_path(repo: String, path: String) -> Result<(), String> {
    let full: PathBuf = Path::new(&repo).join(&path);
    if !full.exists() {
        return Err(format!("檔案不存在：{}", full.display()));
    }
    let full = full.as_os_str();

    #[cfg(target_os = "macos")]
    let mut cmd = {
        let mut c = Command::new("open");
        c.arg(full);
        c
    };
    #[cfg(target_os = "windows")]
    let mut cmd = {
        // The empty "" is the window title argument `start` expects before the path.
        let mut c = Command::new("cmd");
        c.arg("/C").arg("start").arg("").arg(full);
        c
    };
    #[cfg(all(unix, not(target_os = "macos")))]
    let mut cmd = {
        let mut c = Command::new("xdg-open");
        c.arg(full);
        c
    };

    let status = cmd.status().map_err(|e| format!("無法開啟檔案：{e}"))?;
    if !status.success() {
        return Err("系統無法開啟此檔案".to_string());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn missing_file_errors() {
        // Never launches an app: the existence check fails first.
        let err = open_path("/no/such".into(), "nope.txt".into()).unwrap_err();
        assert!(err.contains("檔案不存在"), "got: {err}");
    }
}
