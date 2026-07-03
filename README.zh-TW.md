# DeltaScope — 視覺化你的 Git 歷史

[English](README.md) · **繁體中文** · [日本語](README.ja.md)

一個輕量的 Tauri v2 桌面應用,讀取本機 Git repository,把歷史整理成可瀏覽的時間軸。
它回答那些在命令列上很難處理的問題:

- **每個 merge 到底帶進了什麼?** —— 而且當一個 merge 裡還包著其他 merge 時,可以一層一層鑽進去。
- **哪些檔案被刪除了、什麼時候刪的?** —— 涵蓋整段歷史的每次刪除,附上可直接複製的還原指令。
- **哪些檔案被更名或搬移?** —— 區分純搬移與「搬移又改了內容」,同樣涵蓋整段歷史。

UI 是自訂視窗外框的桌面視窗;後端直接呼叫系統的 `git` CLI(不用 libgit2),
而且所有面向使用者的字串都提供**繁體中文、英文、日文**三種語言。

## 技術組成

- **前端:** React 18 + TypeScript(strict)+ Vite
- **後端:** Rust(Tauri v2),呼叫系統的 `git` CLI
- **清單虛擬化:** `@tanstack/react-virtual`
- **資料夾選擇:** `@tauri-apps/plugin-dialog`

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
  - **雙擊** 開啟**全螢幕合併檢視** —— 一份專屬、虛擬化的內含 commit 清單,附麵包屑。
    若某個內含 commit 本身也是 merge,就能再往下鑽一層(`main › feature/x › temp`),
    無深度上限。打開一個 merge 永遠不會落到空白 diff(git 對 merge commit 不輸出 patch);
    它一律顯示這個 merge 帶進了什麼。
- **Remove(已刪除檔案)** —— 整段歷史中被刪除的每一個檔案
  (`git log --all --diff-filter=D`)。每一列顯示刪除的 commit、作者、來源分支;
  詳情面板提供可複製的還原指令,以及檢視「刪除前內容」的指令。
- **Rename(已更名檔案)** —— 整段歷史中被更名或搬移的每一個檔案
  (`git log --all --diff-filter=R -M`)。用相似度分數區分「純搬移」與「搬移又改動內容」,
  並提供追蹤該檔案完整歷史、以及檢視這次更名的指令。

每個檢視都在前端(client-side)篩選:依類型 / 分支 / 日期區間 / 全文搜尋
(路徑、檔名、作者、hash、訊息)。只有在 Branch 檢視中切換**目標分支**會重新抓資料
(因為 `git log` 的範圍變了)。

## 檔案結構

```
src/
  App.tsx               標題列 + 工具列 + Branch 檢視 + 共用狀態 / 篩選
  DeletedFilesView.tsx  Remove 檢視
  RenamedFilesView.tsx  Rename 檢視
  MergeView.tsx         全螢幕合併 overlay(導覽堆疊 + 麵包屑,虛擬化)
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

## 註記 / 刻意的設計選擇

- **自訂標題列。** 關閉了原生視窗外框(`tauri.conf.json`);三顆紅綠燈點分別接到
  關閉 / 最小化 / 縮放,整條標題列是拖曳區。
- **i18n 是輕量、零依賴的自製層。** `zh-TW` 是基準字典;從它推導出的 `Dict` 型別
  強制 `en`/`ja` 保持結構完全相同,所以少翻一個 key 會是 `tsc` 編譯錯誤,而不是執行期才爆。
  `t()` 支援 `{name}` 插值,缺字時 fallback 到 `zh-TW`。
- **commit 數在背景補上。** Git 無法不做逐 merge 查詢就給出某個 merge 的內含 commit 數,
  所以清單先立刻顯示,背景再以一支便宜的 `git rev-list --count <h>^1..^2`
  (每個 merge 一支)把 `N commits` 欄補上;數字到之前該欄位是暗的。
- **清單全部虛擬化。** 每個長清單(分支歷史與全螢幕合併檢視)都用
  `@tanstack/react-virtual` 開視窗(以 `measureElement` 支援動態列高,所以就地展開仍可用)
  —— 只有可見的列在 DOM 裡,上千個 commit 也能保持流暢。
- **篩選在前端做。** 每個檢視的歷史載入一次;類型 / 分支 / 日期 / 搜尋都在記憶體裡篩。
- **大型 repo。** 這些列表指令沒有 `--max-count` 分頁 —— 整段歷史一次載入
  (對一般 repo 沒問題;虛擬化讓渲染很便宜)。若 repo 有數萬筆,加上
  `--skip`/`--max-count` 分頁會讓前端篩選只作用在已載入的分頁上。

## 開發 / 品質關卡

- **型別檢查 + lint:** `npm run build`(`tsc` strict)與 `npm run lint`
  (ESLint —— 補上 `tsc` 看不到的東西,尤其是 react-hooks 依賴檢查)。
- **後端測試:** 在 `src-tauri/` 內 `cargo test` —— 每個測試會建一個含真實 merge 的
  臨時 repo,對真實 `git` 輸出做斷言。

## 授權

DeltaScope 採用 **CC BY-NC-ND 4.0**(姓名標示-非商業性-禁止改作)授權。
你可以免費使用與分享,但不可販售,也不可散布修改後的版本。詳見 [LICENSE](LICENSE)。
