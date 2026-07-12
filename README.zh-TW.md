# DeltaScope — 視覺化你的 Git 歷史

[English](README.md) · **繁體中文** · [日本語](README.ja.md)

一個輕量的 Tauri v2 桌面應用,讀取本機 Git repository,把歷史整理成可瀏覽的時間軸。
它回答那些在命令列上很難處理的問題:

- **每個 merge 到底帶進了什麼?** —— 而且當一個 merge 裡還包著其他 merge 時,可以一層一層鑽進去。
- **哪些檔案被刪除了、什麼時候刪的?** —— 涵蓋整段歷史的每次刪除,附上可直接複製的還原指令。
- **哪些檔案被更名或搬移?** —— 區分純搬移與「搬移又改了內容」,同樣涵蓋整段歷史。

UI 是自訂視窗外框的桌面視窗;後端直接呼叫系統的 `git` CLI(不用 libgit2),
而且所有面向使用者的字串都提供**繁體中文、英文、日文**三種語言。

**設計上就是唯讀。** DeltaScope 只會**查詢**你的 repository —— 它執行的都是唯讀的
`git` 指令(`log`、`show`、`rev-list`、`branch` 等),絕不寫入。它不會 commit、
checkout、reset,也不會更動任何一個檔案。它提供的還原與檢視指令只是幫你複製到剪貼簿,
由你自己執行;應用程式本身從不執行它們。可以放心指向任何 repo。

## 技術組成

- **前端:** React 18 + TypeScript(strict)+ Vite
- **後端:** Rust(Tauri v2),呼叫系統的 `git` CLI
- **清單虛擬化:** `@tanstack/react-virtual`
- **資料夾選擇:** `@tauri-apps/plugin-dialog`

## 安裝(macOS)

發佈的 `.dmg` 是 **ad-hoc 簽章、未經公證(notarization)**。因為是從網路下載的,
macOS 會把它加上隔離標記,導致第一次啟動被擋(「無法驗證開發者」)。安裝後執行一次
以下指令清除隔離標記即可:

```bash
xattr -dr com.apple.quarantine /Applications/DeltaScope.app
```

或者:對 app 按右鍵 →**打開**,或到**系統設定 → 隱私權與安全性 →「仍要打開」**。
這是每次下載只需做一次的動作。

## 執行

需要 Node、Rust 工具鏈,以及 PATH 上的 `git`。

```bash
npm install
npm run tauri dev      # 熱重載的開發模式(真正的 app)
npm run tauri build    # 產出正式版打包
```

啟動後,點工具列的路徑按鈕選一個 Git repository,再用 **Branch / Remove / Rename**
分頁切換檢視。語言切換(繁 / EN / 日)在標題列右側;你的選擇會在重開後保留,
未選擇時則跟隨系統語言。

## 三個檢視

- **Branch(分支)** —— 某個分支的 first-parent 歷史(`git log --first-parent`)。
  一般 commit 點開檔案 diff。合併 commit 可以:
  - **單擊** 就地展開,快速預覽它帶進來的 commit(`git log <merge>^1..<merge>^2`);或
  - **雙擊** 開啟**合併檢視** —— 一份專屬、虛擬化的內含 commit 清單,附麵包屑。
    若某個內含 commit 本身也是 merge,就能再往下鑽一層(`main › feature/x › temp`),
    無深度上限。打開一個 merge 永遠不會落到空白 diff(git 對 merge commit 不輸出 patch);
    它一律顯示這個 merge 帶進了什麼。

  ![Branch 檢視 —— 某分支的 first-parent 歷史,每個 merge 是一顆彩色藥丸](screenshots/branch-view.png)

  ![單擊一個 merge 就地展開,預覽它帶進來的 commit](screenshots/merge-view.png)

- **Remove(已刪除檔案)** —— 整段歷史中被刪除的每一個檔案
  (`git log --all --diff-filter=D`)。每一列顯示刪除的 commit、作者、來源分支;
  詳情面板提供可複製的還原指令,以及檢視「刪除前內容」的指令。

  ![Remove 檢視 —— 整段歷史中被刪除的每個檔案,附還原指令](screenshots/remove-view.png)

- **Rename(已更名檔案)** —— 整段歷史中被更名或搬移的每一個檔案
  (`git log --all --diff-filter=R -M`)。用相似度分數區分「純搬移」與「搬移又改動內容」,
  並提供追蹤該檔案完整歷史、以及檢視這次更名的指令。

  ![Rename 檢視 —— 整段歷史中被搬移或更名的每個檔案,附相似度分數](screenshots/rename-view.png)

每個檢視都在前端(client-side)篩選:依類型 / 分支 / 日期區間 / 全文搜尋
(路徑、檔名、作者、hash、訊息)。只有在 Branch 檢視中切換**目標分支**會重新抓資料
(因為 `git log` 的範圍變了)。

## 檔案結構

```
src/
  App.tsx               標題列 + 工具列 + Branch 檢視 + 共用狀態 / 篩選
  DeletedFilesView.tsx  Remove 檢視
  RenamedFilesView.tsx  Rename 檢視
  MergeView.tsx         合併檢視 overlay(導覽堆疊 + 麵包屑,虛擬化)
  ContainedRow.tsx      單一內含 commit 列(commit → diff,巢狀 merge → 鑽入)
  git.ts                invoke() 包裝 + 資料夾選擇
  sys.ts                以系統預設程式開啟的包裝
  rows.ts               commit → row 映射、各分支色相指派、subject 解析
  data-contract.ts      前後端共用型別(需與 Rust serde 形狀一致)
  styles.css            oklch 配色、IBM Plex 字型、視窗 / 元件尺寸
  i18n/
    index.ts            t()、LangProvider、useI18n、detectLang
    locales/            zh-TW(基準)· en · ja —— 以 Dict 型別維持結構同構
src-tauri/
  src/git.rs            default_branch, list_branches, list_branch_commits,
                        count_merge_commits, list_merge_commits, commit_diff,
                        list_deleted_files, list_renamed_files
  src/sys.rs            open_path
  src/lib.rs            Tauri builder + 指令註冊 + dialog plugin
```

## 授權

DeltaScope 採用 **GNU Affero General Public License v3.0**(AGPL-3.0)授權。
你可以自由使用、修改與散布,但衍生作品(包含透過網路提供的服務)必須以相同授權釋出,
並提供其原始碼。詳見 [LICENSE](LICENSE)。
