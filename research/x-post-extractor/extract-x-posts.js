/**
 * X「最新」検索結果の先頭N件を、DOMだけから抽出する検証済みスクリプト。
 *
 * - note-writer本体・DBとは無関係の独立ファイル（どこからもimportされない）
 * - ネットワーク通信・ログイン・スクロール・クリック等の自動操作は一切行わない
 * - ログイン済みXの検索結果ページ（"最新"タブ）を開いた状態で、
 *   関さんがDevToolsコンソールに貼り付けて手動で1回実行することを想定
 * - 実機検証済み（Claude in Chromeの結果とpostId/url/authorName/authorHandle/
 *   postedAtRaw/replies/reposts/likes/bookmarks/viewsが5件すべて一致）
 *
 * コア抽出ロジックは extractXPostsCore(maxPosts) 関数に集約している。
 * research/x-research-extension/ のChrome拡張は、この関数の内容を
 * そのままコピーして使っている（Chrome拡張のパッケージ制約上、ファイルを
 * またいだimportができないため）。アルゴリズムを変更する場合は、
 * research/x-research-extension/extractor-core.js 側も同じ内容に
 * 更新すること（両ファイル末尾の比較コメント参照）。
 *
 * 実行手順は README.md を参照。
 */
function extractXPostsCore(maxPosts) {
  // 数値文字列（カンマ区切り含む）を整数化する。省略表記（例: 12.3万 / 12.3K）は
  // 正規化せずnullを返す（誤った数値を作らないため）。
  function parseExactCount(raw) {
    if (!raw) return null;
    const trimmed = raw.trim();
    if (/^[\d,]+$/.test(trimmed)) {
      return parseInt(trimmed.replace(/,/g, ""), 10);
    }
    return null; // 万/K/M等の省略表記はここでは数値化しない
  }

  // articleのtweetText内を、テキストノード＋絵文字imgのaltを連結して復元する
  function extractTweetText(textEl) {
    if (!textEl) return "";
    let out = "";
    textEl.childNodes.forEach((node) => {
      if (node.nodeType === Node.TEXT_NODE) {
        out += node.textContent;
      } else if (node.nodeType === Node.ELEMENT_NODE) {
        if (node.tagName === "IMG") {
          out += node.getAttribute("alt") || "";
        } else {
          out += node.textContent || "";
        }
      }
    });
    return out;
  }

  // article内のプロフィールリンク（/ユーザー名 形式）から@ハンドルを取得する。
  // 注意：Xの内部的な数値ユーザーIDはDOM上に存在しないため、ここで取れるのは
  // @ハンドル（screen name）のみ。フィールド名もauthorHandleとし、数値IDと
  // 誤解されないようにしている。
  function extractAuthorHandle(userNameBlock) {
    if (!userNameBlock) return "";
    const links = Array.from(userNameBlock.querySelectorAll('a[href^="/"]'));
    for (const a of links) {
      try {
        const path = new URL(a.href).pathname;
        // "/username" 形式のみ（"/username/status/..." 等は除外）
        if (/^\/[A-Za-z0-9_]+$/.test(path)) {
          return path.slice(1);
        }
      } catch {
        /* skip malformed href */
      }
    }
    return "";
  }

  function extractAuthorName(userNameBlock) {
    if (!userNameBlock) return "";
    const nameLink = userNameBlock.querySelector('a[role="link"]');
    const text = (nameLink ? nameLink.textContent : userNameBlock.textContent) || "";
    return text.trim();
  }

  // 各指標を判定するためのキーワード（日本語優先、英語もフォールバックで対応）。
  // 出現順には一切依存しない。キーワードが見つからない指標はnullのままとし、
  // 他の指標の値をずらして割り当てることはしない。
  const METRIC_KEYWORDS = {
    replies: ["返信", "repl(?:y|ies)"],
    reposts: ["リポスト", "repost(?:s)?"],
    likes: ["いいね", "like(?:s)?"],
    bookmarks: ["ブックマーク", "bookmark(?:s)?"],
    views: ["表示", "view(?:s)?"],
  };

  // aria-label文字列から、指定キーワードに紐づく数値を1つ探す。
  // 「123 replies」「123件の返信」のような数値→キーワード順と、
  // 「返信123件」「reply: 123」のようなキーワード→数値順の両方に対応する。
  function findCountByKeyword(label, keywords) {
    for (const kw of keywords) {
      const beforeRe = new RegExp(`([\\d,]+(?:\\.\\d+)?\\s*(?:万|K|M)?)\\s*件?\\s*の?\\s*(?:${kw})`, "i");
      const beforeMatch = label.match(beforeRe);
      if (beforeMatch) return beforeMatch[1];

      const afterRe = new RegExp(`(?:${kw})\\s*[:：]?\\s*([\\d,]+(?:\\.\\d+)?\\s*(?:万|K|M)?)\\s*件?`, "i");
      const afterMatch = label.match(afterRe);
      if (afterMatch) return afterMatch[1];
    }
    return null;
  }

  // article内のrole="group"要素のaria-labelを、項目名（日本語/英語キーワード）を
  // 手がかりに解析する。他articleの値と混ざらないよう、検索範囲を必ずarticle
  // 配下に限定する。
  function extractEngagement(article) {
    const result = { replies: null, reposts: null, likes: null, bookmarks: null, views: null };
    const group = article.querySelector('[role="group"][aria-label]');
    if (group) {
      const label = group.getAttribute("aria-label") || "";
      for (const key of Object.keys(METRIC_KEYWORDS)) {
        const raw = findCountByKeyword(label, METRIC_KEYWORDS[key]);
        if (raw !== null) result[key] = parseExactCount(raw.replace(/\s/g, ""));
      }
    }
    // フォールバック：個別ボタンのaria-label。各ボタンはdata-testidの時点で対象
    // 指標が一意に決まっている（例：data-testid="reply"のボタンには返信数以外の
    // 数字は含まれない）ため、先頭の数値をそのまま使ってよい。
    const byTestId = (testId) => {
      const el = article.querySelector(`[data-testid="${testId}"]`);
      if (!el) return null;
      const label = el.getAttribute("aria-label") || "";
      const m = label.match(/^([\d,]+)/);
      return m ? parseExactCount(m[1]) : null;
    };
    if (result.replies === null) result.replies = byTestId("reply");
    if (result.reposts === null) result.reposts = byTestId("retweet");
    if (result.likes === null) result.likes = byTestId("like") ?? byTestId("unlike");
    if (result.bookmarks === null) result.bookmarks = byTestId("bookmark") ?? byTestId("removeBookmark");
    // viewsには安定したdata-testidが無いため、group aria-labelのキーワード解析
    // 結果のみを使う（見つからなければnullのまま）。
    return result;
  }

  const articles = Array.from(document.querySelectorAll('article[data-testid="tweet"]')).slice(0, maxPosts);
  const seenIds = new Set();
  const results = [];
  const skipped = [];

  for (const article of articles) {
    try {
      const timeEl = article.querySelector("time");
      let anchor = timeEl ? timeEl.closest("a") : null;
      if (!anchor || !/\/status\/\d+/.test(anchor.href || "")) {
        anchor = article.querySelector('a[href*="/status/"]');
      }
      if (!anchor) {
        skipped.push({ reason: "no status link found" });
        continue;
      }

      const idMatch = anchor.href.match(/\/status\/(\d+)/);
      if (!idMatch) {
        skipped.push({ reason: "status link had no numeric id", href: anchor.href });
        continue;
      }
      const postId = idMatch[1];
      if (seenIds.has(postId)) {
        skipped.push({ reason: "duplicate postId", postId });
        continue;
      }

      const url = anchor.href.split("?")[0];
      const postedAtRaw = timeEl ? timeEl.getAttribute("datetime") : null;

      const userNameBlock = article.querySelector('[data-testid="User-Name"]');
      const authorName = extractAuthorName(userNameBlock);
      const authorHandle = extractAuthorHandle(userNameBlock);

      const textEl = article.querySelector('[data-testid="tweetText"]');
      const text = extractTweetText(textEl);
      const isTextTruncated = !!article.querySelector('[data-testid="tweet-text-show-more-link"]');

      const engagement = extractEngagement(article);

      seenIds.add(postId);
      results.push({
        postId,
        url,
        authorName,
        authorHandle,
        postedAtRaw,
        text,
        isTextTruncated,
        replies: engagement.replies,
        reposts: engagement.reposts,
        likes: engagement.likes,
        bookmarks: engagement.bookmarks,
        views: engagement.views,
      });
    } catch (e) {
      skipped.push({ reason: "exception", message: String(e) });
    }
  }

  return { results, skipped };
}

// ── ここから実行部（コンソールに貼り付けると即実行される）──────────
// extractXPostsCore自体は副作用を持たない（DOM読み取りのみ）。
// window.__xExtractResultへの格納やconsole.logは、この実行部だけの責務。
(function runExtractXPosts() {
  const MAX_POSTS = 5;
  const { results, skipped } = extractXPostsCore(MAX_POSTS);
  window.__xExtractResult = results;
  console.log(`[x-extract] ${results.length}件取得（スキップ${skipped.length}件）`);
  if (skipped.length > 0) console.warn("[x-extract] skipped:", skipped);
  console.log(JSON.stringify(results, null, 2));
})();

// ── 出力用ヘルパー（抽出後、必要な方を手動で呼び出す）──────────────
// ネットワーク通信は発生しない(クリップボードAPI／ローカルファイル生成のみ)。

function copyXExtractResultToClipboard() {
  const data = window.__xExtractResult;
  if (!data) {
    console.error("[x-extract] window.__xExtractResult がありません。先に抽出スクリプトを実行してください。");
    return;
  }
  navigator.clipboard.writeText(JSON.stringify(data, null, 2))
    .then(() => console.log("[x-extract] クリップボードにコピーしました。"))
    .catch((e) => console.error("[x-extract] コピーに失敗:", e));
}

function downloadXExtractResultAsJson() {
  const data = window.__xExtractResult;
  if (!data) {
    console.error("[x-extract] window.__xExtractResult がありません。先に抽出スクリプトを実行してください。");
    return;
  }
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `x-extract-${Date.now()}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  console.log("[x-extract] ダウンロードを開始しました。");
}
