"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { ResearchPostListItem, ResearchPostImportItem } from "@/lib/types";

interface TabResearchProps {
  noteAccountId: string;
}

const PAGE_SIZE = 50;
const MAX_IMPORT_ITEMS = 50;
const MAX_IMPORT_BYTES = 2 * 1024 * 1024; // 2MB
const MAX_TAGS = 20;
const MAX_TAG_LEN = 100;
const EXTENSION_PING_TIMEOUT_MS = 5000;

// ── Gate 1: Chrome拡張との接続確認（開発時のみ表示） ──────────────
// 最小限の型定義。@types/chromeは追加せず、実行時にも構造を検証する
// （chrome.runtime.sendMessageの戻り値をanyのまま信用しない）。

type ChromeRuntimeSendMessage = (
  extensionId: string,
  message: unknown,
  responseCallback: (response: unknown) => void
) => void;

interface MinimalChromeRuntime {
  sendMessage?: ChromeRuntimeSendMessage;
  lastError?: { message?: string };
}

function getChromeRuntime(): MinimalChromeRuntime | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { chrome?: { runtime?: MinimalChromeRuntime } };
  return w.chrome?.runtime ?? null;
}

interface XResearchPingResponse {
  ok: boolean;
  requestId?: string;
  extensionVersion?: string;
  error?: string;
}

// 実行時に応答の形を検証する（拡張機能から返る値を無条件に信用しない）。
function isXResearchPingResponse(value: unknown): value is XResearchPingResponse {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  if (typeof v.ok !== "boolean") return false;
  if (v.requestId !== undefined && typeof v.requestId !== "string") return false;
  if (v.extensionVersion !== undefined && typeof v.extensionVersion !== "string") return false;
  if (v.error !== undefined && typeof v.error !== "string") return false;
  return true;
}

// ── Gate 2A-1: X検索専用タブの新規作成・再利用（開発時のみ表示） ──────
// note-writer独自の入力上限。Xの公式な検索語制限を意味するものではない。
const MAX_X_RESEARCH_QUERY_LENGTH = 200;
const OPEN_SEARCH_TAB_TIMEOUT_MS = 10000;

interface XResearchOpenSearchTabResponse {
  ok: boolean;
  requestId?: string;
  status?: string;
  tabReused?: boolean;
  errorCode?: string;
  message?: string;
  error?: string;
}

// 拡張機能からの応答を無条件に信用せず、実行時に構造を検証する。
function isXResearchOpenSearchTabResponse(value: unknown): value is XResearchOpenSearchTabResponse {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  if (typeof v.ok !== "boolean") return false;
  if (v.requestId !== undefined && typeof v.requestId !== "string") return false;
  if (v.status !== undefined && typeof v.status !== "string") return false;
  if (v.tabReused !== undefined && typeof v.tabReused !== "boolean") return false;
  if (v.errorCode !== undefined && typeof v.errorCode !== "string") return false;
  if (v.message !== undefined && typeof v.message !== "string") return false;
  if (v.error !== undefined && typeof v.error !== "string") return false;
  return true;
}

// note-writer側の検索語検証。trim後の空文字・上限超過・制御文字を拒否する。
// 拒否のみを行い、切り詰めなどの黙った書き換えは行わない。
function validateOpenSearchTabQuery(raw: string): { ok: true; value: string } | { ok: false; error: string } {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return { ok: false, error: "検索語を入力してください" };
  }
  if (trimmed.length > MAX_X_RESEARCH_QUERY_LENGTH) {
    return { ok: false, error: `検索語は${MAX_X_RESEARCH_QUERY_LENGTH}文字以内で入力してください` };
  }
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1F\x7F]/.test(trimmed)) {
    return { ok: false, error: "検索語に使用できない文字が含まれています" };
  }
  return { ok: true, value: trimmed };
}

// ── Gate 2A-2: 専用タブでの投稿要素表示確認（開発時のみ表示） ──────────
// ページ内検出自体は拡張機能側で最大15秒。ここでの20秒は、拡張機能からの
// 応答そのものが返ってこない場合の、通信全体に対する安全網（別階層）。
const CONFIRM_RENDER_TIMEOUT_MS = 20000;

interface XResearchConfirmRenderResponse {
  ok: boolean;
  requestId?: string;
  status?: string;
  detectedCount?: number;
  errorCode?: string;
  message?: string;
  error?: string;
}

// 拡張機能からの応答を無条件に信用せず、実行時に構造を検証する。
function isXResearchConfirmRenderResponse(value: unknown): value is XResearchConfirmRenderResponse {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  if (typeof v.ok !== "boolean") return false;
  if (v.requestId !== undefined && typeof v.requestId !== "string") return false;
  if (v.status !== undefined && typeof v.status !== "string") return false;
  if (v.detectedCount !== undefined && typeof v.detectedCount !== "number") return false;
  if (v.errorCode !== undefined && typeof v.errorCode !== "string") return false;
  if (v.message !== undefined && typeof v.message !== "string") return false;
  if (v.error !== undefined && typeof v.error !== "string") return false;
  return true;
}

// ── Gate 2B-1: 専用タブからの投稿データ抽出（開発時のみ表示） ──────────
// 通信全体に対する安全網。拡張機能側の描画確認（最大15秒）＋抽出処理の
// 余裕を見込んだ値で、Gate 2A-2の20秒より長い。
const EXTRACT_POSTS_TIMEOUT_MS = 25000;
// 初期表示は最初の3件だけ。残りはdetails/summaryで折りたたむ。
const EXTRACT_POSTS_INITIAL_DISPLAY_COUNT = 3;
// 本文プレビューの切り詰め長。全文は表示しない。
const EXTRACT_POSTS_TEXT_PREVIEW_LENGTH = 180;

interface XResearchExtractPostsResponse {
  ok: boolean;
  requestId?: string;
  status?: string;
  sourceUrl?: string;
  extractedAt?: string;
  requestedMaxPosts?: number;
  extractedCount?: number;
  skippedCount?: number;
  posts?: unknown[];
  skipped?: unknown[];
  errorCode?: string;
  message?: string;
  error?: string;
}

// 拡張機能からの応答を無条件に信用せず、実行時に構造を検証する。posts/skipped
// の各要素までは深く検証しない（既存のImportResult.skipped/failed等と同じ扱い）。
function isXResearchExtractPostsResponse(value: unknown): value is XResearchExtractPostsResponse {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  if (typeof v.ok !== "boolean") return false;
  if (v.requestId !== undefined && typeof v.requestId !== "string") return false;
  if (v.status !== undefined && typeof v.status !== "string") return false;
  if (v.sourceUrl !== undefined && typeof v.sourceUrl !== "string") return false;
  if (v.extractedAt !== undefined && typeof v.extractedAt !== "string") return false;
  if (v.requestedMaxPosts !== undefined && typeof v.requestedMaxPosts !== "number") return false;
  if (v.extractedCount !== undefined && typeof v.extractedCount !== "number") return false;
  if (v.skippedCount !== undefined && typeof v.skippedCount !== "number") return false;
  if (v.posts !== undefined && !Array.isArray(v.posts)) return false;
  if (v.skipped !== undefined && !Array.isArray(v.skipped)) return false;
  if (v.errorCode !== undefined && typeof v.errorCode !== "string") return false;
  if (v.message !== undefined && typeof v.message !== "string") return false;
  if (v.error !== undefined && typeof v.error !== "string") return false;
  return true;
}

interface ExtractPostsResult {
  sourceUrl: string;
  extractedAt: string;
  requestedMaxPosts: number;
  extractedCount: number;
  skippedCount: number;
  posts: ResearchPostImportItem[];
  skipped: unknown[];
}

function mapExtractPostsErrorMessage(errorCode: string | undefined, fallback: string): string {
  switch (errorCode) {
    case "NO_DEDICATED_TAB":
      return "先に「X検索タブを開く」を実行してください。";
    case "TAB_NOT_FOUND":
      return "専用タブが見つかりません。もう一度「X検索タブを開く」を実行してください。";
    case "INVALID_TAB_URL":
      return "専用タブが『最新』検索ページではありません。もう一度『X検索タブを開く』を実行してから、最新投稿を抽出してください。";
    case "RENDER_NOT_CONFIRMED":
      return "15秒以内に投稿要素の表示を確認できませんでした。検索結果0件、描画遅延、未ログイン、X側エラー等の可能性があります。";
    case "SCRIPT_INJECTION_FAILED":
      return "投稿データの抽出処理を実行できませんでした。拡張機能を再読み込みして、もう一度お試しください。";
    case "ALREADY_PROCESSING":
      return "現在処理中です。完了後にもう一度お試しください。";
    default:
      return fallback;
  }
}

// ── Gate 2B-2A: 「話題」検索結果からの投稿データ抽出（開発時のみ表示） ────
// 遷移待機（最大15秒）＋描画確認（最大15秒）＋抽出処理が直列に発生するため、
// Gate 2B-1の25秒より長い安全タイムアウトを設ける。
const EXTRACT_TOP_POSTS_TIMEOUT_MS = 40000;
const EXTRACT_TOP_POSTS_INITIAL_DISPLAY_COUNT = 3;
const EXTRACT_TOP_POSTS_TEXT_PREVIEW_LENGTH = 180;

interface XResearchExtractTopPostsResponse {
  ok: boolean;
  requestId?: string;
  status?: string;
  query?: string;
  sourceUrl?: string;
  extractedAt?: string;
  requestedMaxPosts?: number;
  extractedCount?: number;
  skippedCount?: number;
  posts?: unknown[];
  skipped?: unknown[];
  errorCode?: string;
  message?: string;
  error?: string;
}

// 拡張機能からの応答を無条件に信用せず、実行時に構造を検証する。posts/skipped
// の各要素までは深く検証しない（Gate 2B-1のisXResearchExtractPostsResponseと同じ扱い）。
function isXResearchExtractTopPostsResponse(value: unknown): value is XResearchExtractTopPostsResponse {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  if (typeof v.ok !== "boolean") return false;
  if (v.requestId !== undefined && typeof v.requestId !== "string") return false;
  if (v.status !== undefined && typeof v.status !== "string") return false;
  if (v.query !== undefined && typeof v.query !== "string") return false;
  if (v.sourceUrl !== undefined && typeof v.sourceUrl !== "string") return false;
  if (v.extractedAt !== undefined && typeof v.extractedAt !== "string") return false;
  if (v.requestedMaxPosts !== undefined && typeof v.requestedMaxPosts !== "number") return false;
  if (v.extractedCount !== undefined && typeof v.extractedCount !== "number") return false;
  if (v.skippedCount !== undefined && typeof v.skippedCount !== "number") return false;
  if (v.posts !== undefined && !Array.isArray(v.posts)) return false;
  if (v.skipped !== undefined && !Array.isArray(v.skipped)) return false;
  if (v.errorCode !== undefined && typeof v.errorCode !== "string") return false;
  if (v.message !== undefined && typeof v.message !== "string") return false;
  if (v.error !== undefined && typeof v.error !== "string") return false;
  return true;
}

interface TopPostsResult {
  query: string;
  sourceUrl: string;
  extractedAt: string;
  requestedMaxPosts: number;
  extractedCount: number;
  skippedCount: number;
  posts: ResearchPostImportItem[];
  skipped: unknown[];
}

function mapExtractTopPostsErrorMessage(errorCode: string | undefined, fallback: string): string {
  switch (errorCode) {
    case "NO_DEDICATED_TAB":
      return "先に「X検索タブを開く」を実行してください。";
    case "TAB_NOT_FOUND":
      return "専用タブが見つかりません。もう一度「X検索タブを開く」を実行してください。";
    case "INVALID_TAB_URL":
      return "専用タブを話題検索ページとして確認できませんでした。もう一度「X検索タブを開く」からやり直してください。";
    case "INVALID_QUERY":
    case "EMPTY_QUERY":
      return "最新結果から有効な検索語を確認できませんでした。最新投稿をもう一度抽出してください。";
    case "QUERY_TOO_LONG":
      return "検索語が長すぎます。検索語を短くして最新投稿からやり直してください。";
    case "TAB_NAVIGATION_FAILED":
      return "話題検索ページへの移動を完了できませんでした。Xの表示状態を確認して、もう一度お試しください。";
    case "RENDER_NOT_CONFIRMED":
      return "15秒以内に話題投稿の表示を確認できませんでした。検索結果0件、描画遅延、未ログイン、X側エラー等の可能性があります。";
    case "SCRIPT_INJECTION_FAILED":
      return "話題投稿の抽出処理を実行できませんでした。拡張機能を再読み込みして、もう一度お試しください。";
    case "ALREADY_PROCESSING":
      return "現在処理中です。完了後にもう一度お試しください。";
    default:
      return fallback;
  }
}

// Gate 2B-1の最新抽出結果のsourceUrl（https://x.com/search?q=...&f=live 等）
// から、話題抽出に使う検索語を復元する。入力欄(openSearchTabQueryInput)の
// 現在値は一切参照しない — 利用者が後から検索語を編集していても、話題抽出は
// 常に最新抽出が実際に使ったqを使う。復元できない場合はnullを返す。
function deriveTopSearchQuery(sourceUrl: string | undefined): string | null {
  if (!sourceUrl) return null;
  let parsed: URL;
  try {
    parsed = new URL(sourceUrl);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:" || parsed.hostname !== "x.com" || parsed.pathname !== "/search") {
    return null;
  }
  const q = parsed.searchParams.get("q");
  if (!q) return null;
  return q;
}

// ── Gate 2B-3A: 注目アカウントのプロフィールからの投稿データ抽出（開発時のみ表示） ──
// 遷移待機（最大15秒）＋描画確認（最大15秒）＋抽出処理が直列に発生するため、
// Gate 2B-2Aと同じ40秒の安全タイムアウトを設ける。
const EXTRACT_ACCOUNT_POSTS_TIMEOUT_MS = 40000;
const EXTRACT_ACCOUNT_POSTS_INITIAL_DISPLAY_COUNT = 3;

interface XResearchExtractAccountPostsResponse {
  ok: boolean;
  requestId?: string;
  status?: string;
  username?: string;
  sourceUrl?: string;
  extractedAt?: string;
  requestedMaxPosts?: number;
  extractedCount?: number;
  skippedCount?: number;
  posts?: unknown[];
  skipped?: unknown[];
  errorCode?: string;
  message?: string;
  error?: string;
}

// 拡張機能からの応答を無条件に信用せず、実行時に構造を検証する。posts/skipped
// の各要素までは深く検証しない（Gate 2B-1/2B-2Aの応答検証と同じ扱い）。
function isXResearchExtractAccountPostsResponse(value: unknown): value is XResearchExtractAccountPostsResponse {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  if (typeof v.ok !== "boolean") return false;
  if (v.requestId !== undefined && typeof v.requestId !== "string") return false;
  if (v.status !== undefined && typeof v.status !== "string") return false;
  if (v.username !== undefined && typeof v.username !== "string") return false;
  if (v.sourceUrl !== undefined && typeof v.sourceUrl !== "string") return false;
  if (v.extractedAt !== undefined && typeof v.extractedAt !== "string") return false;
  if (v.requestedMaxPosts !== undefined && typeof v.requestedMaxPosts !== "number") return false;
  if (v.extractedCount !== undefined && typeof v.extractedCount !== "number") return false;
  if (v.skippedCount !== undefined && typeof v.skippedCount !== "number") return false;
  if (v.posts !== undefined && !Array.isArray(v.posts)) return false;
  if (v.skipped !== undefined && !Array.isArray(v.skipped)) return false;
  if (v.errorCode !== undefined && typeof v.errorCode !== "string") return false;
  if (v.message !== undefined && typeof v.message !== "string") return false;
  if (v.error !== undefined && typeof v.error !== "string") return false;
  return true;
}

interface AccountPostsResult {
  username: string;
  sourceUrl: string;
  extractedAt: string;
  requestedMaxPosts: number;
  extractedCount: number;
  skippedCount: number;
  posts: ResearchPostImportItem[];
  skipped: unknown[];
}

function mapExtractAccountPostsErrorMessage(errorCode: string | undefined, fallback: string): string {
  switch (errorCode) {
    case "NO_DEDICATED_TAB":
      return "先に「X検索タブを開く」を実行してください。";
    case "TAB_NOT_FOUND":
      return "専用タブが見つかりません。もう一度「X検索タブを開く」を実行してください。";
    case "INVALID_TAB_URL":
      return "専用タブを対象アカウントのプロフィールページとして確認できませんでした。もう一度「X検索タブを開く」からやり直してください。";
    case "EMPTY_USERNAME":
    case "INVALID_USERNAME":
      return "ユーザー名を確認できませんでした。入力内容を見直してください。";
    case "USERNAME_TOO_LONG":
      return "ユーザー名が長すぎます。15文字以内で入力してください。";
    case "TAB_NAVIGATION_FAILED":
      return "プロフィールページへの移動を完了できませんでした。Xの表示状態を確認して、もう一度お試しください。";
    case "RENDER_NOT_CONFIRMED":
      return "15秒以内に投稿の表示を確認できませんでした。投稿0件、描画遅延、未ログイン、アカウントが存在しない、保護/凍結アカウント等の可能性があります。";
    case "SCRIPT_INJECTION_FAILED":
      return "アカウント投稿の抽出処理を実行できませんでした。拡張機能を再読み込みして、もう一度お試しください。";
    case "ALREADY_PROCESSING":
      return "現在処理中です。完了後にもう一度お試しください。";
    default:
      return fallback;
  }
}

interface ImportResult {
  totalInput: number;
  newPosts: number;
  updatedPosts: number;
  newRelations: number;
  existingRelations: number;
  skipped: { index: number; postId?: string; reason: string }[];
  failed: { index: number; postId?: string; reason: string }[];
}

interface CardState {
  savedReason: string;
  memo: string;
  tagsInput: string;
  searchQuery: string;
  saveStatus: "idle" | "saving" | "success" | "error";
  saveError?: string;
  deleteStatus: "idle" | "deleting" | "error";
  deleteError?: string;
}

function tagsToInputString(tags: string[]): string {
  return tags.join(", ");
}

interface TagsValidationResult {
  ok: boolean;
  tags: string[];
  error?: string;
}

// Splits on comma/読点/newline, trims, drops empty entries, and dedupes —
// but unlike the server's normalizeTags() (app/api/research-posts/[relationId]/route.ts),
// this never silently truncates an over-limit tag or drops tags past the
// 20-tag cap. Exceeding either limit is reported as a validation error so
// the caller can show it and skip sending the PATCH — the count/length
// limits are enforced, never silently rewritten.
function normalizeTagsInput(raw: string): TagsValidationResult {
  const parts = raw.split(/[,、\n]/);
  const seen = new Set<string>();
  const result: string[] = [];
  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    if (seen.has(trimmed)) continue;
    seen.add(trimmed);
    result.push(trimmed);
  }
  if (result.some((t) => t.length > MAX_TAG_LEN)) {
    return { ok: false, tags: result, error: `各タグは${MAX_TAG_LEN}文字以内で入力してください` };
  }
  if (result.length > MAX_TAGS) {
    return { ok: false, tags: result, error: `タグは${MAX_TAGS}件以内で入力してください` };
  }
  return { ok: true, tags: result };
}

function makeCardState(item: ResearchPostListItem): CardState {
  return {
    savedReason: item.savedReason ?? "",
    memo: item.memo ?? "",
    tagsInput: tagsToInputString(item.tags),
    searchQuery: item.searchQuery ?? "",
    saveStatus: "idle",
    deleteStatus: "idle",
  };
}

function formatDateTimeJST(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  try {
    return new Intl.DateTimeFormat("ja-JP", {
      timeZone: "Asia/Tokyo",
      year: "numeric",
      month: "long",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).format(d);
  } catch {
    return "—";
  }
}

function formatCount(n: number | null): string {
  return n === null || n === undefined ? "—" : String(n);
}

function formatBookmarkRate(bookmarks: number | null, views: number | null): string {
  if (bookmarks === null || views === null || views === 0) return "—";
  return `${((bookmarks / views) * 100).toFixed(2)}%`;
}

// Gate 2B-2B: 話題のみ一覧・重複一覧で使う、Gate 2B-1/2B-2Aの投稿カードと
// 同じ表示形式の共通レンダラー（見た目の重複を避けるための最小限の関数化。
// Gate 2B-1/2B-2A自身の既存カード表示は変更しない）。
function renderResearchPostCard(post: ResearchPostImportItem, index: number) {
  const textPreview =
    (post.text || "").slice(0, EXTRACT_TOP_POSTS_TEXT_PREVIEW_LENGTH) +
    ((post.text || "").length > EXTRACT_TOP_POSTS_TEXT_PREVIEW_LENGTH || post.isTextTruncated ? "…" : "");
  return (
    <li key={post.postId || index} className="bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 space-y-1">
      <div className="text-zinc-200">
        {post.authorName || "(名前不明)"}
        <span className="text-zinc-500 ml-1">@{post.authorHandle || "(不明)"}</span>
      </div>
      <div className="text-zinc-300 whitespace-pre-wrap break-words">
        {textPreview || "(本文なし)"}
        {post.isTextTruncated && <span className="ml-2 text-amber-400/80">（省略あり）</span>}
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-zinc-500">
        <span>返信 {formatCount(post.replies)}</span>
        <span>リポスト {formatCount(post.reposts)}</span>
        <span>いいね {formatCount(post.likes)}</span>
        <span>ブックマーク {formatCount(post.bookmarks)}</span>
        <span>表示 {formatCount(post.views)}</span>
        <span>投稿日時: {formatDateTimeJST(post.postedAtRaw)}</span>
      </div>
      <div>
        <a
          href={post.url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-sky-400 hover:text-sky-300 break-all"
        >
          {post.url}
        </a>
      </div>
    </li>
  );
}

async function parseErrorMessage(res: Response, fallback: string): Promise<string> {
  try {
    const body = await res.json();
    if (body && typeof body.error === "string") return body.error;
  } catch {
    /* not JSON, fall through */
  }
  return `${fallback} (${res.status})`;
}

export default function TabResearch({ noteAccountId }: TabResearchProps) {
  const [items, setItems] = useState<ResearchPostListItem[]>([]);
  const [cardStates, setCardStates] = useState<Record<string, CardState>>({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  const accountIdRef = useRef(noteAccountId);
  useEffect(() => {
    accountIdRef.current = noteAccountId;
  }, [noteAccountId]);

  // Generation counter for list fetches. Bumped whenever the displayed list
  // is about to be replaced wholesale (account switch, or a fresh page-1
  // refetch for the same account). "Load more" captures the generation in
  // effect at request time and only applies its result if the generation is
  // still current — this catches both an account switch AND a same-account
  // refetch invalidating an in-flight "load more", which a plain accountId
  // comparison alone cannot.
  const generationRef = useRef(0);
  const bumpGeneration = useCallback(() => {
    generationRef.current += 1;
    return generationRef.current;
  }, []);

  // Import UI state
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [selectedFileName, setSelectedFileName] = useState<string | null>(null);
  const [parsedItems, setParsedItems] = useState<unknown[] | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [searchQueryInput, setSearchQueryInput] = useState("");
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [importError, setImportError] = useState<string | null>(null);

  // Gate 1: 拡張機能との接続確認（開発時のみ）。既存のインポート・一覧・
  // generationRef/accountIdRef等の状態には一切触れない、独立した状態。
  const [extCheckStatus, setExtCheckStatus] = useState<"idle" | "checking" | "success" | "error">("idle");
  const [extCheckMessage, setExtCheckMessage] = useState<string | null>(null);
  const [extCheckVersion, setExtCheckVersion] = useState<string | null>(null);

  // Gate 2A-1: X検索専用タブの新規作成・再利用確認（開発時のみ）。
  // こちらも既存の一覧・インポート・generationRef/accountIdRef等には触れない、
  // Gate 1のUIとも独立した状態。
  const [openSearchTabQueryInput, setOpenSearchTabQueryInput] = useState("");
  const [openSearchTabStatus, setOpenSearchTabStatus] = useState<"idle" | "checking" | "success" | "error">("idle");
  const [openSearchTabMessage, setOpenSearchTabMessage] = useState<string | null>(null);
  const [openSearchTabReused, setOpenSearchTabReused] = useState<boolean | null>(null);
  // 古い要求の応答が後から届いても現在の画面へ反映しないためのガード。
  const openSearchTabRequestIdRef = useRef<string | null>(null);

  // Gate 2A-2: 専用タブでの投稿要素表示確認（開発時のみ）。Gate 2A-1の状態とは
  // 独立しているが、UI側では両方の処理中状態を見て互いのボタンを無効化する。
  const [confirmRenderStatus, setConfirmRenderStatus] = useState<"idle" | "checking" | "success" | "error">("idle");
  const [confirmRenderMessage, setConfirmRenderMessage] = useState<string | null>(null);
  const [confirmRenderDetectedCount, setConfirmRenderDetectedCount] = useState<number | null>(null);
  const confirmRenderRequestIdRef = useRef<string | null>(null);

  // Gate 2B-1: 専用タブからの投稿データ抽出確認（開発時のみ）。Gate 2A-1/2A-2の
  // 状態とは独立しているが、UI側では3つの処理中状態を見て互いのボタンを無効化する。
  const [extractPostsStatus, setExtractPostsStatus] = useState<"idle" | "checking" | "success" | "error">("idle");
  const [extractPostsMessage, setExtractPostsMessage] = useState<string | null>(null);
  const [extractPostsResult, setExtractPostsResult] = useState<ExtractPostsResult | null>(null);
  const [extractPostsShowAll, setExtractPostsShowAll] = useState(false);
  const extractPostsRequestIdRef = useRef<string | null>(null);

  // Gate 2B-2A: 「話題」検索結果からの投稿データ抽出（開発時のみ）。Gate
  // 2A-1/2A-2/2B-1の状態とは独立しているが、UI側では4つの処理中状態を見て
  // 互いのボタンを無効化する。
  const [topPostsStatus, setTopPostsStatus] = useState<"idle" | "checking" | "success" | "error">("idle");
  const [topPostsMessage, setTopPostsMessage] = useState<string | null>(null);
  const [topPostsResult, setTopPostsResult] = useState<TopPostsResult | null>(null);
  const [topPostsShowAll, setTopPostsShowAll] = useState(false);
  const topPostsRequestIdRef = useRef<string | null>(null);

  // Gate 2B-2B: 最新（Gate 2B-1）・話題（Gate 2B-2A）一覧の「話題のみ」表示の
  // 展開状態だけを持つUI用state。比較結果そのもの（duplicates/topOnly）は
  // stateに保持せず、下のpostComparisonで描画のたびに導出する。
  const [topOnlyShowAll, setTopOnlyShowAll] = useState(false);

  // Gate 2B-2B: 最新・話題の両方が揃っている場合だけ、postIdの完全一致で比較する。
  // 新しい通信・Chrome拡張メッセージ・DB保存・API送信・AI評価は行わない。投稿
  // オブジェクトは既存配列の参照をそのまま使い、ディープコピー・破壊的変更は
  // しない。片方しか無い場合はnullを返し、呼び出し側で0件と誤表示しない。
  const postComparison = useMemo(() => {
    if (!extractPostsResult || !topPostsResult) return null;
    const latestPosts = extractPostsResult.posts;
    const topPosts = topPostsResult.posts;
    const latestPostIdSet = new Set(latestPosts.map((post) => post.postId));
    const duplicates = topPosts.filter((post) => latestPostIdSet.has(post.postId));
    const topOnly = topPosts.filter((post) => !latestPostIdSet.has(post.postId));
    return {
      latestCount: latestPosts.length,
      topCount: topPosts.length,
      duplicates,
      topOnly,
    };
  }, [extractPostsResult, topPostsResult]);

  // Gate 2B-3A: 注目アカウント（1件）のプロフィールからの投稿データ抽出
  // （開発時のみ）。Gate 2A-1/2A-2/2B-1/2B-2Aの状態とは独立しているが、UI側
  // では5つの処理中状態を見て互いのボタンを無効化する。最新・話題・比較結果
  // とは別のデータであり、それらを消す・消される関係にはない。
  const [accountUsernameInput, setAccountUsernameInput] = useState("");
  const [accountPostsStatus, setAccountPostsStatus] = useState<"idle" | "checking" | "success" | "error">("idle");
  const [accountPostsMessage, setAccountPostsMessage] = useState<string | null>(null);
  const [accountPostsResult, setAccountPostsResult] = useState<AccountPostsResult | null>(null);
  const [accountPostsShowAll, setAccountPostsShowAll] = useState(false);
  const accountPostsRequestIdRef = useRef<string | null>(null);

  const mergeCardStates = useCallback((newItems: ResearchPostListItem[]) => {
    setCardStates((prev) => {
      const next = { ...prev };
      for (const item of newItems) {
        if (!next[item.relationId]) {
          next[item.relationId] = makeCardState(item);
        }
      }
      return next;
    });
  }, []);

  // Initial load + reload whenever the selected note account changes.
  // Bumping the generation here invalidates any in-flight "load more" (or
  // a previous account's own initial fetch) so it can never mix into this
  // fresh list.
  useEffect(() => {
    const myGeneration = bumpGeneration();
    const requestedAccountId = noteAccountId;
    setItems([]);
    setCardStates({});
    setHasMore(false);
    setLoading(true);
    setLoadError(null);
    setImportResult(null);
    setImportError(null);
    setSelectedFileName(null);
    setParsedItems(null);
    setFileError(null);
    setSearchQueryInput("");
    if (fileInputRef.current) fileInputRef.current.value = "";

    (async () => {
      try {
        const params = new URLSearchParams({
          noteAccountId: requestedAccountId,
          limit: String(PAGE_SIZE),
          offset: "0",
        });
        const res = await fetch(`/api/research-posts?${params.toString()}`);
        if (!res.ok) throw new Error(await parseErrorMessage(res, "一覧の取得に失敗しました"));
        const data = (await res.json()) as { items: ResearchPostListItem[]; hasMore: boolean };
        if (generationRef.current !== myGeneration || accountIdRef.current !== requestedAccountId) return;
        setItems(data.items);
        setHasMore(data.hasMore);
        mergeCardStates(data.items);
      } catch (e) {
        if (generationRef.current !== myGeneration || accountIdRef.current !== requestedAccountId) return;
        setLoadError(e instanceof Error ? e.message : "一覧の取得に失敗しました");
      } finally {
        if (generationRef.current === myGeneration) setLoading(false);
      }
    })();
  }, [noteAccountId, mergeCardStates, bumpGeneration]);

  const handleLoadMore = async () => {
    if (loadingMore || loading || !hasMore) return;
    const requestedAccountId = noteAccountId;
    const requestedOffset = items.length;
    // Captures the generation as of "load more" being requested (does NOT
    // bump it — this is an append, not a wholesale replace). If a fresh
    // page-1 fetch (account switch or post-import refetch) happens before
    // this resolves, the generation moves on and this result is discarded.
    const myGeneration = generationRef.current;
    setLoadingMore(true);
    try {
      const params = new URLSearchParams({
        noteAccountId: requestedAccountId,
        limit: String(PAGE_SIZE),
        offset: String(requestedOffset),
      });
      const res = await fetch(`/api/research-posts?${params.toString()}`);
      if (!res.ok) throw new Error(await parseErrorMessage(res, "追加取得に失敗しました"));
      const data = (await res.json()) as { items: ResearchPostListItem[]; hasMore: boolean };
      if (generationRef.current !== myGeneration || accountIdRef.current !== requestedAccountId) return;
      setItems((prev) => {
        const seen = new Set(prev.map((i) => i.relationId));
        return [...prev, ...data.items.filter((i) => !seen.has(i.relationId))];
      });
      setHasMore(data.hasMore);
      mergeCardStates(data.items);
    } catch (e) {
      if (generationRef.current === myGeneration && accountIdRef.current === requestedAccountId) {
        setLoadError(e instanceof Error ? e.message : "追加取得に失敗しました");
      }
    } finally {
      // Always clear the busy flag for this component instance, even if the
      // result itself was discarded as stale — otherwise the "もっと見る"
      // button would stay stuck disabled after an account switch.
      setLoadingMore(false);
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    const requestedAccountId = noteAccountId;
    setImportResult(null);
    setImportError(null);
    setParsedItems(null);
    setSelectedFileName(null);
    setFileError(null);
    if (!file) return;

    if (file.size > MAX_IMPORT_BYTES) {
      setFileError(`ファイルサイズが2MBを超えています（${file.size}バイト）`);
      return;
    }

    let text: string;
    try {
      text = await file.text();
    } catch {
      if (accountIdRef.current === requestedAccountId) setFileError("ファイルを読み込めませんでした");
      return;
    }

    // The selected note account may have changed while the file was being
    // read (file.text() is async) — never let a stale read populate a
    // different account's screen.
    if (accountIdRef.current !== requestedAccountId) return;

    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      setFileError("JSONとして解析できませんでした");
      return;
    }

    if (!Array.isArray(parsed)) {
      setFileError("JSON配列ではありません");
      return;
    }
    if (parsed.length < 1 || parsed.length > MAX_IMPORT_ITEMS) {
      setFileError(`投稿は1〜${MAX_IMPORT_ITEMS}件である必要があります（${parsed.length}件）`);
      return;
    }

    setSelectedFileName(file.name);
    setParsedItems(parsed);
  };

  const handleImport = async () => {
    if (!parsedItems || importing) return;
    const requestedAccountId = noteAccountId;
    setImporting(true);
    setImportResult(null);
    setImportError(null);
    try {
      const trimmedQuery = searchQueryInput.trim();
      const res = await fetch("/api/research-posts/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          noteAccountId: requestedAccountId,
          searchQuery: trimmedQuery.length > 0 ? trimmedQuery : null,
          items: parsedItems,
        }),
      });
      if (!res.ok) throw new Error(await parseErrorMessage(res, "インポートに失敗しました"));
      const result = (await res.json()) as ImportResult;
      if (accountIdRef.current !== requestedAccountId) return; // stale account; the import already succeeded server-side but this screen no longer shows it

      setImportResult(result);
      setSelectedFileName(null);
      setParsedItems(null);
      setSearchQueryInput("");
      if (fileInputRef.current) fileInputRef.current.value = "";

      // Refresh page 1 so newly imported/updated posts show up immediately.
      // Bump the generation first — this invalidates any "load more" that
      // was still in flight from before the import, so it can't append
      // stale rows onto this freshly replaced list.
      const myGeneration = bumpGeneration();
      const params = new URLSearchParams({
        noteAccountId: requestedAccountId,
        limit: String(PAGE_SIZE),
        offset: "0",
      });
      const listRes = await fetch(`/api/research-posts?${params.toString()}`);
      if (
        listRes.ok &&
        generationRef.current === myGeneration &&
        accountIdRef.current === requestedAccountId
      ) {
        const data = (await listRes.json()) as { items: ResearchPostListItem[]; hasMore: boolean };
        setItems(data.items);
        setHasMore(data.hasMore);
        mergeCardStates(data.items);
      }
    } catch (e) {
      if (accountIdRef.current === requestedAccountId) {
        setImportError(e instanceof Error ? e.message : "インポートに失敗しました");
      }
    } finally {
      setImporting(false);
    }
  };

  // Gate 1: 拡張機能への固定pingメッセージを送り、固定応答を受け取るだけの
  // 接続確認。Xを開かず、既存のAPI（/api/research-posts*）も一切呼ばない。
  const handleCheckExtensionConnection = () => {
    if (extCheckStatus === "checking") return;

    setExtCheckStatus("checking");
    setExtCheckMessage(null);
    setExtCheckVersion(null);

    const extensionId = process.env.NEXT_PUBLIC_X_RESEARCH_EXTENSION_ID;
    if (!extensionId) {
      setExtCheckStatus("error");
      setExtCheckMessage("Chrome拡張機能IDが設定されていません");
      return;
    }

    const runtime = getChromeRuntime();
    if (!runtime || typeof runtime.sendMessage !== "function") {
      setExtCheckStatus("error");
      setExtCheckMessage("この環境ではchrome.runtimeを利用できません（Chromeブラウザで開いてください）");
      return;
    }

    const requestId = crypto.randomUUID();
    let settled = false;

    const timeoutId = setTimeout(() => {
      if (settled) return;
      settled = true;
      setExtCheckStatus("error");
      setExtCheckMessage("5秒以内に応答がありませんでした");
    }, EXTENSION_PING_TIMEOUT_MS);

    try {
      runtime.sendMessage(extensionId, { type: "X_RESEARCH_PING", requestId }, (response: unknown) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeoutId);

        if (runtime.lastError) {
          setExtCheckStatus("error");
          setExtCheckMessage(`拡張機能が見つからないか通信に失敗しました: ${runtime.lastError.message ?? "不明なエラー"}`);
          return;
        }

        if (!isXResearchPingResponse(response)) {
          setExtCheckStatus("error");
          setExtCheckMessage("応答の形式が不正です");
          return;
        }

        if (response.requestId !== requestId) {
          setExtCheckStatus("error");
          setExtCheckMessage("応答のrequestIdが一致しません");
          return;
        }

        if (!response.ok) {
          setExtCheckStatus("error");
          setExtCheckMessage(response.error ?? "拡張機能がエラーを返しました");
          return;
        }

        setExtCheckStatus("success");
        setExtCheckVersion(response.extensionVersion ?? null);
      });
    } catch (e) {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
      setExtCheckStatus("error");
      setExtCheckMessage(e instanceof Error ? e.message : "拡張機能が見つかりません");
    }
  };

  // Gate 2A-1: 検索語を送り、拡張機能側でX検索専用タブを作成・再利用させる。
  // 投稿要素の確認・抽出・API呼び出し・DB保存は一切行わない。
  const handleOpenSearchTab = () => {
    if (openSearchTabStatus === "checking") return;

    setOpenSearchTabStatus("checking");
    setOpenSearchTabMessage(null);
    setOpenSearchTabReused(null);

    const validated = validateOpenSearchTabQuery(openSearchTabQueryInput);
    if (!validated.ok) {
      setOpenSearchTabStatus("error");
      setOpenSearchTabMessage(validated.error);
      return;
    }

    const extensionId = process.env.NEXT_PUBLIC_X_RESEARCH_EXTENSION_ID;
    if (!extensionId) {
      setOpenSearchTabStatus("error");
      setOpenSearchTabMessage("Chrome拡張機能IDが設定されていません");
      return;
    }

    const runtime = getChromeRuntime();
    if (!runtime || typeof runtime.sendMessage !== "function") {
      setOpenSearchTabStatus("error");
      setOpenSearchTabMessage("この環境ではchrome.runtimeを利用できません（Chromeブラウザで開いてください）");
      return;
    }

    const requestId = crypto.randomUUID();
    openSearchTabRequestIdRef.current = requestId;
    let settled = false;

    const timeoutId = setTimeout(() => {
      if (settled) return;
      settled = true;
      if (openSearchTabRequestIdRef.current !== requestId) return;
      setOpenSearchTabStatus("error");
      setOpenSearchTabMessage(`${OPEN_SEARCH_TAB_TIMEOUT_MS / 1000}秒以内に応答がありませんでした`);
    }, OPEN_SEARCH_TAB_TIMEOUT_MS);

    try {
      runtime.sendMessage(
        extensionId,
        { type: "X_RESEARCH_OPEN_SEARCH_TAB", requestId, query: validated.value },
        (response: unknown) => {
          if (settled) return;
          settled = true;
          clearTimeout(timeoutId);

          // 古い要求（連続実行や別の検索語での再実行）の応答は無視する。
          if (openSearchTabRequestIdRef.current !== requestId) return;

          if (runtime.lastError) {
            setOpenSearchTabStatus("error");
            setOpenSearchTabMessage(
              `拡張機能が見つからないか通信に失敗しました: ${runtime.lastError.message ?? "不明なエラー"}`
            );
            return;
          }

          if (!isXResearchOpenSearchTabResponse(response)) {
            setOpenSearchTabStatus("error");
            setOpenSearchTabMessage("応答の形式が不正です");
            return;
          }

          if (response.requestId !== requestId) {
            setOpenSearchTabStatus("error");
            setOpenSearchTabMessage("応答のrequestIdが一致しません");
            return;
          }

          if (!response.ok) {
            setOpenSearchTabStatus("error");
            setOpenSearchTabMessage(response.message ?? response.error ?? "拡張機能がエラーを返しました");
            return;
          }

          setOpenSearchTabStatus("success");
          setOpenSearchTabReused(response.tabReused ?? null);
        }
      );
    } catch (e) {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
      if (openSearchTabRequestIdRef.current !== requestId) return;
      setOpenSearchTabStatus("error");
      setOpenSearchTabMessage(e instanceof Error ? e.message : "拡張機能が見つかりません");
    }
  };

  // Gate 2A-2: 専用タブでX投稿要素が1件以上表示されたかだけを確認する。
  // 投稿本文・投稿者・反応数・URL等は一切取得・表示しない。
  const handleConfirmRender = () => {
    if (confirmRenderStatus === "checking") return;

    setConfirmRenderStatus("checking");
    setConfirmRenderMessage(null);
    setConfirmRenderDetectedCount(null);

    const extensionId = process.env.NEXT_PUBLIC_X_RESEARCH_EXTENSION_ID;
    if (!extensionId) {
      setConfirmRenderStatus("error");
      setConfirmRenderMessage("Chrome拡張機能IDが設定されていません");
      return;
    }

    const runtime = getChromeRuntime();
    if (!runtime || typeof runtime.sendMessage !== "function") {
      setConfirmRenderStatus("error");
      setConfirmRenderMessage("この環境ではchrome.runtimeを利用できません（Chromeブラウザで開いてください）");
      return;
    }

    const requestId = crypto.randomUUID();
    confirmRenderRequestIdRef.current = requestId;
    let settled = false;

    const timeoutId = setTimeout(() => {
      if (settled) return;
      settled = true;
      if (confirmRenderRequestIdRef.current !== requestId) return;
      setConfirmRenderStatus("error");
      setConfirmRenderMessage(`${CONFIRM_RENDER_TIMEOUT_MS / 1000}秒以内に応答がありませんでした`);
    }, CONFIRM_RENDER_TIMEOUT_MS);

    try {
      runtime.sendMessage(
        extensionId,
        { type: "X_RESEARCH_CONFIRM_RENDER", requestId },
        (response: unknown) => {
          if (settled) return;
          settled = true;
          clearTimeout(timeoutId);

          // 古い要求（連続実行）の応答は無視する。
          if (confirmRenderRequestIdRef.current !== requestId) return;

          if (runtime.lastError) {
            setConfirmRenderStatus("error");
            setConfirmRenderMessage(
              `拡張機能が見つからないか通信に失敗しました: ${runtime.lastError.message ?? "不明なエラー"}`
            );
            return;
          }

          if (!isXResearchConfirmRenderResponse(response)) {
            setConfirmRenderStatus("error");
            setConfirmRenderMessage("応答の形式が不正です");
            return;
          }

          if (response.requestId !== requestId) {
            setConfirmRenderStatus("error");
            setConfirmRenderMessage("応答のrequestIdが一致しません");
            return;
          }

          if (!response.ok) {
            const errorCode = response.errorCode;
            let message = response.message ?? response.error ?? "拡張機能がエラーを返しました";
            if (errorCode === "NO_DEDICATED_TAB") {
              message = "先に「X検索タブを開く」を実行してください。";
            } else if (errorCode === "TAB_NOT_FOUND") {
              message = "専用タブが見つかりません。もう一度「X検索タブを開く」を実行してください。";
            } else if (errorCode === "RENDER_NOT_CONFIRMED") {
              message =
                "15秒以内に投稿要素の表示を確認できませんでした。検索結果0件、描画遅延、未ログイン、X側エラー等の可能性があります。";
            }
            setConfirmRenderStatus("error");
            setConfirmRenderMessage(message);
            return;
          }

          setConfirmRenderStatus("success");
          setConfirmRenderDetectedCount(response.detectedCount ?? null);
        }
      );
    } catch (e) {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
      if (confirmRenderRequestIdRef.current !== requestId) return;
      setConfirmRenderStatus("error");
      setConfirmRenderMessage(e instanceof Error ? e.message : "拡張機能が見つかりません");
    }
  };

  // Gate 2B-1: 専用タブから最大10件の投稿データを抽出する。件数は拡張機能側の
  // 固定値（EXTRACT_POSTS_MAX）で決まり、ここではmaxPostsを一切送らない。
  // DB保存・API呼び出し・storage.sessionへの保存は行わない。
  const handleExtractPosts = () => {
    if (extractPostsStatus === "checking") return;

    setExtractPostsStatus("checking");
    setExtractPostsMessage(null);
    // 既存の最新結果・話題結果はここでは消さない。URL検証失敗（話題ページ上で
    // 誤って最新抽出を押した場合等）やタイムアウト等の一時的な失敗で、直前まで
    // 有効だった結果を巻き添えで消さないため。結果の置き換え・話題結果の
    // クリアは、この抽出が実際に成功した時点でのみ行う（下記の成功分岐）。

    const extensionId = process.env.NEXT_PUBLIC_X_RESEARCH_EXTENSION_ID;
    if (!extensionId) {
      setExtractPostsStatus("error");
      setExtractPostsMessage("Chrome拡張機能IDが設定されていません");
      return;
    }

    const runtime = getChromeRuntime();
    if (!runtime || typeof runtime.sendMessage !== "function") {
      setExtractPostsStatus("error");
      setExtractPostsMessage("この環境ではchrome.runtimeを利用できません（Chromeブラウザで開いてください）");
      return;
    }

    const requestId = crypto.randomUUID();
    extractPostsRequestIdRef.current = requestId;
    let settled = false;

    const timeoutId = setTimeout(() => {
      if (settled) return;
      settled = true;
      if (extractPostsRequestIdRef.current !== requestId) return;
      setExtractPostsStatus("error");
      setExtractPostsMessage(`${EXTRACT_POSTS_TIMEOUT_MS / 1000}秒以内に応答がありませんでした`);
    }, EXTRACT_POSTS_TIMEOUT_MS);

    try {
      runtime.sendMessage(
        extensionId,
        { type: "X_RESEARCH_EXTRACT_POSTS", requestId },
        (response: unknown) => {
          if (settled) return;
          settled = true;
          clearTimeout(timeoutId);

          // 古い要求（連続実行）の応答は無視する。
          if (extractPostsRequestIdRef.current !== requestId) return;

          if (runtime.lastError) {
            setExtractPostsStatus("error");
            setExtractPostsMessage(
              `拡張機能が見つからないか通信に失敗しました: ${runtime.lastError.message ?? "不明なエラー"}`
            );
            return;
          }

          if (!isXResearchExtractPostsResponse(response)) {
            setExtractPostsStatus("error");
            setExtractPostsMessage("応答の形式が不正です");
            return;
          }

          if (response.requestId !== requestId) {
            setExtractPostsStatus("error");
            setExtractPostsMessage("応答のrequestIdが一致しません");
            return;
          }

          if (!response.ok) {
            const message = mapExtractPostsErrorMessage(
              response.errorCode,
              response.message ?? response.error ?? "拡張機能がエラーを返しました"
            );
            setExtractPostsStatus("error");
            setExtractPostsMessage(message);
            return;
          }

          if (
            typeof response.sourceUrl !== "string" ||
            typeof response.extractedAt !== "string" ||
            typeof response.requestedMaxPosts !== "number" ||
            typeof response.extractedCount !== "number" ||
            typeof response.skippedCount !== "number" ||
            !Array.isArray(response.posts) ||
            !Array.isArray(response.skipped)
          ) {
            setExtractPostsStatus("error");
            setExtractPostsMessage("応答の形式が不正です");
            return;
          }

          setExtractPostsStatus("success");
          setExtractPostsResult({
            sourceUrl: response.sourceUrl,
            extractedAt: response.extractedAt,
            requestedMaxPosts: response.requestedMaxPosts,
            extractedCount: response.extractedCount,
            skippedCount: response.skippedCount,
            posts: response.posts as ResearchPostImportItem[],
            skipped: response.skipped,
          });
          setExtractPostsShowAll(false);

          // 最新抽出が実際に成功した時点でのみ、古い話題結果をクリアする —
          // 話題結果は直前の最新結果と紐づいており、新しい最新結果に置き換わった
          // 以上は混在させないため。抽出が失敗した場合はここまで到達せず、
          // 既存の話題結果はそのまま残る。
          setTopPostsStatus("idle");
          setTopPostsMessage(null);
          setTopPostsResult(null);
          setTopPostsShowAll(false);
        }
      );
    } catch (e) {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
      if (extractPostsRequestIdRef.current !== requestId) return;
      setExtractPostsStatus("error");
      setExtractPostsMessage(e instanceof Error ? e.message : "拡張機能が見つかりません");
    }
  };

  // Gate 2B-2A: 専用タブを「話題」検索結果へ遷移させ、最大10件の投稿データを
  // 抽出する。検索語は入力欄(openSearchTabQueryInput)の現在値ではなく、常に
  // Gate 2B-1の最新抽出結果のsourceUrlから復元したものを使う。最新と話題の
  // 重複整理はまだ行わない（Gate 2B-2Bの対象）。DB保存・API呼び出し・
  // storage.sessionへの保存は行わない。
  const handleExtractTopPosts = () => {
    if (topPostsStatus === "checking") return;

    const query = deriveTopSearchQuery(extractPostsResult?.sourceUrl);
    if (!query) {
      setTopPostsStatus("error");
      setTopPostsMessage("最新の抽出結果から検索語を確認できません。もう一度、最新投稿を抽出してください。");
      return;
    }

    setTopPostsStatus("checking");
    setTopPostsMessage(null);
    setTopPostsResult(null);
    setTopPostsShowAll(false);

    const extensionId = process.env.NEXT_PUBLIC_X_RESEARCH_EXTENSION_ID;
    if (!extensionId) {
      setTopPostsStatus("error");
      setTopPostsMessage("Chrome拡張機能IDが設定されていません");
      return;
    }

    const runtime = getChromeRuntime();
    if (!runtime || typeof runtime.sendMessage !== "function") {
      setTopPostsStatus("error");
      setTopPostsMessage("この環境ではchrome.runtimeを利用できません（Chromeブラウザで開いてください）");
      return;
    }

    const requestId = crypto.randomUUID();
    topPostsRequestIdRef.current = requestId;
    let settled = false;

    const timeoutId = setTimeout(() => {
      if (settled) return;
      settled = true;
      if (topPostsRequestIdRef.current !== requestId) return;
      setTopPostsStatus("error");
      setTopPostsMessage(`${EXTRACT_TOP_POSTS_TIMEOUT_MS / 1000}秒以内に応答がありませんでした`);
    }, EXTRACT_TOP_POSTS_TIMEOUT_MS);

    try {
      runtime.sendMessage(
        extensionId,
        { type: "X_RESEARCH_EXTRACT_TOP_POSTS", requestId, query },
        (response: unknown) => {
          if (settled) return;
          settled = true;
          clearTimeout(timeoutId);

          // 古い要求（連続実行）の応答は無視する。
          if (topPostsRequestIdRef.current !== requestId) return;

          if (runtime.lastError) {
            setTopPostsStatus("error");
            setTopPostsMessage(
              `拡張機能が見つからないか通信に失敗しました: ${runtime.lastError.message ?? "不明なエラー"}`
            );
            return;
          }

          if (!isXResearchExtractTopPostsResponse(response)) {
            setTopPostsStatus("error");
            setTopPostsMessage("応答の形式が不正です");
            return;
          }

          if (response.requestId !== requestId) {
            setTopPostsStatus("error");
            setTopPostsMessage("応答のrequestIdが一致しません");
            return;
          }

          if (!response.ok) {
            const message = mapExtractTopPostsErrorMessage(
              response.errorCode,
              response.message ?? response.error ?? "拡張機能がエラーを返しました"
            );
            setTopPostsStatus("error");
            setTopPostsMessage(message);
            return;
          }

          if (
            typeof response.query !== "string" ||
            typeof response.sourceUrl !== "string" ||
            typeof response.extractedAt !== "string" ||
            typeof response.requestedMaxPosts !== "number" ||
            typeof response.extractedCount !== "number" ||
            typeof response.skippedCount !== "number" ||
            !Array.isArray(response.posts) ||
            !Array.isArray(response.skipped)
          ) {
            setTopPostsStatus("error");
            setTopPostsMessage("応答の形式が不正です");
            return;
          }

          setTopPostsStatus("success");
          setTopPostsResult({
            query: response.query,
            sourceUrl: response.sourceUrl,
            extractedAt: response.extractedAt,
            requestedMaxPosts: response.requestedMaxPosts,
            extractedCount: response.extractedCount,
            skippedCount: response.skippedCount,
            posts: response.posts as ResearchPostImportItem[],
            skipped: response.skipped,
          });
        }
      );
    } catch (e) {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
      if (topPostsRequestIdRef.current !== requestId) return;
      setTopPostsStatus("error");
      setTopPostsMessage(e instanceof Error ? e.message : "拡張機能が見つかりません");
    }
  };

  // Gate 2B-3A: 専用タブを注目アカウント（1件）のプロフィールへ遷移させ、
  // 最大10件の投稿データを抽出する。background.js側がusernameを最終的に
  // 再検証するため、ここでの検証は明らかな入力ミスの早期表示のみ。最新・
  // 話題・比較結果のいずれも消さない（抽出開始時・失敗時とも）。
  const handleExtractAccountPosts = () => {
    if (accountPostsStatus === "checking") return;

    const trimmedUsername = accountUsernameInput.trim();
    if (trimmedUsername.length === 0) {
      setAccountPostsStatus("error");
      setAccountPostsMessage("ユーザー名を入力してください");
      return;
    }

    setAccountPostsStatus("checking");
    setAccountPostsMessage(null);
    // 既存のaccountPostsResult・最新結果・話題結果・比較結果はここでは消さない。

    const extensionId = process.env.NEXT_PUBLIC_X_RESEARCH_EXTENSION_ID;
    if (!extensionId) {
      setAccountPostsStatus("error");
      setAccountPostsMessage("Chrome拡張機能IDが設定されていません");
      return;
    }

    const runtime = getChromeRuntime();
    if (!runtime || typeof runtime.sendMessage !== "function") {
      setAccountPostsStatus("error");
      setAccountPostsMessage("この環境ではchrome.runtimeを利用できません（Chromeブラウザで開いてください）");
      return;
    }

    const requestId = crypto.randomUUID();
    accountPostsRequestIdRef.current = requestId;
    let settled = false;

    const timeoutId = setTimeout(() => {
      if (settled) return;
      settled = true;
      if (accountPostsRequestIdRef.current !== requestId) return;
      setAccountPostsStatus("error");
      setAccountPostsMessage(`${EXTRACT_ACCOUNT_POSTS_TIMEOUT_MS / 1000}秒以内に応答がありませんでした`);
    }, EXTRACT_ACCOUNT_POSTS_TIMEOUT_MS);

    try {
      runtime.sendMessage(
        extensionId,
        { type: "X_RESEARCH_EXTRACT_ACCOUNT_POSTS", requestId, username: trimmedUsername },
        (response: unknown) => {
          if (settled) return;
          settled = true;
          clearTimeout(timeoutId);

          // 古い要求（連続実行）の応答は無視する。
          if (accountPostsRequestIdRef.current !== requestId) return;

          if (runtime.lastError) {
            setAccountPostsStatus("error");
            setAccountPostsMessage(
              `拡張機能が見つからないか通信に失敗しました: ${runtime.lastError.message ?? "不明なエラー"}`
            );
            return;
          }

          if (!isXResearchExtractAccountPostsResponse(response)) {
            setAccountPostsStatus("error");
            setAccountPostsMessage("応答の形式が不正です");
            return;
          }

          if (response.requestId !== requestId) {
            setAccountPostsStatus("error");
            setAccountPostsMessage("応答のrequestIdが一致しません");
            return;
          }

          if (!response.ok) {
            const message = mapExtractAccountPostsErrorMessage(
              response.errorCode,
              response.message ?? response.error ?? "拡張機能がエラーを返しました"
            );
            setAccountPostsStatus("error");
            setAccountPostsMessage(message);
            return;
          }

          if (
            typeof response.username !== "string" ||
            typeof response.sourceUrl !== "string" ||
            typeof response.extractedAt !== "string" ||
            typeof response.requestedMaxPosts !== "number" ||
            typeof response.extractedCount !== "number" ||
            typeof response.skippedCount !== "number" ||
            !Array.isArray(response.posts) ||
            !Array.isArray(response.skipped)
          ) {
            setAccountPostsStatus("error");
            setAccountPostsMessage("応答の形式が不正です");
            return;
          }

          setAccountPostsStatus("success");
          setAccountPostsResult({
            username: response.username,
            sourceUrl: response.sourceUrl,
            extractedAt: response.extractedAt,
            requestedMaxPosts: response.requestedMaxPosts,
            extractedCount: response.extractedCount,
            skippedCount: response.skippedCount,
            posts: response.posts as ResearchPostImportItem[],
            skipped: response.skipped,
          });
          setAccountPostsShowAll(false);
        }
      );
    } catch (e) {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
      if (accountPostsRequestIdRef.current !== requestId) return;
      setAccountPostsStatus("error");
      setAccountPostsMessage(e instanceof Error ? e.message : "拡張機能が見つかりません");
    }
  };

  const updateCardField = (relationId: string, field: keyof CardState, value: string) => {
    setCardStates((prev) => ({
      ...prev,
      [relationId]: { ...prev[relationId], [field]: value },
    }));
  };

  const handleSaveCard = async (relationId: string) => {
    const card = cardStates[relationId];
    if (!card || card.saveStatus === "saving") return;
    const requestedAccountId = noteAccountId;

    const savedReason = card.savedReason.trim();
    const memo = card.memo.trim();
    const searchQuery = card.searchQuery.trim();
    const tagsValidation = normalizeTagsInput(card.tagsInput);

    if (!tagsValidation.ok) {
      // Reject locally without sending the PATCH — the count/length limits
      // are enforced, not silently rewritten.
      setCardStates((prev) => ({
        ...prev,
        [relationId]: { ...prev[relationId], saveStatus: "error", saveError: tagsValidation.error },
      }));
      return;
    }
    const tags = tagsValidation.tags;

    setCardStates((prev) => ({
      ...prev,
      [relationId]: { ...prev[relationId], saveStatus: "saving", saveError: undefined },
    }));

    try {
      const params = new URLSearchParams({ noteAccountId: requestedAccountId });
      const res = await fetch(`/api/research-posts/${encodeURIComponent(relationId)}?${params.toString()}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          savedReason: savedReason.length > 0 ? savedReason : null,
          memo: memo.length > 0 ? memo : null,
          tags,
          searchQuery: searchQuery.length > 0 ? searchQuery : null,
        }),
      });
      if (!res.ok) throw new Error(await parseErrorMessage(res, "保存に失敗しました"));

      // The selected note account may have changed while this PATCH was in
      // flight — the write already succeeded server-side for the original
      // account, but this (now different) screen must not reflect it.
      if (accountIdRef.current !== requestedAccountId) return;

      // Align the on-screen values with what was actually sent (the
      // normalized values), not just leave the raw, unnormalized input.
      setCardStates((prev) => ({
        ...prev,
        [relationId]: {
          ...prev[relationId],
          savedReason: savedReason.length > 0 ? savedReason : "",
          memo: memo.length > 0 ? memo : "",
          tagsInput: tagsToInputString(tags),
          searchQuery: searchQuery.length > 0 ? searchQuery : "",
          saveStatus: "success",
        },
      }));
      setItems((prev) =>
        prev.map((item) =>
          item.relationId === relationId
            ? {
                ...item,
                savedReason: savedReason.length > 0 ? savedReason : null,
                memo: memo.length > 0 ? memo : null,
                tags,
                searchQuery: searchQuery.length > 0 ? searchQuery : null,
              }
            : item
        )
      );
      setTimeout(() => {
        if (accountIdRef.current !== requestedAccountId) return;
        setCardStates((prev) =>
          prev[relationId] && prev[relationId].saveStatus === "success"
            ? { ...prev, [relationId]: { ...prev[relationId], saveStatus: "idle" } }
            : prev
        );
      }, 3000);
    } catch (e) {
      if (accountIdRef.current !== requestedAccountId) return;
      setCardStates((prev) => ({
        ...prev,
        [relationId]: {
          ...prev[relationId],
          saveStatus: "error",
          saveError: e instanceof Error ? e.message : "保存に失敗しました",
        },
      }));
    }
  };

  const handleDeleteCard = async (relationId: string) => {
    const card = cardStates[relationId];
    if (card?.deleteStatus === "deleting") return;
    const requestedAccountId = noteAccountId;
    const confirmed = window.confirm(
      "この投稿と現在のnoteアカウントとの関連を削除します。X投稿そのものやリサーチDB本体は削除されません。よろしいですか？"
    );
    if (!confirmed) return;

    setCardStates((prev) => ({
      ...prev,
      [relationId]: { ...prev[relationId], deleteStatus: "deleting", deleteError: undefined },
    }));

    try {
      const params = new URLSearchParams({ noteAccountId: requestedAccountId });
      const res = await fetch(`/api/research-posts/${encodeURIComponent(relationId)}?${params.toString()}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error(await parseErrorMessage(res, "削除に失敗しました"));

      // The selected note account may have changed while this DELETE was in
      // flight — the deletion already succeeded server-side for the
      // original account, but this (now different) screen must not reflect it.
      if (accountIdRef.current !== requestedAccountId) return;

      setItems((prev) => prev.filter((item) => item.relationId !== relationId));
      setCardStates((prev) => {
        const next = { ...prev };
        delete next[relationId];
        return next;
      });
    } catch (e) {
      if (accountIdRef.current !== requestedAccountId) return;
      setCardStates((prev) => ({
        ...prev,
        [relationId]: {
          ...prev[relationId],
          deleteStatus: "error",
          deleteError: e instanceof Error ? e.message : "削除に失敗しました",
        },
      }));
    }
  };

  return (
    <div className="space-y-6">
      {/* Gate 1: 開発時のみ表示する拡張機能接続確認（本番では非表示） */}
      {process.env.NODE_ENV !== "production" && (
        <div className="bg-zinc-800 border border-amber-700/40 rounded-xl p-4 space-y-2">
          <h3 className="text-sm font-semibold text-zinc-200">
            開発用：Chrome拡張との接続確認（Gate 1）
          </h3>
          <p className="text-xs text-zinc-500">
            固定のpingメッセージを送り、拡張機能からの固定応答を確認するだけです。Xは開きません。
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handleCheckExtensionConnection}
              disabled={extCheckStatus === "checking"}
              className="px-3 py-2 text-xs bg-zinc-700 hover:bg-zinc-600 disabled:bg-zinc-800 disabled:text-zinc-600 text-zinc-200 rounded-lg transition-colors"
            >
              {extCheckStatus === "checking" ? "確認中..." : "拡張機能との接続を確認"}
            </button>
            {extCheckStatus === "success" && (
              <span className="text-xs text-green-400">
                接続成功（拡張機能バージョン: {extCheckVersion ?? "不明"}）
              </span>
            )}
            {extCheckStatus === "error" && (
              <span className="text-xs text-red-400">{extCheckMessage}</span>
            )}
          </div>
        </div>
      )}

      {/* Gate 2A-1: 開発時のみ表示するX検索専用タブの新規作成・再利用確認（本番では非表示） */}
      {process.env.NODE_ENV !== "production" && (
        <div className="bg-zinc-800 border border-amber-700/40 rounded-xl p-4 space-y-2">
          <h3 className="text-sm font-semibold text-zinc-200">
            開発用：X検索専用タブの作成・再利用確認（Gate 2A-1）
          </h3>
          <p className="text-xs text-zinc-500">
            検索語を送り、拡張機能がX検索専用タブを非アクティブのまま作成・再利用するかだけを確認します。投稿の取得・保存は行いません。
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="text"
              value={openSearchTabQueryInput}
              onChange={(e) => setOpenSearchTabQueryInput(e.target.value)}
              placeholder="検索語"
              maxLength={MAX_X_RESEARCH_QUERY_LENGTH}
              disabled={
                openSearchTabStatus === "checking" ||
                confirmRenderStatus === "checking" ||
                extractPostsStatus === "checking" ||
                topPostsStatus === "checking" ||
                accountPostsStatus === "checking"
              }
              className="flex-1 min-w-[220px] bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-xs text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-amber-500 disabled:opacity-50"
            />
            <button
              type="button"
              onClick={handleOpenSearchTab}
              disabled={
                openSearchTabStatus === "checking" ||
                confirmRenderStatus === "checking" ||
                extractPostsStatus === "checking" ||
                topPostsStatus === "checking" ||
                accountPostsStatus === "checking"
              }
              className="px-3 py-2 text-xs bg-zinc-700 hover:bg-zinc-600 disabled:bg-zinc-800 disabled:text-zinc-600 text-zinc-200 rounded-lg transition-colors"
            >
              {openSearchTabStatus === "checking" ? "確認中..." : "X検索タブを開く"}
            </button>
          </div>
          {openSearchTabStatus === "success" && (
            <p className="text-xs text-green-400">
              成功（{openSearchTabReused ? "既存の専用タブを再利用" : "新規タブを作成"}）
            </p>
          )}
          {openSearchTabStatus === "error" && (
            <p className="text-xs text-red-400">{openSearchTabMessage}</p>
          )}
        </div>
      )}

      {/* Gate 2A-2: 開発時のみ表示する投稿要素の表示確認（本番では非表示） */}
      {process.env.NODE_ENV !== "production" && (
        <div className="bg-zinc-800 border border-amber-700/40 rounded-xl p-4 space-y-2">
          <h3 className="text-sm font-semibold text-zinc-200">
            開発用：専用タブでの投稿要素表示確認（Gate 2A-2）
          </h3>
          <p className="text-xs text-zinc-500">
            Gate 2A-1で開いた専用タブに投稿要素が1件以上表示されたかだけを確認します。投稿本文・投稿者・反応数等は取得しません。
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handleConfirmRender}
              disabled={
                confirmRenderStatus === "checking" ||
                openSearchTabStatus === "checking" ||
                extractPostsStatus === "checking" ||
                topPostsStatus === "checking" ||
                accountPostsStatus === "checking"
              }
              className="px-3 py-2 text-xs bg-zinc-700 hover:bg-zinc-600 disabled:bg-zinc-800 disabled:text-zinc-600 text-zinc-200 rounded-lg transition-colors"
            >
              {confirmRenderStatus === "checking" ? "確認中..." : "投稿要素の表示を確認"}
            </button>
          </div>
          {confirmRenderStatus === "success" && (
            <p className="text-xs text-green-400">
              投稿要素の表示を確認しました（検出：{confirmRenderDetectedCount ?? "—"}件）
            </p>
          )}
          {confirmRenderStatus === "error" && (
            <p className="text-xs text-red-400">{confirmRenderMessage}</p>
          )}
        </div>
      )}

      {/* Gate 2B-1: 開発時のみ表示する投稿データ抽出確認（本番では非表示） */}
      {process.env.NODE_ENV !== "production" && (
        <div className="bg-zinc-800 border border-amber-700/40 rounded-xl p-4 space-y-2">
          <h3 className="text-sm font-semibold text-zinc-200">
            開発用：投稿データの抽出確認（Gate 2B-1）
          </h3>
          <p className="text-xs text-zinc-500">
            Gate 2A-1の専用タブに現在描画されている投稿データを最大10件抽出し、ここで目視確認するだけです。DB保存・API呼び出しは行いません。
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handleExtractPosts}
              disabled={
                extractPostsStatus === "checking" ||
                openSearchTabStatus === "checking" ||
                confirmRenderStatus === "checking" ||
                topPostsStatus === "checking" ||
                accountPostsStatus === "checking"
              }
              className="px-3 py-2 text-xs bg-zinc-700 hover:bg-zinc-600 disabled:bg-zinc-800 disabled:text-zinc-600 text-zinc-200 rounded-lg transition-colors"
            >
              {extractPostsStatus === "checking" ? "抽出中..." : "投稿データを抽出（最大10件）"}
            </button>
          </div>
          {extractPostsStatus === "error" && (
            <p className="text-xs text-red-400">{extractPostsMessage}</p>
          )}
          {extractPostsStatus === "success" && extractPostsResult && (
            <div className="text-xs text-zinc-300 space-y-2">
              <div className="bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 space-y-1">
                <p>
                  抽出件数: {extractPostsResult.extractedCount}件 / 最大件数: {extractPostsResult.requestedMaxPosts}件
                </p>
                <p>スキップ件数: {extractPostsResult.skippedCount}件</p>
                <p className="break-all">取得元URL: {extractPostsResult.sourceUrl}</p>
                <p>取得日時: {formatDateTimeJST(extractPostsResult.extractedAt)}</p>
              </div>

              {extractPostsResult.extractedCount === 0 && extractPostsResult.skippedCount > 0 && (
                <p className="text-amber-400">
                  投稿要素は表示されていましたが、抽出できた投稿は0件でした。スキップ理由を確認してください。
                </p>
              )}

              {extractPostsResult.posts.length > 0 && (
                <ul className="space-y-2">
                  {(extractPostsShowAll
                    ? extractPostsResult.posts
                    : extractPostsResult.posts.slice(0, EXTRACT_POSTS_INITIAL_DISPLAY_COUNT)
                  ).map((post, index) => {
                    const textPreview =
                      (post.text || "").slice(0, EXTRACT_POSTS_TEXT_PREVIEW_LENGTH) +
                      ((post.text || "").length > EXTRACT_POSTS_TEXT_PREVIEW_LENGTH || post.isTextTruncated
                        ? "…"
                        : "");
                    return (
                      <li key={post.postId || index} className="bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 space-y-1">
                        <div className="text-zinc-200">
                          {post.authorName || "(名前不明)"}
                          <span className="text-zinc-500 ml-1">@{post.authorHandle || "(不明)"}</span>
                        </div>
                        <div className="text-zinc-300 whitespace-pre-wrap break-words">
                          {textPreview || "(本文なし)"}
                          {post.isTextTruncated && (
                            <span className="ml-2 text-amber-400/80">（省略あり）</span>
                          )}
                        </div>
                        <div className="flex flex-wrap gap-x-3 gap-y-1 text-zinc-500">
                          <span>返信 {formatCount(post.replies)}</span>
                          <span>リポスト {formatCount(post.reposts)}</span>
                          <span>いいね {formatCount(post.likes)}</span>
                          <span>ブックマーク {formatCount(post.bookmarks)}</span>
                          <span>表示 {formatCount(post.views)}</span>
                          <span>投稿日時: {formatDateTimeJST(post.postedAtRaw)}</span>
                        </div>
                        <div>
                          <a
                            href={post.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-sky-400 hover:text-sky-300 break-all"
                          >
                            {post.url}
                          </a>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}

              {extractPostsResult.posts.length > EXTRACT_POSTS_INITIAL_DISPLAY_COUNT && !extractPostsShowAll && (
                <button
                  type="button"
                  onClick={() => setExtractPostsShowAll(true)}
                  className="text-xs text-sky-400 hover:text-sky-300 underline"
                >
                  残り{extractPostsResult.posts.length - EXTRACT_POSTS_INITIAL_DISPLAY_COUNT}件を表示
                </button>
              )}

              {extractPostsResult.skippedCount > 0 && (
                <details className="bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2">
                  <summary className="cursor-pointer text-zinc-400">
                    スキップ内容を表示（{extractPostsResult.skippedCount}件）
                  </summary>
                  <pre className="mt-2 text-[11px] text-zinc-500 whitespace-pre-wrap break-all">
                    {JSON.stringify(extractPostsResult.skipped, null, 2)}
                  </pre>
                </details>
              )}

              <details className="bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2">
                <summary className="cursor-pointer text-zinc-400">JSON全体を表示</summary>
                <pre className="mt-2 text-[11px] text-zinc-500 whitespace-pre-wrap break-all">
                  {JSON.stringify(extractPostsResult, null, 2)}
                </pre>
              </details>
            </div>
          )}
        </div>
      )}

      {/* Gate 2B-2A: 開発時のみ表示する話題投稿の抽出確認（本番では非表示） */}
      {process.env.NODE_ENV !== "production" &&
        (() => {
          const topSearchQuery = deriveTopSearchQuery(extractPostsResult?.sourceUrl);
          const topPostsButtonDisabled =
            topPostsStatus === "checking" ||
            openSearchTabStatus === "checking" ||
            confirmRenderStatus === "checking" ||
            extractPostsStatus === "checking" ||
            accountPostsStatus === "checking" ||
            !topSearchQuery;
          return (
            <div className="bg-zinc-800 border border-amber-700/40 rounded-xl p-4 space-y-2">
              <h3 className="text-sm font-semibold text-zinc-200">
                開発用：話題投稿の抽出確認（Gate 2B-2A）
              </h3>
              <p className="text-xs text-zinc-500">
                Gate 2B-1の最新抽出結果が使った検索語で、専用タブを「話題」の検索結果へ移動し、話題投稿を最大10件抽出します。DB保存・API呼び出しは行いません。
              </p>
              {topSearchQuery ? (
                <p className="text-xs text-zinc-400">対象検索語：{topSearchQuery}（最新抽出時）</p>
              ) : (
                <p className="text-xs text-amber-400">
                  最新の抽出結果から検索語を確認できません。もう一度、最新投稿を抽出してください。
                </p>
              )}
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={handleExtractTopPosts}
                  disabled={topPostsButtonDisabled}
                  className="px-3 py-2 text-xs bg-zinc-700 hover:bg-zinc-600 disabled:bg-zinc-800 disabled:text-zinc-600 text-zinc-200 rounded-lg transition-colors"
                >
                  {topPostsStatus === "checking" ? "抽出中..." : "話題投稿を抽出（最大10件）"}
                </button>
              </div>
              {topPostsStatus === "error" && (
                <p className="text-xs text-red-400">{topPostsMessage}</p>
              )}
              {topPostsStatus === "success" && topPostsResult && (
                <div className="text-xs text-zinc-300 space-y-2">
                  <div className="bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 space-y-1">
                    <p>対象検索語: {topPostsResult.query}</p>
                    <p>
                      抽出件数: {topPostsResult.extractedCount}件 / 最大件数: {topPostsResult.requestedMaxPosts}件
                    </p>
                    <p>スキップ件数: {topPostsResult.skippedCount}件</p>
                    <p className="break-all">取得元URL: {topPostsResult.sourceUrl}</p>
                    <p>取得日時: {formatDateTimeJST(topPostsResult.extractedAt)}</p>
                  </div>

                  {topPostsResult.extractedCount === 0 && topPostsResult.skippedCount > 0 && (
                    <p className="text-amber-400">
                      投稿要素は表示されていましたが、抽出できた話題投稿は0件でした。スキップ理由を確認してください。
                    </p>
                  )}

                  {topPostsResult.posts.length > 0 && (
                    <ul className="space-y-2">
                      {(topPostsShowAll
                        ? topPostsResult.posts
                        : topPostsResult.posts.slice(0, EXTRACT_TOP_POSTS_INITIAL_DISPLAY_COUNT)
                      ).map((post, index) => {
                        const textPreview =
                          (post.text || "").slice(0, EXTRACT_TOP_POSTS_TEXT_PREVIEW_LENGTH) +
                          ((post.text || "").length > EXTRACT_TOP_POSTS_TEXT_PREVIEW_LENGTH || post.isTextTruncated
                            ? "…"
                            : "");
                        return (
                          <li
                            key={post.postId || index}
                            className="bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 space-y-1"
                          >
                            <div className="text-zinc-200">
                              {post.authorName || "(名前不明)"}
                              <span className="text-zinc-500 ml-1">@{post.authorHandle || "(不明)"}</span>
                            </div>
                            <div className="text-zinc-300 whitespace-pre-wrap break-words">
                              {textPreview || "(本文なし)"}
                              {post.isTextTruncated && (
                                <span className="ml-2 text-amber-400/80">（省略あり）</span>
                              )}
                            </div>
                            <div className="flex flex-wrap gap-x-3 gap-y-1 text-zinc-500">
                              <span>返信 {formatCount(post.replies)}</span>
                              <span>リポスト {formatCount(post.reposts)}</span>
                              <span>いいね {formatCount(post.likes)}</span>
                              <span>ブックマーク {formatCount(post.bookmarks)}</span>
                              <span>表示 {formatCount(post.views)}</span>
                              <span>投稿日時: {formatDateTimeJST(post.postedAtRaw)}</span>
                            </div>
                            <div>
                              <a
                                href={post.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-sky-400 hover:text-sky-300 break-all"
                              >
                                {post.url}
                              </a>
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  )}

                  {topPostsResult.posts.length > EXTRACT_TOP_POSTS_INITIAL_DISPLAY_COUNT && !topPostsShowAll && (
                    <button
                      type="button"
                      onClick={() => setTopPostsShowAll(true)}
                      className="text-xs text-sky-400 hover:text-sky-300 underline"
                    >
                      残り{topPostsResult.posts.length - EXTRACT_TOP_POSTS_INITIAL_DISPLAY_COUNT}件を表示
                    </button>
                  )}

                  {topPostsResult.skippedCount > 0 && (
                    <details className="bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2">
                      <summary className="cursor-pointer text-zinc-400">
                        スキップ内容を表示（{topPostsResult.skippedCount}件）
                      </summary>
                      <pre className="mt-2 text-[11px] text-zinc-500 whitespace-pre-wrap break-all">
                        {JSON.stringify(topPostsResult.skipped, null, 2)}
                      </pre>
                    </details>
                  )}

                  <details className="bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2">
                    <summary className="cursor-pointer text-zinc-400">JSON全体を表示</summary>
                    <pre className="mt-2 text-[11px] text-zinc-500 whitespace-pre-wrap break-all">
                      {JSON.stringify(topPostsResult, null, 2)}
                    </pre>
                  </details>
                </div>
              )}
            </div>
          );
        })()}

      {/* Gate 2B-2B: 開発時のみ表示する最新／話題の重複整理（本番では非表示） */}
      {process.env.NODE_ENV !== "production" && (
        <div className="bg-zinc-800 border border-amber-700/40 rounded-xl p-4 space-y-2">
          <h3 className="text-sm font-semibold text-zinc-200">
            開発用：最新と話題の重複整理（Gate 2B-2B）
          </h3>
          <p className="text-xs text-zinc-500">
            Gate 2B-1の最新結果とGate 2B-2Aの話題結果を、postIdの完全一致だけで比較します。API送信・DB保存・AI評価は行いません。
          </p>
          {postComparison ? (
            <div className="text-xs text-zinc-300 space-y-2">
              <div className="bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 space-y-1">
                <p>最新投稿：{postComparison.latestCount}件</p>
                <p>話題投稿：{postComparison.topCount}件</p>
                <p>重複投稿：{postComparison.duplicates.length}件</p>
                <p>話題のみ：{postComparison.topOnly.length}件</p>
              </div>

              <div className="space-y-1">
                <p className="text-zinc-400">話題のみにある投稿（{postComparison.topOnly.length}件）</p>
                {postComparison.topOnly.length === 0 ? (
                  <p className="text-zinc-500">話題のみにある投稿はありません。</p>
                ) : (
                  <>
                    <ul className="space-y-2">
                      {(topOnlyShowAll
                        ? postComparison.topOnly
                        : postComparison.topOnly.slice(0, EXTRACT_TOP_POSTS_INITIAL_DISPLAY_COUNT)
                      ).map((post, index) => renderResearchPostCard(post, index))}
                    </ul>
                    {postComparison.topOnly.length > EXTRACT_TOP_POSTS_INITIAL_DISPLAY_COUNT && !topOnlyShowAll && (
                      <button
                        type="button"
                        onClick={() => setTopOnlyShowAll(true)}
                        className="text-xs text-sky-400 hover:text-sky-300 underline"
                      >
                        残り{postComparison.topOnly.length - EXTRACT_TOP_POSTS_INITIAL_DISPLAY_COUNT}件を表示
                      </button>
                    )}
                  </>
                )}
              </div>

              <details className="bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2">
                <summary className="cursor-pointer text-zinc-400">
                  最新と話題の重複投稿（{postComparison.duplicates.length}件）
                </summary>
                {postComparison.duplicates.length === 0 ? (
                  <p className="mt-2 text-zinc-500">重複投稿はありません。</p>
                ) : (
                  <ul className="mt-2 space-y-2">
                    {postComparison.duplicates.map((post, index) => renderResearchPostCard(post, index))}
                  </ul>
                )}
              </details>
            </div>
          ) : (
            <p className="text-xs text-zinc-500">
              まだ比較できません。最新投稿と話題投稿の両方を抽出すると、ここに重複整理結果が表示されます。
            </p>
          )}
        </div>
      )}

      {/* Gate 2B-3A: 開発時のみ表示する注目アカウントの投稿抽出（本番では非表示） */}
      {process.env.NODE_ENV !== "production" && (
        <div className="bg-zinc-800 border border-amber-700/40 rounded-xl p-4 space-y-2">
          <h3 className="text-sm font-semibold text-zinc-200">
            開発用：注目アカウントの投稿抽出（Gate 2B-3A）
          </h3>
          <p className="text-xs text-zinc-500">
            専用タブを指定した1件のXアカウントのプロフィールへ移動し、投稿データを最大10件抽出します。プロフィールURLではなくユーザー名を入力してください。DB保存・API呼び出しは行いません。
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="text"
              value={accountUsernameInput}
              onChange={(e) => setAccountUsernameInput(e.target.value)}
              placeholder="例: OpenAI または @OpenAI"
              maxLength={64}
              disabled={
                accountPostsStatus === "checking" ||
                openSearchTabStatus === "checking" ||
                confirmRenderStatus === "checking" ||
                extractPostsStatus === "checking" ||
                topPostsStatus === "checking"
              }
              className="flex-1 min-w-[220px] bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-xs text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-amber-500 disabled:opacity-50"
            />
            <button
              type="button"
              onClick={handleExtractAccountPosts}
              disabled={
                accountPostsStatus === "checking" ||
                openSearchTabStatus === "checking" ||
                confirmRenderStatus === "checking" ||
                extractPostsStatus === "checking" ||
                topPostsStatus === "checking"
              }
              className="px-3 py-2 text-xs bg-zinc-700 hover:bg-zinc-600 disabled:bg-zinc-800 disabled:text-zinc-600 text-zinc-200 rounded-lg transition-colors"
            >
              {accountPostsStatus === "checking" ? "抽出中..." : "アカウントの投稿を抽出（最大10件）"}
            </button>
          </div>
          {accountPostsStatus === "error" && (
            <p className="text-xs text-red-400">{accountPostsMessage}</p>
          )}
          {/* accountPostsStatusではなくaccountPostsResultの有無だけで表示するかを
              決める — 失敗時もaccountPostsResultは保持されるため、直前の成功結果
              とその後のエラーメッセージを両立して表示できる。 */}
          {accountPostsResult && (
            <div className="text-xs text-zinc-300 space-y-2">
              <p className="text-amber-400/90">
                現段階では、プロフィール上のリポスト・返信・引用投稿・固定投稿を除外しません。リポスト等では、表示される投稿者が入力したアカウントと異なる場合があります。
              </p>
              <div className="bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 space-y-1">
                <p>対象アカウント: @{accountPostsResult.username}</p>
                <p>
                  抽出件数: {accountPostsResult.extractedCount}件 / 最大件数: {accountPostsResult.requestedMaxPosts}件
                </p>
                <p>スキップ件数: {accountPostsResult.skippedCount}件</p>
                <p className="break-all">取得元URL: {accountPostsResult.sourceUrl}</p>
                <p>取得日時: {formatDateTimeJST(accountPostsResult.extractedAt)}</p>
              </div>

              {accountPostsResult.extractedCount === 0 && accountPostsResult.skippedCount > 0 && (
                <p className="text-amber-400">
                  投稿要素は表示されていましたが、抽出できた投稿は0件でした。スキップ理由を確認してください。
                </p>
              )}

              {accountPostsResult.posts.length > 0 && (
                <ul className="space-y-2">
                  {(accountPostsShowAll
                    ? accountPostsResult.posts
                    : accountPostsResult.posts.slice(0, EXTRACT_ACCOUNT_POSTS_INITIAL_DISPLAY_COUNT)
                  ).map((post, index) => renderResearchPostCard(post, index))}
                </ul>
              )}

              {accountPostsResult.posts.length > EXTRACT_ACCOUNT_POSTS_INITIAL_DISPLAY_COUNT &&
                !accountPostsShowAll && (
                  <button
                    type="button"
                    onClick={() => setAccountPostsShowAll(true)}
                    className="text-xs text-sky-400 hover:text-sky-300 underline"
                  >
                    残り{accountPostsResult.posts.length - EXTRACT_ACCOUNT_POSTS_INITIAL_DISPLAY_COUNT}件を表示
                  </button>
                )}

              {accountPostsResult.skippedCount > 0 && (
                <details className="bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2">
                  <summary className="cursor-pointer text-zinc-400">
                    スキップ内容を表示（{accountPostsResult.skippedCount}件）
                  </summary>
                  <pre className="mt-2 text-[11px] text-zinc-500 whitespace-pre-wrap break-all">
                    {JSON.stringify(accountPostsResult.skipped, null, 2)}
                  </pre>
                </details>
              )}

              <details className="bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2">
                <summary className="cursor-pointer text-zinc-400">JSON全体を表示</summary>
                <pre className="mt-2 text-[11px] text-zinc-500 whitespace-pre-wrap break-all">
                  {JSON.stringify(accountPostsResult, null, 2)}
                </pre>
              </details>
            </div>
          )}
        </div>
      )}

      {/* JSONインポート */}
      <div className="bg-zinc-800 border border-zinc-700 rounded-xl p-4 space-y-3">
        <h3 className="text-sm font-semibold text-zinc-200">Chrome拡張のJSONをインポート</h3>
        <p className="text-xs text-zinc-500">
          Chrome拡張（research/x-research-extension/）でダウンロードしたJSONファイルを選択してください。
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={importing}
            className="px-3 py-2 text-xs bg-zinc-700 hover:bg-zinc-600 disabled:bg-zinc-800 disabled:text-zinc-600 text-zinc-200 rounded-lg transition-colors"
          >
            JSONファイルを選択
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".json,application/json"
            className="hidden"
            onChange={handleFileChange}
          />
          {selectedFileName && (
            <span className="text-xs text-zinc-400">
              {selectedFileName}（{parsedItems?.length ?? 0}件）
            </span>
          )}
        </div>
        {fileError && <p className="text-xs text-red-400">{fileError}</p>}

        <div className="flex flex-wrap items-center gap-2">
          <input
            type="text"
            value={searchQueryInput}
            onChange={(e) => setSearchQueryInput(e.target.value)}
            placeholder="今回の取得に使った検索語（任意）"
            maxLength={500}
            className="flex-1 min-w-[220px] bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-xs text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-amber-500"
          />
          <button
            type="button"
            onClick={handleImport}
            disabled={!parsedItems || importing}
            className="px-4 py-2 text-xs font-semibold bg-amber-500 hover:bg-amber-400 disabled:bg-zinc-700 disabled:text-zinc-500 text-black rounded-lg transition-colors"
          >
            {importing ? "インポート中..." : "インポート"}
          </button>
        </div>

        {importError && (
          <p className="text-xs text-red-400 bg-red-900/20 border border-red-700/30 rounded-lg px-3 py-2">
            {importError}
          </p>
        )}

        {importResult && (
          <div className="text-xs text-zinc-300 bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 space-y-1">
            <p className="text-green-400 font-medium">インポートが完了しました</p>
            <p>入力件数: {importResult.totalInput}件</p>
            <p>新規投稿: {importResult.newPosts}件 / 既存投稿の更新: {importResult.updatedPosts}件</p>
            <p>新規アカウント関連: {importResult.newRelations}件 / 既存アカウント関連: {importResult.existingRelations}件</p>
            <p>スキップ: {importResult.skipped.length}件 / 失敗: {importResult.failed.length}件</p>
            {importResult.skipped.length > 0 && (
              <div className="pt-1">
                <p className="text-zinc-400">スキップした投稿:</p>
                <ul className="list-disc list-inside text-zinc-500">
                  {importResult.skipped.map((s) => (
                    <li key={s.index}>
                      #{s.index}{s.postId ? `（postId: ${s.postId}）` : ""}: {s.reason}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {importResult.failed.length > 0 && (
              <div className="pt-1">
                <p className="text-zinc-400">失敗した投稿:</p>
                <ul className="list-disc list-inside text-zinc-500">
                  {importResult.failed.map((f) => (
                    <li key={f.index}>
                      #{f.index}{f.postId ? `（postId: ${f.postId}）` : ""}: {f.reason}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>

      {/* 一覧 */}
      {loading && (
        <div className="bg-zinc-800 rounded-xl p-8 text-center text-sm text-zinc-500">
          読み込み中...
        </div>
      )}

      {!loading && loadError && (
        <div className="bg-red-900/20 border border-red-700/30 rounded-xl p-4 text-sm text-red-400">
          {loadError}
        </div>
      )}

      {!loading && !loadError && items.length === 0 && (
        <div className="bg-zinc-800 rounded-xl p-8 text-center space-y-2">
          <p className="text-sm text-zinc-400">まだリサーチ投稿がありません</p>
          <p className="text-xs text-zinc-600">Chrome拡張で取得したJSONをインポートしてください</p>
        </div>
      )}

      {!loading && !loadError && items.length > 0 && (
        <div className="space-y-3">
          {items.map((item) => {
            const card = cardStates[item.relationId];
            const displayName =
              item.authorName && item.authorName.trim() ? item.authorName : `@${item.authorHandle}`;
            const showHandleSeparately = !!(item.authorName && item.authorName.trim());
            const bodyText = item.text && item.text.trim() ? item.text : "本文を取得できませんでした";

            return (
              <div key={item.relationId} className="bg-zinc-800 border border-zinc-700 rounded-xl p-4 space-y-3">
                {/* ヘッダー */}
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-zinc-200 truncate">{displayName}</div>
                    {showHandleSeparately && (
                      <div className="text-xs text-zinc-500">@{item.authorHandle}</div>
                    )}
                  </div>
                  <div className="text-xs text-zinc-500 shrink-0 text-right">
                    <div>投稿日時: {formatDateTimeJST(item.postedAt)}</div>
                    <div>取得日時: {formatDateTimeJST(item.capturedAt)}</div>
                  </div>
                </div>

                {/* 本文 */}
                <div className="text-sm text-zinc-300 whitespace-pre-wrap break-words">
                  {bodyText}
                  {item.isTextTruncated && (
                    <span className="ml-2 text-xs text-amber-400/80 align-middle">（省略あり）</span>
                  )}
                </div>

                {/* 反応数 */}
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-400">
                  <span>返信 {formatCount(item.replies)}</span>
                  <span>リポスト {formatCount(item.reposts)}</span>
                  <span>いいね {formatCount(item.likes)}</span>
                  <span>ブックマーク {formatCount(item.bookmarks)}</span>
                  <span>表示 {formatCount(item.views)}</span>
                  <span>ブックマーク率 {formatBookmarkRate(item.bookmarks, item.views)}</span>
                </div>

                <div className="text-xs">
                  <a
                    href={item.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sky-400 hover:text-sky-300 break-all"
                  >
                    {item.url}
                  </a>
                </div>

                {/* 編集フォーム */}
                {card && (
                  <div className="border-t border-zinc-700/60 pt-3 space-y-2">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      <div>
                        <label className="block text-xs text-zinc-500 mb-1">保存理由</label>
                        <input
                          type="text"
                          value={card.savedReason}
                          onChange={(e) => updateCardField(item.relationId, "savedReason", e.target.value)}
                          maxLength={5000}
                          className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-xs text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-amber-500"
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-zinc-500 mb-1">検索語</label>
                        <input
                          type="text"
                          value={card.searchQuery}
                          onChange={(e) => updateCardField(item.relationId, "searchQuery", e.target.value)}
                          maxLength={500}
                          className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-xs text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-amber-500"
                        />
                      </div>
                    </div>
                    <div>
                      <label className="block text-xs text-zinc-500 mb-1">メモ</label>
                      <textarea
                        value={card.memo}
                        onChange={(e) => updateCardField(item.relationId, "memo", e.target.value)}
                        maxLength={5000}
                        rows={2}
                        className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-xs text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-amber-500 resize-y"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-zinc-500 mb-1">
                        タグ（カンマ・読点・改行で区切り）
                      </label>
                      <input
                        type="text"
                        value={card.tagsInput}
                        onChange={(e) => updateCardField(item.relationId, "tagsInput", e.target.value)}
                        placeholder="AI, note, リサーチ"
                        className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-xs text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-amber-500"
                      />
                    </div>

                    <div className="flex items-center gap-3 pt-1">
                      <button
                        type="button"
                        onClick={() => handleSaveCard(item.relationId)}
                        disabled={card.saveStatus === "saving"}
                        className="px-3 py-1.5 text-xs font-semibold bg-amber-500 hover:bg-amber-400 disabled:bg-zinc-700 disabled:text-zinc-500 text-black rounded-lg transition-colors"
                      >
                        {card.saveStatus === "saving" ? "保存中..." : "保存"}
                      </button>
                      {card.saveStatus === "success" && (
                        <span className="text-xs text-green-400">保存しました</span>
                      )}
                      {card.saveStatus === "error" && (
                        <span className="text-xs text-red-400">{card.saveError ?? "保存に失敗しました"}</span>
                      )}

                      <span className="flex-1" />

                      <button
                        type="button"
                        onClick={() => handleDeleteCard(item.relationId)}
                        disabled={card.deleteStatus === "deleting"}
                        title="現在のnoteアカウントとの関連だけを削除します（X投稿そのものは削除されません）"
                        className="px-3 py-1.5 text-xs border border-red-800/50 text-red-400 hover:bg-red-900/20 disabled:opacity-50 rounded-lg transition-colors"
                      >
                        {card.deleteStatus === "deleting" ? "削除中..." : "このアカウントから削除"}
                      </button>
                    </div>
                    {card.deleteStatus === "error" && (
                      <p className="text-xs text-red-400">{card.deleteError ?? "削除に失敗しました"}</p>
                    )}
                  </div>
                )}
              </div>
            );
          })}

          {hasMore && (
            <div className="text-center pt-2">
              <button
                type="button"
                onClick={handleLoadMore}
                disabled={loadingMore}
                className="px-4 py-2 text-xs bg-zinc-700 hover:bg-zinc-600 disabled:bg-zinc-800 disabled:text-zinc-600 text-zinc-200 rounded-lg transition-colors"
              >
                {loadingMore ? "読み込み中..." : "もっと見る"}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
