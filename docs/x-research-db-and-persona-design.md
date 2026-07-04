# note-writer：Xリサーチ DB・別人格運用基盤 設計調査報告書

作成日：2026-07-04
作成範囲：調査・設計比較のみ。コード変更・DB変更・環境変数変更・外部API呼び出し・commit・push・デプロイは一切行っていない。

凡例：
- 【事実】= 実際のファイル・コードから直接確認できたこと
- 【推測】= コードから読み取れる設計意図・蓋然性が高いが断定はしていないこと
- 【要決定】= コードだけでは判断できず、関さんの方針決定が必要なこと（勝手に決めていない）

前提：`docs/x-research-and-anonymous-account-current-state.md`（2026-07-04作成）を土台とし、その後のセッションで実施した以下の変更を反映して再調査した。
- APIルート40本中38本にサーバー側認証（`requireSitePassword`/`requireCronSecret`）を追加済み（未保護は`import`と`video-ideas`のみ、いずれも意図的）
- `cron/raindrop-sync`・`collect-substack-news`・`add-url-item`からAnthropic呼び出しを完全に除去済み
- Bright Dataの定期実行（cron）を停止済み、`TabSubstack.tsx`のBright Data関連UIを`BRIGHTDATA_UI_ENABLED = false`で非表示化済み（コード・APIルート・環境変数は削除せず維持）
- `research/x-post-extractor/`・`research/x-research-extension/`にて、Chrome拡張によるX投稿抽出の実機検証が完了（Claude in Chromeの結果と5件完全一致）

**改訂履歴**：2026-07-04、関さんのご指示に基づき第7・8・9・10・13・14・15・20章を改訂。第1段階のデータモデルを`research_posts`単体案から`research_posts`＋`research_post_accounts`の2テーブル構成へ確定し、アカウント分離・別人格の扱い・一次情報の将来制約・ブックマーク率の算出方針・`search_query`の取り込み方法を確定した。今回の改訂は本ファイルの記述変更のみで、コード・DB・環境変数・設定の変更は行っていない。

---

## 1. 現在の実装状況

note-writerは、記事生成・記事DB・メルマガ・SNS・掲示板・ネタ帳・Substackネタ収集などを1つの`app/page.tsx`のタブ切り替えSPAとしてまとめたNext.js 16アプリ。主要な永続化先は2つ：

- **Neon Postgres**：`note_articles`テーブルのみ。記事のフィールド・アカウントスコープ・楽観ロック・ソフトデリートを備えた、今回のセッションで確立した唯一のSQLテーブル。
- **Upstash Redis**：それ以外のほぼ全データ（アカウント一覧、プロフィール、DNA、ネタ帳、Substackネタ、Bright Data状態）。単純なキー・バリューの配列/オブジェクト保存。

X投稿収集は現在4経路（Bright Data自動収集cron・Bright Data手動ボタン・URL手動個別追加・RSS/Nitterフォールバックcron）あるが、いずれも同じ`SubstackNewsItem`型・同じRedisキー`substack_news_items`に集約される。**アカウント紐づけなし・反応数なし・状態は`unread/use/skip`の3値のみ**という、リサーチDB構想には全く不足した構造のままである。

一方、今回新たに`research/x-research-extension/`としてChrome拡張が完成し、**ログイン済みXの検索結果からClaude/Fable/外部APIを使わずに投稿を抽出し、選択したものだけJSONで出力できる**ことが実機で確認済み。ただしnote-writer本体とは一切接続されていない（意図的、前フェーズの制約）。

## 2. 関連ファイル、DB、Redisキー、APIルート

**アカウント・認証**
- `lib/accounts.ts`：`Account { id, name, ownerEmail?, createdAt }`。Redisキー`accounts`
- `lib/accountIds.ts`：`SEKI_ID = "seki-tatsuya-official"`
- `lib/apiAuth.ts`：`requireSitePassword`（Cookie `nw_session`検証）、`requireCronSecret`（fail closed）、`requireValidAccountId`（**存在確認のみ、所有権確認ではない**）
- `app/page.tsx`：`currentAccountId`を`useState` + `localStorage`（キー`note_writer_current_account_id`）で管理。**サーバーセッションとは無関係**

**プロフィール・DNA**
- `lib/getAccountContext.ts`：`account:{accountId}:profile_document`・`account:{accountId}:dna`（Redis、自由記述テキストのみ）
- `lib/profile.ts`：`PROFILE_DOCUMENT`（関達也のデフォルト値）、`MAGAZINES`、`ACCURACY_RULES`等のグローバル定数

**記事DB（Neon Postgres、参考実装パターン）**
- `lib/db.ts`：`getDb()`、Neon接続のシングルトン
- `lib/articlesDb.ts` / `articlesDbImport.ts` / `articlesDbRead.ts` / `articlesDbMirror.ts`
- `scripts/db-migrate.ts`：`note_articles`テーブル定義（`note_account_id`列、`UNIQUE(note_account_id, legacy_id)`、`version`、`deleted_at`、`mirror_seq`）
- `app/api/articles-db/import/route.ts`：**`requireSitePassword` + `requireValidAccountId` + `clientWriteTs`による書き込み順序保証**という、サーバー側JSON配列インポートの実装済みパターン

**Xリサーチ関連（現行）**
- `lib/types.ts`の`SubstackNewsItem`：`{ id, sourceType, sourceName, title, url, summary, ideaSeed, collectedAt, status, isManual?, fullText? }`
- Redisキー`substack_news_items`（グローバル単一リスト、`MAX_ITEMS = 100`で切り捨て）
- `lib/brightdata-process.ts`の`excerptSummary()`（非AI抜粋、複数ルートで共有）
- `components/TabSubstack.tsx` / `TabSubstackNews.tsx`：一覧表示・ステータス変更・「使う」ボタン

**Chrome拡張（今回検証済み）**
- `research/x-post-extractor/extract-x-posts.js`：`extractXPostsCore(maxPosts)`
- `research/x-research-extension/`：`manifest.json`（`activeTab`+`scripting`のみ）、`popup.html/css/js`、`extractor-core.js`
- 出力JSON項目：`postId, url, authorName, authorHandle, postedAtRaw, text, isTextTruncated, replies, reposts, likes, bookmarks, views`

**既存のJSONインポートUIパターン**
- `components/TabDatabase.tsx`：`<input type="file" accept=".json">`（非表示）+ ボタンクリックでトリガー、`onChange`でファイル読み込み→パース→保存、という動作実績のあるフロー（「データをインポート（JSON）」）

## 3. 既存機能で再利用できるもの

| 再利用対象 | 何に使えるか |
|---|---|
| `lib/db.ts`のNeon接続パターン | 新テーブルもそのまま同じ接続方式で追加可能 |
| `note_articles`のテーブル設計（アカウントスコープ列・楽観ロック・ソフトデリート・`UNIQUE`制約による冪等インポート） | 新しい`research_posts`テーブル等の設計テンプレートとしてほぼそのまま転用可能 |
| `app/api/articles-db/import/route.ts`の認証＋アカウント検証＋JSON配列受け取りパターン | Chrome拡張JSONの取り込みAPIの雛形として直接転用可能 |
| `lib/apiAuth.ts`の`requireSitePassword`/`requireValidAccountId` | 新規APIルートに追加するだけで、今回整備した認証基盤にそのまま乗る |
| `lib/useNotebookDB.ts` + `app/api/notebook-from-idea/route.ts`のダブルライト（localStorage⇄Redis）＋「エントリが指定accountIdの一覧に実在するか」を確認する簡易アクセス制御 | アカウントスコープのデータ混入防止の実装例として参考になる |
| `lib/brightdata-process.ts`の`excerptSummary()` | Xリサーチ投稿の非AI抜粋表示にそのまま使える（Chrome拡張は既に本文全文を取得済みだが、一覧表示の要約に流用可） |
| `components/TabDatabase.tsx`のJSON手動アップロードUI | Chrome拡張の出力JSONをnote-writerへ取り込むUIの雛形 |
| `TabSubstackNews.tsx`の「使う」ボタン（`summary`+`ideaSeed`を他タブへ引き継ぐ動線） | リサーチ投稿→投稿企画への橋渡しUIの参考 |

## 4. 現在の問題点

1. **`substack_news_items`はアカウント紐づけが一切ない**（`SubstackNewsItem`に`accountId`フィールドなし、Redisキーもグローバル1本）。別人格ごとにリサーチを分けたいという今回の目的に対し、現状は根本的に対応できない
2. **反応数（返信・リポスト・いいね・ブックマーク・表示）を保存するフィールドが存在しない**。Chrome拡張は既に取得できているが、受け皿がない
3. **`currentAccountId`はブラウザのlocalStorageのみで管理され、サーバー側は「そのIDが実在するか」しか確認しない。** 「今操作している人が本当にそのアカウントの持ち主か」（真の所有権確認）は一切行われない。単一利用者を前提とする限りでは実害は小さいが、新設するリサーチ機能では8章で確定した「関連の実在確認」を必ず徹底する必要がある（8章参照）
4. **プロフィール／DNAは自由記述の2つのテキスト欄のみ**で、NGワード・想定読者・口調等を個別フィールドとして構造化・検索・再利用する仕組みがない
5. **投稿結果・有料note販売実績を記録する仕組みが皆無**（テーブル・Redisキーいずれも存在しない）
6. **Redisの単一キー配列＋`MAX_ITEMS`切り捨てという構造は、件数が増えるリサーチDBには向かない**（検索・絞り込み・時系列保存に不利）
7. Chrome拡張は完成しているが、**note-writerとの接続点が一切ない**（意図的な現状）

## 5. 最小構成案（案A）

### 内容
- Chrome拡張の出力JSONを手動でアップロード（`TabDatabase.tsx`と同じ`<input type="file">`パターン）
- Neon Postgresに新テーブル（`research_posts`＋`research_post_accounts`、詳細は7章で確定）を作り、アカウントスコープ付きで保存
- 一覧表示・アカウント切り替えでの閲覧・分類
- 投稿そのものとアカウントごとの利用を分けてユニーク制約をかけ重複を除外（10章）
- メモ・タグ・保存理由の自由記述欄を追加
- AI分析・別人格生成へはまだつなげない

### 評価
| 観点 | 内容 |
|---|---|
| メリット | 実装量が小さく、今回検証済みの部品（Chrome拡張・JSONアップロードUI・`note_articles`と同型のテーブル設計）をそのまま組み合わせるだけで完結する。外部通信ゼロ、AI呼び出しゼロで完結し、リスクが極めて低い |
| デメリット | 「テーマ・悩み・投稿構造の分析」「別人格との紐づけ」「投稿企画・結果・有料note」は含まれないため、単体では最終目的（10ステップの仕組み）には届かない |
| 実装量 | 小（新テーブル2つ、APIルート2〜3本、UIパネル1つ） |
| 将来の拡張性 | 高い。`research_post_accounts.note_account_id`列を最初から持たせておけば、後続のテーブル（投稿企画・一次情報等）から外部キー的に参照するだけで拡張できる |
| 過剰設計の危険 | 低い。今回不明な項目（テーマ分類・投稿構造の型等）を無理に先取りしない |
| 既存機能への影響 | なし（新テーブル・新ルート・新パネルの追加のみ。既存の`substack_news_items`・Bright Data関連コードには触れない） |

## 6. 将来の統合構成案（案B）

### 内容
外部参考投稿・一次情報・別人格設定・投稿企画/原稿・投稿後反応・有料note企画/販売結果までを、最初から一貫した関連テーブル群として設計する。

### 評価
| 観点 | 内容 |
|---|---| 
| メリット | 将来必要になるであろう関連（「この有料noteはどの一次情報とどの投稿から生まれたか」等）を最初からリレーションとして持てる |
| デメリット | 現時点で「投稿の型」「テーマ分類の粒度」「一次情報の構造」など、多くの項目が**関さんの運用が固まる前**の仮説段階。仮に今固めても、実際に運用してみて構造が合わず作り直すリスクが高い |
| 実装量 | 大（テーブル6種以上、関連するAPIルート・UIパネルも比例して増加） |
| 将来の拡張性 | 理論上は高いが、「使われない・使えないカラム」が最初から大量発生するリスクとトレードオフ |
| 過剰設計の危険 | **高い。** 今回の資料でも「これらすべてを最初から実装する前提にはしない」と明記されている通り、案Bをそのまま初手で作ることは過剰設計にあたる可能性が高い |
| 既存機能への影響 | 直接の影響はないが、実装・レビュー・維持コストが増え、後続の別作業（Bright Data本体の整理等）に手が回りにくくなる可能性 |

## 7. 推奨するデータモデル（段階分け・確定版）

### 第1段階：2テーブル構成（確定）

`research_posts`単体ではなく、**「投稿そのもの」と「アカウントごとの利用」を分離した2テーブル構成**を第1段階の確定案とする。

**A. `research_posts`（外部のX投稿そのものを重複なく保存するマスターテーブル）**
```sql
CREATE TABLE research_posts (
  id                BIGSERIAL PRIMARY KEY,
  platform          TEXT NOT NULL DEFAULT 'x',  -- 将来Threads等が増える前提の列。第1段階はXのみ書き込む
  post_id           TEXT NOT NULL,               -- Xの投稿ID。JSのSafe Integer範囲を超えるためTEXTで扱う（数値型にしない）
  url               TEXT NOT NULL,
  author_name       TEXT,
  author_handle     TEXT NOT NULL,
  text              TEXT,
  is_text_truncated BOOLEAN NOT NULL DEFAULT FALSE,
  posted_at         TIMESTAMPTZ,                 -- Chrome拡張のpostedAtRaw（ISO形式）をそのまま日時として保存。JST変換は行わない
  replies           INTEGER,                     -- NULL許容。未取得と実際の0件を区別する
  reposts           INTEGER,
  likes             INTEGER,
  bookmarks         INTEGER,
  views             INTEGER,
  captured_at       TIMESTAMPTZ NOT NULL DEFAULT now(),  -- note-writerがこの行を取り込んだ日時
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (platform, post_id)
);
```

**B. `research_post_accounts`（参考投稿を、どのnoteアカウントで利用するかを管理する関連テーブル）**
```sql
CREATE TABLE research_post_accounts (
  id                BIGSERIAL PRIMARY KEY,
  research_post_id  BIGINT NOT NULL REFERENCES research_posts(id) ON DELETE CASCADE,
  note_account_id   TEXT NOT NULL,
  saved_reason      TEXT,
  memo              TEXT,
  tags              TEXT[],
  search_query      TEXT,                        -- 9章参照：インポート時に任意入力
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (research_post_id, note_account_id)
);
CREATE INDEX research_post_accounts_account_idx ON research_post_accounts (note_account_id);
```

この構成により、同じ投稿本文をアカウントごとに重複保存しない・同じ投稿を複数アカウントから参照できる・メモ/タグ/保存理由はアカウントごとに分けられる・あるアカウントとの関連だけを削除できる、という4条件をすべて満たす。

**`posted_at`の型と日時の扱い（確定方針）**：`research_posts.posted_at`は`TEXT`ではなく`TIMESTAMPTZ`を推奨案とする。Chrome拡張の`postedAtRaw`に含まれるISO形式の日時を、**JSTへ変換せずそのまま日時としてDBへ保存する**（保存する値自体は生のタイムスタンプであり、タイムゾーン変換という「加工」を保存時には行わないという意味で、従来の「生値のまま保存する」方針を維持している）。JSTへの変換は、一覧画面などの**表示時にのみ**行う。`postedAtRaw`が日時として解析できない値だった場合は、**不正な文字列のまま`posted_at`に保存せず、その投稿をインポートエラーとして扱う**（当該投稿はインポートせず、エラーとして報告する。他の投稿の取り込みは継続する）。

**物理削除／ソフトデリート／孤立した`research_posts`の扱い（第1段階の方針）**
- `research_post_accounts`は**物理削除でよい**。単なる「このアカウントではこの投稿を使わない」という関連解除であり、タグ・メモを含めても履歴として残す必要性は薄く、ソフトデリートを導入する理由がない。再度必要になれば同じ投稿を再取り込みするだけで復元できる
- `research_posts`（マスター行）は、**第1段階では削除操作自体を実装しない**。あるアカウントとの関連が全て解除されて「孤立」した状態になっても、行はそのまま残す。孤立行は公開されているX投稿の複製データに過ぎず保持コストは小さく、再度参照されたときに再取得の手間を省ける。カスケード削除の設計・実装コストをかけずに済む、最も単純で安全な扱いと判断する
- DB上は安全のため`research_post_accounts.research_post_id`に`ON DELETE CASCADE`を付与しておくが、第1段階のアプリケーションコードから`research_posts`を削除する経路自体は作らない

**テーマ・投稿構造・読者の悩みの扱い**：第1段階では`research_post_accounts.tags`（自由記述の配列）に含める。専用の構造化列は作らない。運用してみて頻出パターンが見えてから列として切り出す方が過剰設計を避けられる。

**ブックマーク率（確定方針）**：DBに列として保存しない。表示時に`bookmarks / views`を算出する。`bookmarks`または`views`が`NULL`、あるいは`views`が0の場合は、ブックマーク率も`NULL`（算出不能）として扱う。固定値を保存しないことで、反応数を再取得して上書きした際にブックマーク率が古い値のまま残るような不整合を避けられる。

### 第2段階以降（後から追加すべきもの、今回は定義しない）
- `research_post_metrics_snapshots`（同一投稿の反応数を時系列で残したい場合。第1段階では**上書きのみ**とし、履歴化はここで追加）
- `primary_materials`（一次情報ライブラリ：経験・実績・失敗・エピソード・主張）
- `personas`（別人格の構造化フィールド。8章参照。**`note_account_id`とは同一概念にしない**という方針は確定したが、テーブル定義自体は第2段階以降）
- `post_plans` / `posts_published`（投稿企画・実際の投稿結果。X/Threadsの別、表示数・反応数・プロフィール遷移・リンククリック・評価）
- `paid_notes`（企画・対象読者・購入理由・無料/有料構成・使用した一次情報・関連投稿・価格・販売数・売上・改善履歴）

**別人格ごとの情報源制約（将来設計で外してはいけない必須制約、第1段階では未実装）**：`primary_materials`（一次情報ライブラリ）を将来設計する際は、以下を必ず満たすこと。
1. **関さんをベースにした匿名人格**：関さん自身の実体験・実績・失敗・主張を、必要に応じて匿名化した上で使用可能とする
2. **関さんとは異なる専門メディア型の人格**：調査情報・検証結果・一般化した知見・公開事例・独自の考察のみを使用する。**関さんの体験を、その別人格自身の体験として語らせてはならない**
3. **創作的な人格**：創作と情報発信の境界を明確にし、存在しない経歴・実績・利用体験を事実として扱わない。購入判断に影響する虚偽の設定を作らない

将来の一次情報ライブラリでは、各情報について「どの人格またはアカウントで使用可能か」を設定できる設計にする（例：`primary_materials`に許可先人格/アカウントを紐づける中間テーブルを持たせる、等）。この制約は第1段階の実装対象ではないが、第2段階以降の設計時に必ず記録・参照すること。

## 8. アカウント分離の設計（確定方針）

現時点のnote-writerは、**関さん一人が利用する単一利用者・複数アカウントのアプリ**として扱う。この前提のもと、以下を第1段階で必須とする（確定）。

1. `requireSitePassword`による認証（既存の仕組みをそのまま使う。新しい認証方式は作らない）
2. サーバー側で`note_account_id`の実在を確認する（`requireValidAccountId`、既存関数をそのまま使う）
3. 一覧・更新・削除は必ず`note_account_id`でスコープする（`research_post_accounts.note_account_id`によるフィルタを全APIで徹底する）
4. 更新・削除の対象レコードと`note_account_id`の関連が実際に存在するかを確認する（`useNotebookDB.ts`/`notebook-from-idea` route.tsで既に実装されている「対象エントリが指定accountIdの一覧に実在するか」の確認パターンを、`research_post_accounts`にもそのまま適用する）

**`users`や`account_memberships`のような複数ユーザー基盤は、第1段階では作らない。** 7章の2テーブル構成（`research_posts` + `research_post_accounts`）自体が「同じ投稿を複数アカウントから参照できる」という要件を満たすため、リサーチ投稿を「全アカウント共通にするか専用にするか」という以前の論点は、**この2テーブル構成によって選択の必要がなくなった**（アカウントごとに`research_post_accounts`の行を作るかどうかで、実質的に「専用」にも「複数アカウントで共有」にも対応できる）。

**将来課題（今回は実装しない）**：関さん以外の利用者へ本アプリを提供する場合は、「どのユーザーがどのアカウントを所有・利用できるか」という所有関係を持つ仕組み（`users`テーブル、`account_memberships`のような中間テーブル、ログインをアカウント単位で分離する認証方式への変更等）が必要になる。現状の「単一共有パスワード＋Cookie」方式は、単一利用者を前提とする限りにおいて妥当だが、複数利用者が同時にログインしてアカウントを使い分ける状況には対応できない。この点は本設計の対象外とし、将来必要になった時点で改めて検討する。

### 別人格とプラットフォームアカウントの関係（確定方針）

**noteアカウントと別人格は、将来的にも同一概念にしない。** 現状の`Account`型（`lib/accounts.ts`）は「ログイン・データ分離の単位」であり、「発信人格の設定」を表すものではない。将来的には、1つの別人格が note・X・Threads など複数のプラットフォームアカウントを持つ可能性がある（＝別人格とプラットフォームアカウントは1対多になり得る）。

ただし、**第1段階では`personas`テーブルを新設しない。** 既存の`note_account_id`を、リサーチデータ（`research_post_accounts`）の表示範囲・スコープとして流用する。これは「ペルソナの構造化」を先送りにしつつ、今すぐ必要な「アカウントごとにリサーチを分ける」という要件だけを満たすための現実的な割り切りである。`personas`の構造化（対象読者・口調・NGワード等の個別フィールド化、プラットフォームアカウントとの1対多関係の実装）は第2段階以降の検討事項とする。

## 9. Chrome拡張JSONの取り込み方法

比較対象は3方式。ご指示通り、直接送信方式（3）は課題整理のみに留める。

| 方式 | 内容 | 評価 |
|---|---|---|
| **1. ファイルアップロード** | 拡張の「JSONダウンロード」→note-writer側で`<input type="file">` | `TabDatabase.tsx`に**動作実績のある同型のUIパターンが既に存在**。実装量が最も小さく、推奨 |
| **2. クリップボード貼り付け** | 拡張の「JSONコピー」→note-writer側のテキストエリアに貼り付け→パース | ファイル操作が不要な分やや手軽だが、大量の投稿を貼り付けるとテキストエリアが扱いにくくなる可能性。方式1の補助として両方実装するのは容易 |
| **3. 拡張から直接API送信（今回は実装しない）** | 課題整理のみ：①認証（拡張がサイトパスワード/Cookieをどう保持するか）②CORS（note-writerのAPIがChrome拡張からのオリジンを許可する必要）③CSRF（拡張からの書き込みリクエストの真正性担保）④秘密情報の保持（拡張内にサイトパスワードやトークンを埋め込む必要が生じる、Chrome拡張のストレージはユーザーのマシン上に平文で残りやすい）⑤拡張の権限増加（`host_permissions`でnote-writerのドメインへのアクセス許可が必要になり「必要最小限の権限」という現在の方針から外れる）⑥誤送信（意図しないタイミングでの自動送信のリスク）⑦アカウント選択（どのnote-writerアカウント宛てに送るかを拡張側でどう指定・検証するか） |

**推奨**：第1段階は方式1（ファイルアップロード）を主、方式2（クリップボード貼り付け）を補助として実装。方式3は将来の検討課題として明記するに留める。

### `search_query`の取り込み方法（確定方針）

現在のChrome拡張JSON（`research/x-research-extension/`の出力）には`search_query`が含まれていない。`research_post_accounts.search_query`はアカウントごとの利用文脈を記録する列であるため、**note-writer側のインポート画面で任意入力する方式を推奨する。** 具体的には、インポート画面に「今回の取得に使った検索語（任意）」のような1つのテキスト入力欄を用意し、そこに入力された値を、その回にインポートする投稿すべての`research_post_accounts.search_query`へ一律に適用する（投稿ごとに個別入力は求めない）。未入力の場合は`NULL`のまま保存し、必須項目にはしない。

Chrome拡張自体の改修（検索語をJSONに含めるための追加実装）や、拡張からnote-writerへの直接API送信は、**今回の第1段階には含めない。**

## 10. 重複判定方法（確定方針）

2テーブル構成に合わせ、重複判定は2段階になる。

1. **投稿そのものの重複**：`research_posts`に`UNIQUE (platform, post_id)`制約を設ける。取り込み時に既存行があればそのIDを再利用し、新規行を重複作成しない。反応数等の更新可否は下記「再インポート時の動作」で確定する（**第1段階では時系列保存は行わない**——履歴が必要になった時点で第7章「第2段階以降」の`research_post_metrics_snapshots`として追加する）
2. **アカウントごとの利用の重複**：`research_post_accounts`に`UNIQUE (research_post_id, note_account_id)`制約を設ける。同じ投稿を同じアカウントで再度インポートしても、関連行が重複作成されることはない。メモ・タグ等の更新可否は下記「再インポート時の動作」で確定する

`post_id`はTEXT型で扱う（7章参照。JavaScriptのSafe Integer範囲を超えるため）。8章で確定した通り、この2段階の重複判定によって「全アカウント共通か専用か」という論点自体が解消されている。

### 再インポート時の動作（確定方針）

同じ`platform`・`post_id`の投稿を後日再インポートした場合の挙動を、以下の通り確定する。具体的なSQL（`ON CONFLICT`句の書き方等）は次の実装計画で提示し、ここでは設計上の挙動のみを定める。

**`research_posts`（投稿そのもの）**
- 投稿自体を重複作成しない（`UNIQUE (platform, post_id)`により既存行を再利用する）
- `url`・`author_name`・`author_handle`・`text`・`is_text_truncated`・反応数（`replies`/`reposts`/`likes`/`bookmarks`/`views`）は更新対象にできる（最新のChrome拡張出力で上書きしてよい）
- ただし、**新しく取り込んだ値が`NULL`の場合、既存の`NULL`ではない値を`NULL`で上書きしない**（反応数が「前回は取得できたが今回は未検出」であっても、既存の実値を消さない）
- `captured_at`は最新の取り込み日時へ更新する
- **第1段階では時系列履歴を保存しない**（上書きのみ。履歴化は第7章「第2段階以降」の`research_post_metrics_snapshots`で対応する）

**`research_post_accounts`（アカウントごとの利用）**
- 同じ`research_post_id`と`note_account_id`の組み合わせの関連行を重複作成しない（`UNIQUE (research_post_id, note_account_id)`により既存行を再利用する）
- 既存の`saved_reason`・`memo`・`tags`は、JSONの再インポートによって自動的に上書きしない（関さんが明示的に編集した場合のみ更新する）
- `search_query`も同様に、既存の手入力値を不用意に上書きしない

## 11. 外部投稿と自分の投稿結果の分離方法

**外部の参考投稿（`research_posts`）と、自分が実際に投稿した結果（将来の`posts_published`）は、第1段階の時点から明確に別概念・別テーブルとして扱うことを推奨する。** 理由：
- 反応数の意味が異なる（他者の投稿の反応＝市場の需要シグナル、自分の投稿の反応＝実績データ）
- 「外部の成功投稿よりも自分の実績データを優先する」という最終目的（10ステップの10番目）を将来実現するには、両者を混在させず、**どちらの由来かをテーブルレベルで区別できる状態を最初から維持しておく必要がある**
- 混在させて「source種別」フラグで区別する設計も可能だが、将来的にカラム構成（自分の投稿には売上・note企画との紐づけが必要等）が乖離していくため、最初から分離しておく方が後戻りのコストが低い

第1段階では`research_posts`＋`research_post_accounts`のみを作り、自分の投稿結果を保存するテーブル（`posts_published`等）は第2段階以降に回す（今回作らない）。

## 12. AIを使う部分と使わない部分

ご指示の原則をそのまま維持する。

**AIを使わない（第1段階全体）**：保存・閲覧・選択・タグ付け・数値記録・アカウント管理・重複判定・Chrome拡張からの取り込み。これらは全てCRUDとDOM抽出のみで完結し、Anthropic APIを一切呼ばない。

**AIを使う可能性がある部分（将来・第2段階以降）**：「テーマ・悩み・投稿構造の整理」「投稿案の作成」等は、関さんが対象を選択してボタンを押した場合のみ、既存の`generate`/`consult`等と同じパターン（`requireSitePassword`→Anthropic呼び出し）で実装する。**Cronや自動収集からは絶対に呼ばない**という、今回すでに確立した方針をそのまま踏襲する。

## 13. 実装を段階分けしたロードマップ

- **第1段階**：`research_posts`＋`research_post_accounts`テーブル新設、Chrome拡張JSONのファイルアップロード取り込みAPI（`search_query`任意入力含む）、アカウントスコープ付き一覧表示・タグ/メモ編集UI、2段階の重複除外、ブックマーク率の表示時算出
- **第2段階**：反応数の再取得・上書き操作、必要であれば`research_post_metrics_snapshots`による時系列化、`personas`テーブルによるプロフィール/DNAの構造化（NGワード・想定読者等の個別フィールド化、`note_account_id`との1対多のプラットフォームアカウント関係の設計）
- **第3段階**：一次情報ライブラリ（`primary_materials`）——**設計時は7章で確定した「別人格ごとの情報源制約」（匿名人格／専門メディア型人格／創作人格の区別）を必ず反映すること**、投稿企画・原稿作成の支援（ここで初めてAIを明示的トリガーで使う機能を検討）
- **第4段階**：投稿結果記録（`posts_published`）、有料note企画・販売実績記録（`paid_notes`）、これらを踏まえた改善サイクルの仕組み
- **将来課題（時期未定）**：複数ユーザーへの提供を検討する場合の`users`/`account_memberships`基盤（8章参照）

## 14. 第1段階の完了条件

1. Chrome拡張が出力したJSONファイルを、note-writer画面からアップロードして`research_posts`（マスター行）と`research_post_accounts`（アカウントごとの関連行）の両方に保存できる
2. 同じ投稿（同一`platform`+`post_id`）を再度アップロードしても`research_posts`に重複登録されない。同じアカウントで同じ投稿を再度アップロードしても`research_post_accounts`に重複登録されない
3. アカウントを切り替えると、そのアカウントの`research_post_accounts`に紐づくリサーチ投稿だけが一覧に表示される
4. 新設する全APIルートに`requireSitePassword`と`requireValidAccountId`、および「対象の`research_post_accounts`行が指定`note_account_id`に実在するか」の確認が入っている
5. タグ・保存理由・メモ・検索語（任意）をあとから編集できる
6. 一覧表示でブックマーク率が`bookmarks / views`として算出表示され、算出不能な場合は空欄またはハイフン表示になる
7. Anthropic APIを一切呼ばずに一連の操作が完結する
8. `npx tsc --noEmit`・`npx next build`が通る

## 15. 変更が必要になりそうなファイル一覧

**新規作成（想定、まだ作っていない）**
- `scripts/db-migrate.ts`への`research_posts`・`research_post_accounts`テーブル追加（または専用マイグレーションファイル）
- `lib/researchPosts.ts`（または`lib/researchPostsDb.ts`）：`research_posts`のupsert・`research_post_accounts`のCRUD関数群（`lib/articlesDb.ts`と同型のパターン）
- `app/api/research-posts/route.ts`（アカウントスコープの一覧取得・タグ/メモ更新・関連削除）
- `app/api/research-posts/import/route.ts`（Chrome拡張JSONの取り込み。`research_posts`へのupsert＋`research_post_accounts`への関連作成、`search_query`の一律適用を含む。`articles-db/import/route.ts`と同型）
- `components/TabResearch.tsx`（または既存`TabSubstack.tsx`系に統合するかは要検討）：一覧表示・アップロードUI・ブックマーク率の表示計算

**変更が必要になる可能性があるファイル**
- `app/page.tsx`：新タブの追加（メニュー・ルーティング分岐）
- `lib/types.ts`：`ResearchPost`・`ResearchPostAccount`型の追加

**変更不要（今回は触れない）**
- `substack_news_items`・Bright Data関連一式（そのまま維持）
- 認証基盤（`lib/apiAuth.ts`）は既存のものをそのまま使う
- `research/x-research-extension/`（Chrome拡張本体）：今回の第1段階では改修しない（9章参照）

## 16. セキュリティ上の注意

- 新設する全APIルートに、今回整備済みの`requireSitePassword`を必ず入れる（今回の一連の修正で徹底した方針をそのまま継続）
- `requireValidAccountId`だけでなく、8章で確定した「対象の`research_post_accounts`行が指定`note_account_id`に実在するか」の確認も、更新・削除系エンドポイントには必ず入れる
- JSONインポートAPIには、`articles-db/import`と同様に配列であることの検証・サイズ上限（一度に取り込める件数の上限、例えば拡張のポップアップ自体が1〜20件までしか一度に出力しないため、サーバー側でも同程度の上限を設けることを推奨）を設ける
- Chrome拡張自体はネットワーク通信を行わないため、この経路からの外部送信リスクはない。リスクがあるとすれば「note-writer側のインポートAPI」であり、そこへの認証・検証が唯一の防御ライン
- Anthropic APIを将来この機能に組み込む際は、今回確立した「Cronから呼ばない」「明示的なボタン操作のみ」「上限を明示する」という3原則を必ず引き継ぐ

## 17. Sonnetだけで実装できる範囲

第1段階の全て（テーブル設計、CRUD、JSONインポートAPI、一覧・タグ編集UI）は、**今回のセッションで既に同型の実装（`note_articles`テーブル・認証基盤・ダブルライトパターン）をSonnetが実装済み**であり、技術的な新規性はない。Sonnetのみで十分に実装可能と判断する。

## 18. Fableを使う価値が高い範囲

- 実際にはFableが既に「Xページのブラウザ操作を伴う抽出方法の実機検証」で価値を発揮済み（Claude in Chromeでの比較検証）
- 今後Fableの価値が高いとすれば、**「投稿構造・テーマ分類のパターンをどう設計すべきか」といった、実際の投稿データを見ながら試行錯誤するような探索的な分析・UX設計の支援**（第2段階以降のペルソナ構造化や投稿分類ロジックの検討時）
- 単純なCRUD・DB設計・APIルート実装には、Fableを使う価値は低いと考える

## 19. 今すぐFableを使うべきか、Sonnetで第1段階を作るべきか

**Sonnetで第1段階を作ることを推奨する。** 理由：
- 第1段階の作業内容（2テーブル追加・CRUD・JSONインポート・一覧UI）は、今回のセッション内でSonnetが繰り返し実施し検証済みのパターンの延長線上にある
- Fableを今使う理由があるとすれば「ブラウザでの試行錯誤」だが、第1段階にはブラウザ操作を伴う新規調査は含まれない（Chrome拡張は既に完成・検証済み）
- アカウント分離・別人格の扱いに関する主要な方針は、今回の改訂で確定済みであり、AIモデルの選択とは無関係

## 20. 最終的な推奨案（確定）

1. **案A（最小構成）を第1段階として採用する。** 案Bの要素（一次情報・別人格構造化・投稿企画/結果・有料note）は明確に「後から追加するもの」として分離し、今は着手しない
2. データモデルは`research_posts`＋`research_post_accounts`の2テーブル構成で確定する（7章）。`post_id`はTEXT型、反応数はNULL許容、ブックマーク率は保存せず表示時算出とする
3. Chrome拡張JSONの取り込みは、`TabDatabase.tsx`の既存ファイルアップロードUIパターンと`articles-db/import/route.ts`の既存認証済みインポートAPIパターンをそのまま転用する。`search_query`はインポート画面での任意入力とする
4. 外部の参考投稿と自分の投稿結果は、第1段階の時点から概念的・テーブル的に分離しておく（11章）
5. アカウント分離は「単一利用者・複数アカウント」を前提に、`requireSitePassword`＋`requireValidAccountId`＋`note_account_id`スコープ＋関連存在確認を必須とする（8章）。複数ユーザー基盤（`users`/`account_memberships`）は将来課題として明記し、今回は作らない
6. noteアカウントと別人格は同一概念にせず、`personas`テーブルは第2段階以降に先送りする。第1段階は`note_account_id`をリサーチデータのスコープとして流用する（8章）
7. 将来の一次情報ライブラリ設計では、匿名人格・専門メディア型人格・創作人格それぞれの情報源制約（7章）を必ず反映することを記録しておく
8. Sonnetによる実装で第1段階を進めることを推奨し、Fableは今回は必須としない

---

（本報告書はコード調査と設計比較のみに基づく。実装・DB変更・環境変数変更・外部API呼び出し・commit・push・デプロイは一切行っていない。）
