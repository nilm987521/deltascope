// 基準語系。此物件的結構即 Dict 型別;en/ja 必須與它同構。
export const zhTW = {
  common: {
    loading: "讀取中…",
    loadingShort: "載入中…",
    copy: "複製",
    copied: "已複製指令",
    author: "作者",
    branch: "分支",
    time: "時間",
    byCommit: "依 commit",
    noMatch: "沒有符合條件的檔案",
  },
  titlebar: {
    close: "關閉",
    minimize: "最小化",
    zoom: "縮放",
    refresh: "重新整理",
  },
  tabs: {
    deletedFiles: "已刪除檔案",
    renamedFiles: "已更名檔案",
    branchHistory: "分支歷史",
    segBranch: "分支",
    segRemove: "刪除",
    segRename: "更名",
  },
  repo: {
    pick: "選擇 Git repository",
    pickStart: "選擇一個 Git repository 開始",
    pickFolder: "選擇資料夾…",
    noDeleted: "此 repository 沒有被刪除的檔案",
    noRenamed: "此 repository 沒有更名/搬移過的檔案",
  },
  filter: {
    all: "全部時間",
    last7d: "近 7 天",
    last30d: "近 30 天",
    last90d: "近 90 天",
    allTypes: "全部類型（{n}）",
    allBranches: "全部分支（{n}）",
  },
  status: {
    reloaded: "已重新讀取 · 剛剛",
  },
  branchView: {
    toggle: "檢視分支",
  },
  list: {
    showing: "顯示",
  },
  mergeList: {
    searchPlaceholder: "搜尋分支、訊息、作者、hash…",
    empty: "沒有符合條件的 commit",
    loadingContained: "載入內含 commit…",
    broughtInPre: "此合併帶進",
    broughtInPost: "個 commit",
    noSecondParent: "（此合併沒有第二父，或為 fast-forward — 無內含 commit）",
  },
  diff: {
    viewCode: "檢視程式碼異動",
    back: "← 返回清單",
    filesSuffix: "個檔案",
    loadingCode: "載入程式碼異動…",
    noFileChanges: "此 commit 沒有檔案異動（可能是合併節點）",
    changedFiles: "變更的檔案",
    openDefault: "雙擊以系統預設程式開啟",
    binary: "二進位檔案，無法顯示差異",
  },
  deleted: {
    searchPlaceholder: "搜尋路徑、檔名、作者、hash…",
    tabFileList: "檔案清單",
    deletedCountPre: "已刪除",
    eyebrow: "已刪除檔案",
    deleteCommit: "刪除 commit",
    restore: "還原此檔案",
    viewBefore: "檢視刪除前內容",
  },
  renamed: {
    searchPlaceholder: "搜尋新舊路徑、作者、hash…",
    tabMoveEdit: "搬移+改動",
    moveEditBadge: "搬移+改動 {n}%",
    pureMove: "純搬移",
    moveEditTitle: "搬移 + 改動",
    renamedCountPre: "已更名",
    oldPath: "原路徑",
    newPath: "新路徑",
    similarity: "相似度",
    contentChanged: "（內容也有變動）",
    moveOnly: "（僅移動）",
    renameCommit: "更名 commit",
    trackHistory: "追蹤此檔案完整歷史",
    viewRename: "檢視這次更名",
  },
} as const;

// zhTW 以 `as const` 宣告以利下方 TKey 產生字面量聯集,但這也讓每個 leaf 變成
// 該中文字串的 literal type。Dict 若直接等於 `typeof zhTW`,會導致其他語系
// (en/ja) 的翻譯因文字不同而無法通過型別檢查。這裡把 leaf 型別放寬為 `string`,
// 只保留巢狀的 group/key 結構(這才是「同構」檢查真正要驗證的東西)。
type Widen<T> = { [K in keyof T]: T[K] extends string ? string : Widen<T[K]> };
export type Dict = Widen<typeof zhTW>;

// 產生所有 "group.key" 巢狀路徑的字面量聯集。
export type TKey = {
  [G in keyof Dict]: {
    [K in keyof Dict[G]]: `${G & string}.${K & string}`;
  }[keyof Dict[G]];
}[keyof Dict];
