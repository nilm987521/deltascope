# DeltaScope — リポジトリの Git 履歴を可視化

[English](README.md) · [繁體中文](README.zh-TW.md) · **日本語**

ローカルの Git リポジトリを読み込み、その履歴を閲覧しやすいタイムラインに変える
軽量な Tauri v2 デスクトップアプリです。コマンドラインでは扱いにくい問いに答えます:

- **各マージは実際に何を取り込んだのか?** —— マージの中にさらにマージが含まれる場合は、
  一段ずつ掘り下げられます。
- **どのファイルが、いつ削除されたのか?** —— 全履歴にわたるすべての削除を、
  すぐコピーできる復元コマンド付きで表示します。
- **どのファイルが名前変更・移動されたのか?** —— 純粋な移動と「移動かつ内容変更」を
  区別し、こちらも全履歴を対象にします。

UI はカスタムウィンドウ枠のデスクトップウィンドウで、バックエンドはシステムの
`git` CLI を直接呼び出します(libgit2 は不使用)。そしてユーザー向けのすべての文言が
**繁体字中国語・英語・日本語**の 3 言語で利用できます。

## スクリーンショット

| Branch(ブランチ)ビュー | マージをその場で展開 |
| --- | --- |
| ![Branch ビュー —— ブランチの first-parent 履歴、各マージは色付きピル](screenshots/branch-view.png) | ![マージをシングルクリックしてその場で展開し、取り込んだコミットをプレビュー](screenshots/merge-view.png) |

| Remove(削除)ビュー | Rename(名前変更)ビュー |
| --- | --- |
| ![Remove ビュー —— 全履歴で削除された各ファイル、復元コマンド付き](screenshots/remove-view.png) | ![Rename ビュー —— 全履歴で移動・名前変更された各ファイル、類似度スコア付き](screenshots/rename-view.png) |

## 技術スタック

- **フロントエンド:** React 18 + TypeScript(strict)+ Vite
- **バックエンド:** Rust(Tauri v2)、システムの `git` CLI を呼び出し
- **リスト仮想化:** `@tanstack/react-virtual`
- **フォルダ選択:** `@tauri-apps/plugin-dialog`

## 実行

Node、Rust ツールチェーン、そして PATH 上の `git` が必要です。

```bash
npm install
npm run tauri dev      # ホットリロード付き開発モード(実際のアプリ)
npm run tauri build    # 本番用バンドルを生成
```

起動したら、ツールバーのパスボタンで Git リポジトリを選び、**Branch / Remove / Rename**
タブでビューを切り替えます。言語スイッチャー(繁 / EN / 日)はタイトルバー右側にあり、
選択は再起動後も保持され、未選択の場合はシステム言語に従います。

## 3 つのビュー

- **Branch(ブランチ)** —— ブランチの first-parent 履歴(`git log --first-parent`)。
  通常のコミットはファイル差分を開きます。マージコミットは:
  - **シングルクリック**でその場に展開し、取り込んだコミットをすばやくプレビュー
    (`git log <merge>^1..<merge>^2`);または
  - **ダブルクリック**で**マージビュー**を開きます —— 取り込んだコミットの
    専用の仮想化リストで、パンくずリスト付き。含まれるコミット自体がマージなら、
    さらに一段掘り下げられ(`main › feature/x › temp`)、深さの制限はありません。
    マージを開いても空の差分に行き着くことはありません(git はマージコミットに
    パッチを出力しません);常にそのマージが取り込んだ内容を表示します。
- **Remove(削除されたファイル)** —— 全履歴で削除されたすべてのファイル
  (`git log --all --diff-filter=D`)。各行に削除したコミット・作成者・ソースブランチを
  表示し、詳細パネルにはコピーできる復元コマンドと、削除直前の内容を表示するコマンドが
  あります。
- **Rename(名前変更されたファイル)** —— 全履歴で名前変更・移動されたすべてのファイル
  (`git log --all --diff-filter=R -M`)。類似度スコアで「純粋な移動」と「移動かつ内容変更」を
  区別し、ファイルの全履歴を追跡するコマンドと、その名前変更を表示するコマンドを提供します。

各ビューはフロントエンド(client-side)で絞り込みます:種類 / ブランチ / 期間 /
全文検索(パス・ファイル名・作成者・ハッシュ・メッセージ)。再取得が走るのは
Branch ビューで**対象ブランチ**を切り替えたときだけです(`git log` の範囲が変わるため)。

## ファイル構成

```
src/
  App.tsx               タイトルバー + ツールバー + Branch ビュー + 共有状態 / 絞り込み
  DeletedFilesView.tsx  Remove ビュー
  RenamedFilesView.tsx  Rename ビュー
  MergeView.tsx         マージビュー overlay(ドリルスタック + パンくず、仮想化)
  ContainedRow.tsx      内包コミット 1 行(commit → diff、ネストしたマージ → 掘り下げ)
  git.ts                invoke() ラッパー + フォルダ選択
  sys.ts                既定アプリで開くラッパー
  rows.ts               commit → row マッピング、ブランチごとの色相割り当て、subject 解析
  data-contract.ts      フロント/バック共有型(Rust の serde 形状と一致させる)
  styles.css            oklch パレット、IBM Plex フォント、ウィンドウ / 部品の寸法
  i18n/
    index.ts            t()、LangProvider、useI18n、detectLang
    locales/            zh-TW(基準)· en · ja —— Dict 型で構造を同型に保つ
src-tauri/
  src/git.rs            default_branch, list_branches, list_branch_commits,
                        count_merge_commits, list_merge_commits, commit_diff,
                        list_deleted_files, list_renamed_files
  src/sys.rs            open_path
  src/lib.rs            Tauri builder + コマンド登録 + dialog plugin
```

## 補足 / 意図的な設計判断

- **カスタムタイトルバー。** ネイティブの枠は無効(`tauri.conf.json`);3 つの
  信号機ドットは 閉じる / 最小化 / ズーム に配線され、バー全体がドラッグ領域です。
- **i18n は軽量・依存ゼロの自作レイヤー。** `zh-TW` が基準辞書で、そこから導いた
  `Dict` 型が `en`/`ja` を構造的に同一に保つため、翻訳漏れは実行時ではなく `tsc` の
  コンパイルエラーになります。`t()` は `{name}` の補間に対応し、欠落時は `zh-TW` に
  フォールバックします。
- **コミット数は背景で埋まる。** Git はマージごとの問い合わせなしに内包コミット数を
  出せないため、リストはすぐ表示され、背景で 1 本の安価な
  `git rev-list --count <h>^1..^2`(マージごと)が `N commits` 列を少し遅れて埋めます;
  届くまでその欄は淡色表示です。
- **リストはすべて仮想化。** 長いリスト(ブランチ履歴とマージビュー)はすべて
  `@tanstack/react-virtual` でウィンドウ化し(`measureElement` による動的行高で、
  その場の展開も機能)、可視の行だけが DOM に存在するため、数千コミットでも滑らかです。
- **絞り込みはフロントエンドで。** 各ビューの履歴は一度だけ読み込み、種類 / ブランチ /
  期間 / 検索はメモリ上で絞り込みます。
- **大規模リポジトリ。** これらのリストコマンドに `--max-count` ページングはなく、
  全履歴を一度に読み込みます(一般的なリポジトリでは問題なく、仮想化により描画は安価)。
  数万件規模のリポジトリでは、`--skip`/`--max-count` ページングを追加すると、
  フロント側の絞り込みは読み込み済みのページのみを対象にすることになります。

## 開発 / 品質ゲート

- **型チェック + lint:** `npm run build`(`tsc` strict)と `npm run lint`
  (ESLint —— `tsc` では見えないもの、特に react-hooks の依存配列チェックを補う)。
- **バックエンドテスト:** `src-tauri/` 内で `cargo test` —— 各テストは実際のマージを
  含む使い捨てリポジトリを作り、本物の `git` 出力に対して検証します。

## ライセンス

DeltaScope は **CC BY-NC-ND 4.0**(表示-非営利-改変禁止)でライセンスされています。
無償で使用・共有できますが、販売すること、および改変版を配布することはできません。
[LICENSE](LICENSE) を参照してください。
