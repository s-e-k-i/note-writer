"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { ResearchPostListItem } from "@/lib/types";

interface TabResearchProps {
  noteAccountId: string;
}

const PAGE_SIZE = 50;
const MAX_IMPORT_ITEMS = 50;
const MAX_IMPORT_BYTES = 2 * 1024 * 1024; // 2MB
const MAX_TAGS = 20;
const MAX_TAG_LEN = 100;

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
