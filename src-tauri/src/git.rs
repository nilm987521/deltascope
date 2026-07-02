// src-tauri/src/git.rs
// Read a repository through the system `git` CLI. No git2 crate — just std::process::Command.
// Every invocation uses `git -C <repo> ...` so the process working directory is never changed.

use serde::Serialize;
use std::process::Command;

// Use US (\x1f) as the field separator so whitespace inside messages never mis-splits a row.
const US: char = '\u{1f}';

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Merge {
    pub hash: String,
    pub short: String,
    pub date_iso: String,
    pub refs: String,
    pub subject: String,
    pub branch: String,
    pub target: String,
    pub is_hotfix: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MergeCount {
    pub hash: String,
    pub count: u32,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MergeCommit {
    pub short: String,
    pub subject: String,
    pub author: String,
    pub date_iso: String,
}

fn run_git(repo: &str, args: &[&str]) -> Result<String, String> {
    let out = Command::new("git")
        .arg("-C")
        .arg(repo)
        .args(args)
        .output()
        .map_err(|e| format!("無法執行 git：{e}"))?;
    if !out.status.success() {
        return Err(String::from_utf8_lossy(&out.stderr).trim().to_string());
    }
    Ok(String::from_utf8_lossy(&out.stdout).to_string())
}

/// From "Merge branch 'feature/young' into sit" extract 'feature/young'.
fn parse_branch(subject: &str) -> String {
    if let Some(a) = subject.find('\'') {
        if let Some(rel) = subject[a + 1..].find('\'') {
            return subject[a + 1..a + 1 + rel].to_string();
        }
    }
    String::new()
}

#[tauri::command]
pub fn default_branch(repo: String) -> Result<String, String> {
    // e.g. origin/HEAD -> origin/main; take the last segment.
    let out = run_git(&repo, &["symbolic-ref", "--short", "-q", "HEAD"])
        .or_else(|_| run_git(&repo, &["rev-parse", "--abbrev-ref", "HEAD"]))?;
    Ok(out.trim().to_string())
}

#[tauri::command]
pub fn list_branches(repo: String) -> Result<Vec<String>, String> {
    let out = run_git(&repo, &["branch", "--format=%(refname:short)"])?;
    Ok(out
        .lines()
        .map(|l| l.trim().to_string())
        .filter(|l| !l.is_empty())
        .collect())
}

#[tauri::command]
pub fn list_merges(repo: String, target: String) -> Result<Vec<Merge>, String> {
    let fmt = format!("--pretty=format:%H{US}%h{US}%cI{US}%D{US}%s");
    let range = if target.trim().is_empty() {
        "HEAD".to_string()
    } else {
        target.clone()
    };
    let out = run_git(&repo, &["log", "--merges", "--first-parent", &fmt, &range])?;

    let mut merges = Vec::new();
    for line in out.lines() {
        let f: Vec<&str> = line.split(US).collect();
        if f.len() < 5 {
            continue;
        }
        let subject = f[4].to_string();
        let branch = parse_branch(&subject);
        merges.push(Merge {
            hash: f[0].to_string(),
            short: f[1].to_string(),
            date_iso: f[2].to_string(),
            refs: f[3].to_string(),
            subject,
            is_hotfix: branch == "hotfix",
            branch,
            target: range.clone(),
        });
    }
    Ok(merges)
}

/// Cheaply count the commits each merge brought in (git rev-list --count <h>^1..<h>^2).
/// One process per merge, but rev-list --count is fast; run in the background from the UI.
#[tauri::command]
pub fn count_merge_commits(repo: String, hashes: Vec<String>) -> Result<Vec<MergeCount>, String> {
    let mut out = Vec::with_capacity(hashes.len());
    for h in hashes {
        let range = format!("{h}^1..{h}^2");
        let count = run_git(&repo, &["rev-list", "--count", &range])
            .ok()
            .and_then(|s| s.trim().parse::<u32>().ok())
            .unwrap_or(0);
        out.push(MergeCount { hash: h, count });
    }
    Ok(out)
}

#[tauri::command]
pub fn list_merge_commits(repo: String, merge: String) -> Result<Vec<MergeCommit>, String> {
    // <merge>^2 is the side that was merged in; ^1..^2 is what this merge brought in.
    // Note: fast-forward / parent-less merges fail → return an empty vec.
    let fmt = format!("--pretty=format:%h{US}%s{US}%an{US}%cI");
    let range = format!("{merge}^1..{merge}^2");
    let out = match run_git(&repo, &["log", &fmt, &range]) {
        Ok(s) => s,
        Err(_) => return Ok(Vec::new()),
    };
    let mut commits = Vec::new();
    for line in out.lines() {
        let f: Vec<&str> = line.split(US).collect();
        if f.len() < 4 {
            continue;
        }
        commits.push(MergeCommit {
            short: f[0].to_string(),
            subject: f[1].to_string(),
            author: f[2].to_string(),
            date_iso: f[3].to_string(),
        });
    }
    Ok(commits)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::path::PathBuf;

    #[test]
    fn parse_branch_extracts_source() {
        assert_eq!(
            parse_branch("Merge branch 'feature/young' into sit"),
            "feature/young"
        );
        assert_eq!(parse_branch("Merge branch 'hotfix' into sit"), "hotfix");
        assert_eq!(parse_branch("no quotes here"), "");
    }

    fn git(repo: &str, args: &[&str]) {
        let ok = Command::new("git")
            .arg("-C")
            .arg(repo)
            .args(args)
            .output()
            .expect("git runs")
            .status
            .success();
        assert!(ok, "git {args:?} failed");
    }

    /// Build a throwaway repo with one real --no-ff merge and exercise the real command fns.
    #[test]
    fn end_to_end_against_real_repo() {
        // unique temp dir (no external tempfile dep)
        let mut dir: PathBuf = std::env::temp_dir();
        dir.push(format!("mergescope_test_{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let repo = dir.to_string_lossy().to_string();

        git(&repo, &["init", "-b", "main"]);
        git(&repo, &["config", "user.email", "t@t"]);
        git(&repo, &["config", "user.name", "Tester"]);
        fs::write(dir.join("a.txt"), "1").unwrap();
        git(&repo, &["add", "."]);
        git(&repo, &["commit", "-m", "init"]);

        git(&repo, &["checkout", "-b", "feature/demo"]);
        fs::write(dir.join("b.txt"), "2").unwrap();
        git(&repo, &["add", "."]);
        git(&repo, &["commit", "-m", "add feature work"]);

        git(&repo, &["checkout", "main"]);
        git(
            &repo,
            &["merge", "--no-ff", "feature/demo", "-m", "Merge branch 'feature/demo' into main"],
        );

        let def = default_branch(repo.clone()).unwrap();
        assert_eq!(def, "main");

        let branches = list_branches(repo.clone()).unwrap();
        assert!(branches.contains(&"main".to_string()));
        assert!(branches.contains(&"feature/demo".to_string()));

        let merges = list_merges(repo.clone(), "main".to_string()).unwrap();
        assert_eq!(merges.len(), 1, "exactly one merge on the first-parent line");
        let m = &merges[0];
        assert_eq!(m.branch, "feature/demo");
        assert!(!m.is_hotfix);
        assert_eq!(m.target, "main");
        assert!(!m.short.is_empty() && !m.date_iso.is_empty());

        let commits = list_merge_commits(repo.clone(), m.hash.clone()).unwrap();
        assert_eq!(commits.len(), 1, "the merge brought in one commit");
        assert_eq!(commits[0].subject, "add feature work");
        assert_eq!(commits[0].author, "Tester");

        // batch count matches the expanded list
        let counts = count_merge_commits(repo.clone(), vec![m.hash.clone()]).unwrap();
        assert_eq!(counts.len(), 1);
        assert_eq!(counts[0].hash, m.hash);
        assert_eq!(counts[0].count, 1);

        // Guard the wire contract: JSON keys must match the frontend's data-contract.ts.
        let json = serde_json::to_string(m).unwrap();
        assert!(json.contains("\"dateIso\""), "camelCase key: {json}");
        assert!(json.contains("\"isHotfix\""), "camelCase key: {json}");
        assert!(!json.contains("date_iso"), "no snake_case leaks: {json}");

        let _ = fs::remove_dir_all(&dir);
    }
}
