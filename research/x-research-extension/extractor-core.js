/**
 * X検索結果ページの表示中投稿をDOMから抽出するコアロジック。
 *
 * ⚠️ このファイルは research/x-post-extractor/extract-x-posts.js の
 * extractXPostsCore() 関数を、Chrome拡張向けにそのままコピーしたものです。
 * Chrome拡張は自身のディレクトリ外のファイルを読み込めない（unpacked
 * extensionのルートがx-research-extension/に固定されるため）、独立した
 * コピーとして持たせている。
 *
 * アルゴリズム（DOMセレクタ・正規表現・キーワード判定）は一切変更していない。
 * 実機検証済みの extract-x-posts.js と挙動を一致させるため、ロジックを
 * 変更する場合は必ず両ファイルを同時に更新すること。
 *
 * popup.js から chrome.scripting.executeScript({ func: extractXPostsCore,
 * args: [maxPosts] }) の形で、Xページのコンテキストに直接注入して実行される。
 * そのため、この関数は外部スコープを一切参照せず、自己完結している必要がある
 * （元のextract-x-posts.jsと同じ制約）。
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
