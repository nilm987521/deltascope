# DeltaScope — Git 合併歷史可視化

A small Tauri v2 desktop app that reads a local Git repository and renders
`git log --merges --first-parent` (every merge on the mainline) as a readable
timeline. Each row is one merge; click it to expand the commits that merge
brought in (`git log <merge>^1..<merge>^2`).

Implemented 1:1 from the design prototype `MergeScope App.dc.html`, with the
prototype's fake data replaced by real `git` output.

## Stack

- **Frontend:** React 19 + TypeScript + Vite
- **Backend:** Rust (Tauri v2), shelling out to the system `git` CLI
- **Folder picker:** `@tauri-apps/plugin-dialog`

## Run

Requires Node, the Rust toolchain, and `git` on PATH.

```bash
npm install
npm run tauri dev      # dev with hot reload
npm run tauri build    # production bundle
```

Launch, click the toolbar path button to pick a Git repository, choose a target
branch, and browse. Filter by type (feature / hotfix), branch, date range, or
free-text search (hash / branch / title / — once expanded — commit message &
author).

## Layout

```
src/
  App.tsx           UI + state + frontend filtering (mirrors the prototype's renderVals)
  git.ts            invoke() wrappers + folder picker
  rows.ts           merge → row mapping, per-branch hue assignment, titleOf
  data-contract.ts  shared Merge / MergeCommit types
  styles.css        ported tokens (oklch palette, IBM Plex fonts, dimensions)
src-tauri/
  src/git.rs        list_branches / list_merges / list_merge_commits / default_branch
  src/lib.rs        Tauri builder + command registration + dialog plugin
```

## Notes / deliberate choices

- **Custom titlebar.** Native decorations are off (`tauri.conf.json`); the three
  traffic-light dots are wired to close / minimize / zoom, and the bar is a drag
  region.
- **Commit counts fill in the background.** Git can't give a merge's
  contained-commit count without a per-merge lookup, so the list renders
  immediately and a background `count_merge_commits` call (cheap
  `git rev-list --count <h>^1..^2` per merge) populates the `N commits` column a
  moment later; the slot is dimmed until it arrives. Expanding a row still shows
  the exact commits and takes precedence over the background count.
- **Filtering is client-side.** All merges load once; type/branch/date/search
  filter in memory. Changing the *target branch* re-fetches (the `git log` range
  changes).
- **Virtualized list.** The merge list is windowed with `@tanstack/react-virtual`
  (dynamic row height via `measureElement`, so inline expansion still works) —
  only the visible rows are in the DOM, so it stays smooth at thousands of merges.
- **Large repos.** `list_merges` still has no `--max-count` paging; the whole
  merge history loads at once (fine for typical repos, and virtualization keeps
  rendering cheap). For repos with tens of thousands of merges, add `--max-count`
  / `--skip` paging in `list_merges` — note that would make client-side filtering
  operate only over loaded pages.
- Backend behaviour is covered by tests in `src-tauri/src/git.rs`
  (`cargo test` — builds a throwaway repo with a real merge and asserts).
