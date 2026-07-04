# X Research Extractor（手動実行型Chrome拡張・最小実装）

note-writer本体・DBとは無関係の、独立したChrome拡張です。
`app/`・`components/`・`lib/`など、note-writer本体のコードは一切変更していません。

## 位置づけ

これは単なるスクレイピングツールではなく、将来的な以下の仕組みの「入口」として
作られています（今回はこの拡張＝抽出とローカル出力までが対象範囲です）。

```
リサーチ専用Xアカウントで伸びている投稿を収集
→ リサーチDBへ保存
→ テーマ・悩み・投稿構造を分析
→ 別人格アカウントの投稿を作成
→ X・Threadsで需要を検証
→ 反応の良いテーマから有料noteを作成
→ 投稿結果と売上を蓄積
```

## この拡張がやらないこと

- Chromeウェブストアへの公開
- Xへの自動ログイン・自動スクロール・自動リロード
- 「さらに表示」の自動クリック
- いいね・返信・リポスト・フォロー・投稿・DM・設定変更
- Cookieやログイン情報の読み出し・保存
- ローカルストレージ（chrome.storage / localStorage）への保存
- バックグラウンドでの巡回・定期実行（background scriptを持たない）
- 拡張機能側からのネットワーク通信（fetch / XMLHttpRequest / WebSocket / 外部フォーム送信）
- note-writer本体・DBへの送信
- Anthropic API・Claude・Fable・その他AIの使用

※Xページ自身がページ表示や内部通信のために行う通常の通信は対象外です。
　ここで禁止しているのは、あくまで拡張機能のコードが新たに発生させる通信です。

## 構成

```
research/x-research-extension/
  manifest.json       Manifest V3定義（permissions: activeTab, scripting のみ）
  popup.html          ポップアップUI
  popup.css           スタイル
  popup.js            UIロジック（chrome.scripting.executeScriptで注入・実行）
  extractor-core.js   DOM抽出のコアロジック（extractXPostsCore関数）
  README.md           このファイル
```

background scriptやcontent_scriptsの宣言は存在しません。
ポップアップを開いてボタンを押したときだけ、その場でアクティブタブに
スクリプトを注入して実行します。

## 使用しているChrome権限

- `activeTab`：ポップアップ（拡張アイコン）をクリックした時点で、現在アクティブな
  タブに対してのみ一時的に付与される権限。抽出処理はこの権限の範囲内で行う。
- `scripting`：`chrome.scripting.executeScript` を使うために必要。

`host_permissions` は宣言していません（`activeTab` の範囲で完結するため）。
`cookies` / `storage` / 常駐の `background` 権限も使用していません。

## 既存の検証済みロジックの再利用について

`extractor-core.js` の `extractXPostsCore(maxPosts)` 関数は、実機検証済みの
`research/x-post-extractor/extract-x-posts.js` から**同名関数の内容をそのまま
コピー**したものです。DOMセレクタ・正規表現・キーワード判定のロジックは
一切書き直していません。

Chrome拡張は「読み込み時に選択したフォルダ（`x-research-extension/`）」が
リソースの読み込み範囲になるため、フォルダ外の `x-post-extractor/` を
直接参照することができません。そのため物理的には別ファイルですが、
関数の中身は完全に同一です（`diff`で比較し一致を確認済み）。

今後アルゴリズムを変更する場合は、両ファイルの `extractXPostsCore` を
同時に更新してください。

## JSONコピー・ダウンロードの仕組み

- **コピー**：`navigator.clipboard.writeText()`。ポップアップ内のボタンクリック
  （ユーザー操作）から呼び出すため、追加の権限は不要。
- **ダウンロード**：`Blob` を作成し、`URL.createObjectURL()` で一時URLを発行、
  非表示の `<a download>` 要素をクリックしてブラウザの通常のローカル保存を
  発生させる。`chrome.downloads` APIは使用していない（`downloads` 権限が
  不要になり、`activeTab`・`scripting` のみで完結する）。

どちらもネットワーク通信を一切発生させません。

## 使い方（Chromeへの読み込み手順）

1. Chromeで `chrome://extensions` を開く
2. 右上の「デベロッパーモード」をONにする
3. 「パッケージ化されていない拡張機能を読み込む」をクリック
4. `research/x-research-extension/` フォルダを選択する
5. 拡張機能一覧に「X Research Extractor (Manual, Local Only)」が表示される
6. リサーチ専用XアカウントでXにログインし、検索結果の「最新」タブを開く
7. ツールバーの拡張機能アイコンをクリックしてポップアップを開く
8. 取得件数（初期値5、1〜20）を確認し、「抽出する」を押す
9. 一覧に表示された投稿から、保存したいものだけチェックを入れる
   （「全選択」「全解除」も利用可能）
10. 「選択した投稿をJSONコピー」または「選択した投稿をJSONダウンロード」を押す

## 一覧に表示する項目

投稿者名・@ハンドル・本文冒頭・投稿日時（表示用に変換済み。JSON内の
`postedAtRaw` は生の値のまま）・返信数・リポスト数・いいね数・ブックマーク数・
表示数・投稿URL

## JSONに含まれる項目

`postId` / `url` / `authorName` / `authorHandle` / `postedAtRaw` / `text` /
`isTextTruncated` / `replies` / `reposts` / `likes` / `bookmarks` / `views`

未検出の反応数は `0` ではなく `null` です。`postId` が重複する投稿は除外されます。

## 対象ページの判定

- `x.com` または `twitter.com` の `/search` パス以外を開いている場合、
  「Xの検索結果ページを開いてください」と表示し、抽出ボタンを無効化します。
- 検索結果ページであっても、URLに「最新」タブを示す `f=live` が無い場合は
  警告を表示しますが、処理はブロックしません（自動でのタブ切り替え・
  ページ遷移は一切行いません）。

## 静的チェック結果（実施済み）

- `node --check` によるJavaScript構文チェック：`extractor-core.js` / `popup.js`
- `manifest.json` のJSON構文・内容確認（`permissions` は `activeTab` と
  `scripting` のみ、`host_permissions` なし）
- `fetch` / `XMLHttpRequest` / `WebSocket` / 外部URL・外部スクリプト（CDN等）の
  不使用をgrepで確認
- note-writer本体（`app/` / `components/` / `lib/`）からimportされていないことを
  grepで確認
- 既存のConsole版抽出スクリプト（`research/x-post-extractor/extract-x-posts.js`）
  が壊れていないこと（`node --check`で再確認）

## 既知の制約

- 実際のChromeへの読み込み・実機実行はまだ行っていません（静的確認のみ）。
- 日本語UI・英語UIでの `aria-label` 文言パターンは、`extract-x-posts.js` 側の
  実機検証（Claude in Chromeとの突き合わせ）で確認済みですが、それ以外の
  UIバリエーションは未検証です。
- 「最新」タブの判定はURLの `f=live` パラメータのみに依存しています。Xが
  将来URL形式を変更した場合、判定が効かなくなる可能性があります。
- ポップアップを閉じると抽出結果は破棄されます（永続化していません）。
