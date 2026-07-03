# Screenshots

The three README files (`README.md`, `README.zh-TW.md`, `README.ja.md`) reference
the images below. Drop PNGs here using these exact filenames and they'll appear
in all three:

| File | What it shows |
| --- | --- |
| `branch-view.png` | The **Branch** tab, rows collapsed — a branch's first-parent history with each merge as a colored pill. |
| `merge-view.png`  | The **Branch** tab with one merge single-clicked to expand inline, peeking at the commits it brought in. |
| `remove-view.png` | The **Remove** tab, with a deleted file selected so the restore command shows. |
| `rename-view.png` | The **Rename** tab, with a row selected so the similarity score / commands show. |

The current shots don't include the full-screen (window-filling) merge view opened
by double-clicking a merge; swap `merge-view.png` for one of it (breadcrumb visible)
if you'd rather feature that instead of the inline expansion.

Tips for clean captures:

- Run the real app (`npm run tauri dev`) against a repo with a rich history —
  DeltaScope's own repo works well.
- Capture just the app window (macOS: `Cmd-Shift-4`, then `Space`, then click the
  window) so the custom titlebar is included and the shadow stays tidy.
- Keep the four shots at a consistent window size so the README grid looks even.
- Take shots in whichever UI language you prefer; the captions are translated but
  the images are shared across all three READMEs.
