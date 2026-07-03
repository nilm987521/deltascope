// src-tauri/src/git.rs
// Read a repository through the system `git` CLI. No git2 crate — just std::process::Command.
// Every invocation uses `git -C <repo> ...` so the process working directory is never changed.

use serde::Serialize;
use std::process::Command;

// Use US (\x1f) as the field separator so whitespace inside messages never mis-splits a row.
const US: char = '\u{1f}';

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
    pub add: u32,   // lines added across the commit (numstat)
    pub del: u32,   // lines deleted across the commit (numstat)
    pub files: u32, // files touched
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BranchCommit {
    pub hash: String,     // full SHA (%H) — expand key for merges
    pub short: String,    // %h
    pub date_iso: String, // %cI
    pub author: String,   // %an
    pub subject: String,  // %s
    pub is_merge: bool,   // %P has more than one parent
    pub branch: String,   // parse_branch(subject) for merges; "" otherwise
}

/// One line of a unified diff, already resolved to old/new line numbers.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiffLine {
    pub kind: String,       // "hunk" | "add" | "del" | "context"
    pub old_no: Option<u32>,
    pub new_no: Option<u32>,
    pub text: String, // line content without the +/-/space prefix; for "hunk", the @@ header
}

/// One file's changes within a commit.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileDiff {
    pub path: String,
    pub status: String, // "A" | "M" | "D" | "R" | "C"
    pub add: u32,
    pub del: u32,
    pub binary: bool,
    pub lines: Vec<DiffLine>,
}

/// A commit's full diff (git show <sha>).
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitDiff {
    pub short: String,
    pub subject: String,
    pub author: String,
    pub date_iso: String,
    pub add: u32,
    pub del: u32,
    pub files: Vec<FileDiff>,
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
    // --numstat appends "<add>\t<del>\t<path>" rows after each commit's header line, so the
    // per-commit add/del/files totals come from the same call that lists the commits.
    let fmt = format!("--pretty=format:%h{US}%s{US}%an{US}%cI");
    let range = format!("{merge}^1..{merge}^2");
    let out = match run_git(&repo, &["log", "--numstat", &fmt, &range]) {
        Ok(s) => s,
        Err(_) => return Ok(Vec::new()),
    };
    let mut commits: Vec<MergeCommit> = Vec::new();
    for line in out.lines() {
        if line.contains(US) {
            // header line for a new commit
            let f: Vec<&str> = line.split(US).collect();
            if f.len() < 4 {
                continue;
            }
            commits.push(MergeCommit {
                short: f[0].to_string(),
                subject: f[1].to_string(),
                author: f[2].to_string(),
                date_iso: f[3].to_string(),
                add: 0,
                del: 0,
                files: 0,
            });
        } else if let Some(c) = commits.last_mut() {
            // numstat row: "<add>\t<del>\t<path>" ("-" for binary)
            let mut it = line.splitn(3, '\t');
            let (a, d) = (it.next(), it.next());
            if it.next().is_none() {
                continue; // not a numstat row (e.g. a blank separator)
            }
            c.files += 1;
            c.add += a.and_then(|s| s.parse::<u32>().ok()).unwrap_or(0);
            c.del += d.and_then(|s| s.parse::<u32>().ok()).unwrap_or(0);
        }
    }
    Ok(commits)
}

/// List a branch's own commits along its first-parent line (git log <branch>
/// --first-parent). Regular commits and merge commits both appear; is_merge
/// marks the merges, which the UI lets you expand via list_merge_commits.
#[tauri::command]
pub fn list_branch_commits(repo: String, branch: String) -> Result<Vec<BranchCommit>, String> {
    // %P is the space-separated parent list; more than one parent ⇒ a merge.
    let fmt = format!("--pretty=format:%H{US}%h{US}%cI{US}%an{US}%P{US}%s");
    let out = run_git(&repo, &["log", "--first-parent", &fmt, &branch])?;
    let mut commits = Vec::new();
    for line in out.lines() {
        let f: Vec<&str> = line.splitn(6, US).collect();
        if f.len() < 6 {
            continue;
        }
        let is_merge = f[4].split_whitespace().count() > 1;
        let subject = f[5].to_string();
        let branch_name = if is_merge {
            parse_branch(&subject)
        } else {
            String::new()
        };
        commits.push(BranchCommit {
            hash: f[0].to_string(),
            short: f[1].to_string(),
            date_iso: f[2].to_string(),
            author: f[3].to_string(),
            is_merge,
            branch: branch_name,
            subject,
        });
    }
    Ok(commits)
}

/// Full diff for a single commit (`git show <sha>`), parsed into files → lines.
#[tauri::command]
pub fn commit_diff(repo: String, sha: String) -> Result<CommitDiff, String> {
    let meta_fmt = format!("--format=%h{US}%s{US}%an{US}%cI");
    let meta = run_git(&repo, &["show", "-s", &meta_fmt, &sha])?;
    let mf: Vec<&str> = meta.trim().split(US).collect();
    let get = |i: usize| mf.get(i).map(|s| s.to_string()).unwrap_or_default();

    // Empty --format so only the patch is emitted; --find-renames surfaces R status.
    let patch = run_git(
        &repo,
        &["show", &sha, "--no-color", "--find-renames", "--format=", "--unified=3"],
    )?;
    let files = parse_patch(&patch);
    let (add, del) = files.iter().fold((0u32, 0u32), |(a, d), f| (a + f.add, d + f.del));

    Ok(CommitDiff {
        short: get(0),
        subject: get(1),
        author: get(2),
        date_iso: get(3),
        add,
        del,
        files,
    })
}

/// Extract the new-side path from a "diff --git a/PATH b/PATH" body (unquoted common case).
fn parse_diff_git_path(rest: &str) -> String {
    if let Some(idx) = rest.find(" b/") {
        return rest[idx + 3..].to_string();
    }
    rest.strip_prefix("a/").unwrap_or(rest).to_string()
}

/// From "@@ -12,7 +14,9 @@ ..." return the (old_start, new_start) line numbers.
fn parse_hunk(line: &str) -> Option<(u32, u32)> {
    let mut old = None;
    let mut new = None;
    for tok in line.split_whitespace() {
        if let Some(t) = tok.strip_prefix('-') {
            old = t.split(',').next().and_then(|x| x.parse::<u32>().ok());
        } else if let Some(t) = tok.strip_prefix('+') {
            new = t.split(',').next().and_then(|x| x.parse::<u32>().ok());
            break;
        }
    }
    Some((old?, new?))
}

/// Parse a unified-diff patch (git show output, commit header already stripped) into files.
fn parse_patch(patch: &str) -> Vec<FileDiff> {
    let mut files: Vec<FileDiff> = Vec::new();
    let mut old_no: u32 = 0;
    let mut new_no: u32 = 0;

    for line in patch.lines() {
        if let Some(rest) = line.strip_prefix("diff --git ") {
            files.push(FileDiff {
                path: parse_diff_git_path(rest),
                status: "M".to_string(),
                add: 0,
                del: 0,
                binary: false,
                lines: Vec::new(),
            });
            continue;
        }
        let Some(f) = files.last_mut() else { continue };

        if line.starts_with("new file mode") {
            f.status = "A".to_string();
        } else if line.starts_with("deleted file mode") {
            f.status = "D".to_string();
        } else if line.starts_with("rename from ") {
            f.status = "R".to_string();
        } else if let Some(to) = line.strip_prefix("rename to ") {
            f.status = "R".to_string();
            f.path = to.to_string();
        } else if let Some(to) = line.strip_prefix("copy to ") {
            f.status = "C".to_string();
            f.path = to.to_string();
        } else if line.starts_with("Binary files") || line.starts_with("GIT binary patch") {
            f.binary = true;
        } else if line.starts_with("@@") {
            if let Some((o, n)) = parse_hunk(line) {
                old_no = o;
                new_no = n;
            }
            f.lines.push(DiffLine {
                kind: "hunk".to_string(),
                old_no: None,
                new_no: None,
                text: line.to_string(),
            });
        } else if line.starts_with("+++") || line.starts_with("---") {
            // file path markers — status/path already captured above
        } else if let Some(rest) = line.strip_prefix('+') {
            f.add += 1;
            f.lines.push(DiffLine {
                kind: "add".to_string(),
                old_no: None,
                new_no: Some(new_no),
                text: rest.to_string(),
            });
            new_no += 1;
        } else if let Some(rest) = line.strip_prefix('-') {
            f.del += 1;
            f.lines.push(DiffLine {
                kind: "del".to_string(),
                old_no: Some(old_no),
                new_no: None,
                text: rest.to_string(),
            });
            old_no += 1;
        } else if let Some(rest) = line.strip_prefix(' ') {
            f.lines.push(DiffLine {
                kind: "context".to_string(),
                old_no: Some(old_no),
                new_no: Some(new_no),
                text: rest.to_string(),
            });
            old_no += 1;
            new_no += 1;
        }
        // "\ No newline at end of file", "index ...", mode lines → ignored
    }
    files
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::path::PathBuf;

    #[test]
    fn parse_hunk_reads_starts() {
        assert_eq!(parse_hunk("@@ -12,7 +14,9 @@ fn foo()"), Some((12, 14)));
        assert_eq!(parse_hunk("@@ -1 +1 @@"), Some((1, 1)));
        assert_eq!(parse_hunk("@@ -0,0 +1,5 @@"), Some((0, 1)));
    }

    #[test]
    fn parse_patch_resolves_line_numbers_and_status() {
        let patch = "\
diff --git a/src/x.ts b/src/x.ts
index 111..222 100644
--- a/src/x.ts
+++ b/src/x.ts
@@ -1,3 +1,4 @@
 keep
-old line
+new line
+extra line
 tail
diff --git a/new.txt b/new.txt
new file mode 100644
index 000..333
--- /dev/null
+++ b/new.txt
@@ -0,0 +1,1 @@
+hello
";
        let files = parse_patch(patch);
        assert_eq!(files.len(), 2);

        let x = &files[0];
        assert_eq!(x.path, "src/x.ts");
        assert_eq!(x.status, "M");
        assert_eq!(x.add, 2);
        assert_eq!(x.del, 1);
        // hunk header + 5 content lines
        assert_eq!(x.lines.len(), 6);
        assert_eq!(x.lines[0].kind, "hunk");
        // first content line is context "keep" at old 1 / new 1
        assert_eq!(x.lines[1].kind, "context");
        assert_eq!(x.lines[1].old_no, Some(1));
        assert_eq!(x.lines[1].new_no, Some(1));
        // "-old line" is del at old 2, no new number
        assert_eq!(x.lines[2].kind, "del");
        assert_eq!(x.lines[2].old_no, Some(2));
        assert_eq!(x.lines[2].new_no, None);
        // "+new line" is add at new 2, no old number
        assert_eq!(x.lines[3].kind, "add");
        assert_eq!(x.lines[3].old_no, None);
        assert_eq!(x.lines[3].new_no, Some(2));

        let n = &files[1];
        assert_eq!(n.path, "new.txt");
        assert_eq!(n.status, "A");
        assert_eq!(n.add, 1);
        assert_eq!(n.del, 0);
    }

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

        // single-branch view: main's first-parent line is [merge, init].
        // This is also where we get the merge commit's hash for the checks below.
        let bcs = list_branch_commits(repo.clone(), "main".to_string()).unwrap();
        assert_eq!(bcs.len(), 2, "first-parent main: merge + init");
        let merge = &bcs[0];
        assert!(merge.is_merge, "newest is the merge");
        assert_eq!(merge.branch, "feature/demo");
        assert!(!merge.short.is_empty() && !merge.date_iso.is_empty());
        assert!(!bcs[1].is_merge, "root commit is not a merge");
        assert_eq!(bcs[1].branch, "");
        assert_eq!(bcs[1].subject, "init");

        let commits = list_merge_commits(repo.clone(), merge.hash.clone()).unwrap();
        assert_eq!(commits.len(), 1, "the merge brought in one commit");
        assert_eq!(commits[0].subject, "add feature work");
        assert_eq!(commits[0].author, "Tester");
        // numstat: the brought-in commit added b.txt (one line, one file)
        assert_eq!(commits[0].files, 1);
        assert_eq!(commits[0].add, 1);
        assert_eq!(commits[0].del, 0);

        // full diff for that commit
        let diff = commit_diff(repo.clone(), commits[0].short.clone()).unwrap();
        assert_eq!(diff.short, commits[0].short);
        assert_eq!(diff.subject, "add feature work");
        assert_eq!(diff.files.len(), 1);
        let df = &diff.files[0];
        assert_eq!(df.path, "b.txt");
        assert_eq!(df.status, "A");
        assert_eq!(df.add, 1);
        assert!(df.lines.iter().any(|l| l.kind == "add" && l.text == "2"));

        // batch count matches the expanded list
        let counts = count_merge_commits(repo.clone(), vec![merge.hash.clone()]).unwrap();
        assert_eq!(counts.len(), 1);
        assert_eq!(counts[0].hash, merge.hash);
        assert_eq!(counts[0].count, 1);

        // Guard the wire contract: JSON keys must match the frontend's data-contract.ts.
        let json = serde_json::to_string(merge).unwrap();
        assert!(json.contains("\"dateIso\""), "camelCase key: {json}");
        assert!(json.contains("\"isMerge\""), "camelCase key: {json}");
        assert!(!json.contains("date_iso"), "no snake_case leaks: {json}");

        let _ = fs::remove_dir_all(&dir);
    }
}
