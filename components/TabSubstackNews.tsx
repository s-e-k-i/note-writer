"use client";

import { useState, useEffect, useCallback } from "react";
import {
  SubstackNewsItem, SubstackSources,
  SubstackYouTubeSource, SubstackXSource, SubstackRSSSource,
} from "@/lib/types";

interface Props {
  onUseItem: (memo: string) => void;
}

type Section = "items" | "sources" | "discover";
type StatusFilter = "all" | "unread" | "use" | "skip";
type TypeFilter = "all" | "youtube" | "x" | "rss";

interface YoutubeItem { name: string; channelId: string; description: string }
interface XItem { username: string; description: string }
interface RssItem { name: string; url: string; description: string }

interface DiscoverResult {
  youtube: { overseas: YoutubeItem[]; japan: YoutubeItem[] };
  x: { overseas: XItem[]; japan: XItem[] };
  rss: { overseas: RssItem[]; japan: RssItem[] };
}

const TYPE_BADGE: Record<string, string> = {
  youtube: "bg-red-900/60 text-red-300 border border-red-700/50",
  x: "bg-zinc-700 text-zinc-200 border border-zinc-600",
  rss: "bg-blue-900/60 text-blue-300 border border-blue-700/50",
  manual: "bg-amber-900/50 text-amber-300 border border-amber-700/50",
};

const TYPE_LABEL: Record<string, string> = { youtube: "YouTube", x: "X", rss: "RSS", manual: "手動" };

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export default function TabSubstackNews({ onUseItem }: Props) {
  const [section, setSection] = useState<Section>("items");

  // ── ネタ一覧 state ─────────────────────────────────
  const [items, setItems] = useState<SubstackNewsItem[]>([]);
  const [lastCollected, setLastCollected] = useState<string | null>(null);
  const [itemsLoaded, setItemsLoaded] = useState(false);
  const [collecting, setCollecting] = useState(false);
  const [collectMsg, setCollectMsg] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("unread");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");

  // ── ソース管理 state ───────────────────────────────
  const [sources, setSources] = useState<SubstackSources>({ youtube: [], x: [], rss: [] });
  const [sourcesLoaded, setSourcesLoaded] = useState(false);
  const [ytName, setYtName] = useState("");
  const [ytChannelId, setYtChannelId] = useState("");
  const [xUsername, setXUsername] = useState("");
  const [rssName, setRssName] = useState("");
  const [rssUrl, setRssUrl] = useState("");
  const [sourceMsg, setSourceMsg] = useState<string | null>(null);

  // ── おすすめ発見 state ─────────────────────────────
  const [discoverQuery, setDiscoverQuery] = useState("");
  const [discovering, setDiscovering] = useState(false);
  const [discoverResult, setDiscoverResult] = useState<DiscoverResult | null>(null);
  const [discoverError, setDiscoverError] = useState<string | null>(null);

  // ── URLから追加 state ──────────────────────────────
  const [addUrlInput, setAddUrlInput] = useState("");
  const [addingUrl, setAddingUrl] = useState(false);
  const [addUrlMsg, setAddUrlMsg] = useState<string | null>(null);

  // ── 初期ロード ────────────────────────────────────
  const loadItems = useCallback(async () => {
    try {
      const res = await fetch("/api/substack-news");
      const data = await res.json();
      setItems(data.items ?? []);
      setLastCollected(data.lastCollected);
    } catch {}
    setItemsLoaded(true);
  }, []);

  useEffect(() => { loadItems(); }, [loadItems]);

  useEffect(() => {
    if (section === "sources" && !sourcesLoaded) {
      fetch("/api/substack-sources")
        .then((r) => r.json())
        .then((d) => setSources(d))
        .catch(() => {})
        .finally(() => setSourcesLoaded(true));
    }
  }, [section, sourcesLoaded]);

  // ── 収集 ──────────────────────────────────────────
  const handleCollect = async () => {
    setCollecting(true);
    setCollectMsg(null);
    try {
      const res = await fetch("/api/collect-substack-news", { method: "POST" });
      const data = await res.json();
      if (data.ok) {
        setCollectMsg(`${data.newCount}件収集しました（合計 ${data.totalCount}件）`);
        await loadItems();
      } else {
        setCollectMsg(data.error ?? "エラーが発生しました");
      }
    } catch {
      setCollectMsg("収集に失敗しました");
    } finally {
      setCollecting(false);
      setTimeout(() => setCollectMsg(null), 5000);
    }
  };

  // ── URLから追加 ───────────────────────────────────
  const handleAddUrl = async () => {
    if (!addUrlInput.trim() || addingUrl) return;
    setAddingUrl(true);
    setAddUrlMsg(null);
    try {
      const res = await fetch("/api/add-url-item", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: addUrlInput.trim() }),
      });
      const data = await res.json();
      if (data.ok) {
        setItems((prev) => [data.item, ...prev]);
        setAddUrlInput("");
        setAddUrlMsg("追加しました");
      } else {
        setAddUrlMsg(data.error ?? "エラーが発生しました");
      }
    } catch {
      setAddUrlMsg("追加に失敗しました");
    } finally {
      setAddingUrl(false);
      setTimeout(() => setAddUrlMsg(null), 4000);
    }
  };

  // ── ステータス更新 ────────────────────────────────
  const updateStatus = async (id: string, status: "use" | "skip" | "unread") => {
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, status } : i)));
    await fetch("/api/substack-news", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, status }),
    });
  };

  // ── ソース追加・削除 ──────────────────────────────
  const addSource = async (type: "youtube" | "x" | "rss", item: SubstackYouTubeSource | SubstackXSource | SubstackRSSSource) => {
    try {
      const res = await fetch("/api/substack-sources", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type, item }),
      });
      const data = await res.json();
      setSources(data);
      setSourceMsg("追加しました");
      setTimeout(() => setSourceMsg(null), 2000);
    } catch {
      setSourceMsg("追加に失敗しました");
    }
  };

  const deleteSource = async (type: "youtube" | "x" | "rss", id: string) => {
    if (!confirm("このソースを削除しますか？")) return;
    try {
      const res = await fetch("/api/substack-sources", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type, id }),
      });
      const data = await res.json();
      setSources(data);
    } catch {}
  };

  const handleAddYouTube = () => {
    if (!ytName.trim() || !ytChannelId.trim()) return;
    const channelId = ytChannelId.trim().replace(/.*\/channel\//, "").replace(/^@/, "").trim();
    addSource("youtube", { id: `yt_${Date.now()}`, name: ytName.trim(), channelId });
    setYtName("");
    setYtChannelId("");
  };

  const handleAddX = () => {
    if (!xUsername.trim()) return;
    addSource("x", { id: `x_${Date.now()}`, username: xUsername.trim().replace(/^@/, "") });
    setXUsername("");
  };

  const handleAddRss = () => {
    if (!rssUrl.trim()) return;
    addSource("rss", { id: `rss_${Date.now()}`, name: rssName.trim() || rssUrl.trim(), url: rssUrl.trim() });
    setRssName("");
    setRssUrl("");
  };

  // ── おすすめ発見 ──────────────────────────────────
  const handleDiscover = async () => {
    if (!discoverQuery.trim() || discovering) return;
    setDiscovering(true);
    setDiscoverResult(null);
    setDiscoverError(null);
    try {
      const res = await fetch("/api/substack-discover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: discoverQuery }),
      });
      const data = await res.json();
      if (data.error) setDiscoverError(data.error);
      else setDiscoverResult(data);
    } catch {
      setDiscoverError("検索に失敗しました");
    } finally {
      setDiscovering(false);
    }
  };

  // ── フィルタリング ────────────────────────────────
  const filtered = items.filter((item) => {
    if (statusFilter !== "all" && item.status !== statusFilter) return false;
    if (typeFilter !== "all" && item.sourceType?.toLowerCase() !== typeFilter) return false;
    return true;
  });

  const SECTIONS: { key: Section; label: string }[] = [
    { key: "items", label: "ネタ一覧" },
    { key: "sources", label: "ソース管理" },
    { key: "discover", label: "おすすめ発見" },
  ];

  return (
    <div className="space-y-4">
      {/* セクションタブ */}
      <div className="flex gap-1 bg-zinc-800/60 rounded-lg p-1">
        {SECTIONS.map((s) => (
          <button
            key={s.key}
            onClick={() => setSection(s.key)}
            className={`flex-1 text-xs py-1.5 rounded-md font-medium transition-colors ${
              section === s.key ? "bg-zinc-600 text-white" : "text-zinc-500 hover:text-zinc-300"
            }`}
          >
            {s.label}
          </button>
        ))}
      </div>

      {/* ━━━━━━━━━━━ ネタ一覧 ━━━━━━━━━━━ */}
      {section === "items" && (
        <div className="space-y-4">
          {/* 収集コントロール */}
          <div className="space-y-1.5">
            <div className="flex items-center gap-3 flex-wrap">
              <button
                onClick={handleCollect}
                disabled={collecting}
                className="px-3 py-1.5 text-xs bg-zinc-700 hover:bg-zinc-600 disabled:bg-zinc-800 disabled:text-zinc-500 text-zinc-200 rounded-lg transition-colors"
              >
                {collecting ? "収集中..." : "今すぐ収集"}
              </button>
              {lastCollected && !collecting && (
                <span className="text-xs text-zinc-600">
                  最終収集：{formatDateTime(lastCollected)}
                </span>
              )}
              {collectMsg && (
                <span className={`text-xs ${collectMsg.includes("失敗") || collectMsg.includes("エラー") ? "text-red-400" : "text-green-400"}`}>
                  {collectMsg}
                </span>
              )}
            </div>
            <p className="text-xs text-zinc-600">登録済みの YouTube・X・RSS ソースから一括取得します</p>
          </div>

          {/* URLから個別追加 */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <div className="flex-1 border-t border-zinc-700/60" />
              <span className="text-xs text-zinc-600 shrink-0">または URL から個別追加</span>
              <div className="flex-1 border-t border-zinc-700/60" />
            </div>
            <div className="flex gap-2 items-center">
              <input
                value={addUrlInput}
                onChange={(e) => setAddUrlInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleAddUrl()}
                placeholder="URL を貼り付けて追加（X 投稿・ブログ記事など）"
                className="flex-1 bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-xs text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-amber-500"
              />
              <button
                onClick={handleAddUrl}
                disabled={!addUrlInput.trim() || addingUrl}
                className="px-3 py-2 text-xs bg-zinc-700 hover:bg-zinc-600 disabled:bg-zinc-800 disabled:text-zinc-500 text-zinc-200 rounded-lg transition-colors shrink-0"
              >
                {addingUrl ? "処理中..." : "追加"}
              </button>
            </div>
            {addUrlMsg && (
              <p className={`text-xs ${addUrlMsg.includes("失敗") || addUrlMsg.includes("エラー") ? "text-red-400" : "text-green-400"}`}>
                {addUrlMsg}
              </p>
            )}
          </div>

          {/* フィルター */}
          <div className="space-y-2">
            <div className="flex gap-1 flex-wrap">
              {(["all", "unread", "use", "skip"] as StatusFilter[]).map((f) => (
                <button
                  key={f}
                  onClick={() => setStatusFilter(f)}
                  className={`text-xs px-2.5 py-1 rounded-lg border transition-colors ${
                    statusFilter === f
                      ? "border-zinc-500 bg-zinc-600 text-white"
                      : "border-zinc-700 text-zinc-500 hover:text-zinc-300 hover:border-zinc-600"
                  }`}
                >
                  {f === "all" ? "すべて" : f === "unread" ? "未確認" : f === "use" ? "使う" : "スキップ"}
                  {f === "unread" && ` (${items.filter((i) => i.status === "unread").length})`}
                </button>
              ))}
              <span className="mx-1 border-l border-zinc-700" />
              {(["all", "youtube", "x", "rss"] as TypeFilter[]).map((f) => (
                <button
                  key={f}
                  onClick={() => setTypeFilter(f)}
                  className={`text-xs px-2.5 py-1 rounded-lg border transition-colors ${
                    typeFilter === f
                      ? "border-zinc-500 bg-zinc-600 text-white"
                      : "border-zinc-700 text-zinc-500 hover:text-zinc-300 hover:border-zinc-600"
                  }`}
                >
                  {f === "all" ? "すべて" : TYPE_LABEL[f]}
                </button>
              ))}
            </div>
          </div>

          {/* カード一覧 */}
          {!itemsLoaded ? (
            <div className="text-zinc-500 text-sm flex items-center gap-2">
              <span className="inline-block w-1 h-4 bg-amber-400 animate-pulse" />読み込み中...
            </div>
          ) : filtered.length === 0 ? (
            <div className="bg-zinc-800 rounded-xl p-8 text-center space-y-2">
              <p className="text-zinc-400 text-sm">
                {items.length === 0
                  ? "まだネタが収集されていません。「今すぐ収集」を押してください。"
                  : "このフィルターに一致するネタはありません"}
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {filtered.map((item) => (
                <div
                  key={item.id}
                  className={`bg-zinc-800 border rounded-xl p-4 space-y-2.5 transition-opacity ${
                    item.status === "skip" ? "opacity-40" : "border-zinc-700"
                  } ${item.status === "use" ? "border-green-700/50" : "border-zinc-700"}`}
                >
                  {/* ヘッダー行 */}
                  <div className="flex items-start gap-2 flex-wrap">
                    <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium ${TYPE_BADGE[item.sourceType] ?? TYPE_BADGE.manual}`}>
                      {TYPE_LABEL[item.sourceType] ?? "手動"}
                    </span>
                    <span className="text-xs text-zinc-400">{item.sourceName}</span>
                    <span className="ml-auto text-xs text-zinc-600">{formatDateTime(item.collectedAt)}</span>
                  </div>

                  {/* タイトル */}
                  <a
                    href={item.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block text-sm font-medium text-zinc-100 hover:text-amber-300 leading-snug transition-colors"
                  >
                    {item.title}
                  </a>

                  {/* AI要約 */}
                  {item.summary && (
                    <p className="text-xs text-zinc-400 leading-relaxed border-l-2 border-zinc-600 pl-2">
                      {item.summary}
                    </p>
                  )}

                  {/* アイデアの種 */}
                  {item.ideaSeed && (
                    <div className="bg-amber-900/20 border border-amber-700/30 rounded-lg px-3 py-2">
                      <p className="text-xs text-amber-300 leading-relaxed">
                        💡 {item.ideaSeed}
                      </p>
                    </div>
                  )}

                  {/* アクション */}
                  <div className="flex items-center gap-2 pt-0.5">
                    <button
                      onClick={() => {
                        updateStatus(item.id, "use");
                        const memo = `【ネタ元】${item.sourceName}\n${item.summary}\n\n【種】${item.ideaSeed}`;
                        onUseItem(memo);
                      }}
                      className="px-3 py-1.5 bg-green-700/80 hover:bg-green-600 text-white text-xs font-medium rounded-lg transition-colors"
                    >
                      使う
                    </button>
                    {item.status !== "skip" ? (
                      <button
                        onClick={() => updateStatus(item.id, "skip")}
                        className="px-3 py-1.5 bg-zinc-700 hover:bg-zinc-600 text-zinc-400 text-xs rounded-lg transition-colors"
                      >
                        スキップ
                      </button>
                    ) : (
                      <button
                        onClick={() => updateStatus(item.id, "unread")}
                        className="px-3 py-1.5 border border-zinc-600 text-zinc-500 hover:text-zinc-300 text-xs rounded-lg transition-colors"
                      >
                        戻す
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ━━━━━━━━━━━ ソース管理 ━━━━━━━━━━━ */}
      {section === "sources" && (
        <div className="space-y-6">
          {sourceMsg && (
            <div className="text-xs text-green-400 bg-green-900/20 border border-green-700/30 rounded-lg px-3 py-2">
              {sourceMsg}
            </div>
          )}

          {/* YouTube */}
          <div className="space-y-3">
            <h4 className="text-sm font-semibold text-zinc-200">YouTubeチャンネル</h4>
            <div className="flex gap-2">
              <input
                value={ytName}
                onChange={(e) => setYtName(e.target.value)}
                placeholder="チャンネル名"
                className="w-36 bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-xs text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-amber-500"
              />
              <input
                value={ytChannelId}
                onChange={(e) => setYtChannelId(e.target.value)}
                placeholder="チャンネルID（UCで始まる）またはURL"
                className="flex-1 bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-xs text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-amber-500"
              />
              <button
                onClick={handleAddYouTube}
                disabled={!ytName.trim() || !ytChannelId.trim()}
                className="px-3 py-2 text-xs bg-zinc-700 hover:bg-zinc-600 disabled:bg-zinc-800 disabled:text-zinc-600 text-zinc-200 rounded-lg transition-colors"
              >
                追加
              </button>
            </div>
            <div className="space-y-1">
              {!sourcesLoaded ? (
                <p className="text-xs text-zinc-600">読み込み中...</p>
              ) : sources.youtube.length === 0 ? (
                <p className="text-xs text-zinc-600">登録済みチャンネルなし</p>
              ) : (
                sources.youtube.map((ch) => (
                  <div key={ch.id} className="flex items-center justify-between bg-zinc-800 rounded-lg px-3 py-2">
                    <div>
                      <span className="text-xs text-zinc-200">{ch.name}</span>
                      <span className="text-xs text-zinc-600 ml-2">{ch.channelId}</span>
                    </div>
                    <button
                      onClick={() => deleteSource("youtube", ch.id)}
                      className="text-xs text-zinc-600 hover:text-red-400 transition-colors"
                    >
                      削除
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* X */}
          <div className="space-y-3">
            <h4 className="text-sm font-semibold text-zinc-200">Xアカウント</h4>
            <p className="text-xs text-red-400/80 bg-red-900/10 border border-red-800/20 rounded-lg px-3 py-2">
              ⚠️ 現在、Nitter（X RSSプロキシ）が全インスタンス停止中のため、Xからの収集は機能しません。登録はできますが取得はスキップされます。
            </p>
            <div className="flex gap-2">
              <input
                value={xUsername}
                onChange={(e) => setXUsername(e.target.value)}
                placeholder="ユーザー名（@なし）"
                className="flex-1 bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-xs text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-amber-500"
              />
              <button
                onClick={handleAddX}
                disabled={!xUsername.trim()}
                className="px-3 py-2 text-xs bg-zinc-700 hover:bg-zinc-600 disabled:bg-zinc-800 disabled:text-zinc-600 text-zinc-200 rounded-lg transition-colors"
              >
                追加
              </button>
            </div>
            <div className="space-y-1">
              {sources.x.length === 0 ? (
                <p className="text-xs text-zinc-600">登録済みアカウントなし</p>
              ) : (
                sources.x.map((acc) => (
                  <div key={acc.id} className="flex items-center justify-between bg-zinc-800 rounded-lg px-3 py-2">
                    <span className="text-xs text-zinc-200">@{acc.username}</span>
                    <button
                      onClick={() => deleteSource("x", acc.id)}
                      className="text-xs text-zinc-600 hover:text-red-400 transition-colors"
                    >
                      削除
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* RSS */}
          <div className="space-y-3">
            <h4 className="text-sm font-semibold text-zinc-200">RSSフィード</h4>
            <div className="space-y-2">
              <div className="flex gap-2">
                <input
                  value={rssName}
                  onChange={(e) => setRssName(e.target.value)}
                  placeholder="フィード名（任意）"
                  className="w-40 bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-xs text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-amber-500"
                />
                <input
                  value={rssUrl}
                  onChange={(e) => setRssUrl(e.target.value)}
                  placeholder="RSS URL"
                  className="flex-1 bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-xs text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-amber-500"
                />
                <button
                  onClick={handleAddRss}
                  disabled={!rssUrl.trim()}
                  className="px-3 py-2 text-xs bg-zinc-700 hover:bg-zinc-600 disabled:bg-zinc-800 disabled:text-zinc-600 text-zinc-200 rounded-lg transition-colors"
                >
                  追加
                </button>
              </div>
            </div>
            <div className="space-y-1">
              {sources.rss.length === 0 ? (
                <p className="text-xs text-zinc-600">登録済みフィードなし</p>
              ) : (
                sources.rss.map((feed) => (
                  <div key={feed.id} className="flex items-center justify-between bg-zinc-800 rounded-lg px-3 py-2">
                    <div className="flex-1 min-w-0">
                      <span className="text-xs text-zinc-200">{feed.name}</span>
                      <p className="text-xs text-zinc-600 truncate">{feed.url}</p>
                    </div>
                    <button
                      onClick={() => deleteSource("rss", feed.id)}
                      className="ml-3 text-xs text-zinc-600 hover:text-red-400 transition-colors shrink-0"
                    >
                      削除
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* ━━━━━━━━━━━ おすすめ発見 ━━━━━━━━━━━ */}
      {section === "discover" && (
        <div className="space-y-4">
          <div className="space-y-2">
            <label className="text-xs text-zinc-400 block">
              キーワードを入力してください
            </label>
            <div className="flex gap-2">
              <input
                value={discoverQuery}
                onChange={(e) => setDiscoverQuery(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && !e.nativeEvent.isComposing && handleDiscover()}
                placeholder="例：Claude Code 実践　solopreneur AI"
                className="flex-1 bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-amber-500"
              />
              <button
                onClick={handleDiscover}
                disabled={!discoverQuery.trim() || discovering}
                className="px-4 py-2 text-sm bg-zinc-700 hover:bg-zinc-600 disabled:bg-zinc-800 disabled:text-zinc-500 text-zinc-200 rounded-lg transition-colors"
              >
                {discovering ? "検索中..." : "候補を探す"}
              </button>
            </div>
          </div>

          {discoverError && (
            <div className="text-xs text-red-400 bg-red-900/20 border border-red-800/30 rounded-lg px-3 py-2">
              {discoverError}
            </div>
          )}

          {discovering && (
            <div className="text-zinc-500 text-sm flex items-center gap-2">
              <span className="inline-block w-1 h-4 bg-amber-400 animate-pulse" />
              AIが候補を探しています...
            </div>
          )}

          {discoverResult && (
            <div className="space-y-6">

              {/* ── YouTubeチャンネル ── */}
              {(discoverResult.youtube.overseas.length > 0 || discoverResult.youtube.japan.length > 0) && (
                <div className="space-y-3">
                  <h4 className="text-sm font-semibold text-zinc-200 border-b border-zinc-700 pb-1">YouTubeチャンネル</h4>

                  {discoverResult.youtube.overseas.length > 0 && (
                    <div className="space-y-2">
                      <p className="text-xs text-zinc-500 font-medium">海外</p>
                      {discoverResult.youtube.overseas.map((ch, i) => (
                        <div key={i} className="bg-zinc-800 border border-zinc-700 rounded-xl p-3">
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium text-zinc-200">{ch.name}</p>
                              <p className="text-xs text-zinc-300 mt-0.5 leading-relaxed">{ch.description}</p>
                              {ch.channelId && <p className="text-xs text-zinc-600 mt-0.5">ID: {ch.channelId}</p>}
                            </div>
                            <div className="flex items-center gap-1.5 shrink-0">
                              <a
                                href={`https://www.youtube.com/results?search_query=${encodeURIComponent(ch.name)}`}
                                target="_blank" rel="noopener noreferrer"
                                className="text-xs px-2.5 py-1 text-zinc-500 hover:text-zinc-300 transition-colors"
                              >↗ 確認する</a>
                              <button
                                onClick={() => { addSource("youtube", { id: `yt_${Date.now()}`, name: ch.name, channelId: ch.channelId }); setSection("sources"); }}
                                className="text-xs px-2.5 py-1 bg-zinc-700 hover:bg-zinc-600 text-zinc-300 rounded-lg transition-colors"
                              >追加</button>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {discoverResult.youtube.japan.length > 0 && (
                    <div className="space-y-2">
                      <p className="text-xs text-zinc-500 font-medium">日本</p>
                      {discoverResult.youtube.japan.map((ch, i) => (
                        <div key={i} className="bg-zinc-800 border border-zinc-700 rounded-xl p-3">
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium text-zinc-200">{ch.name}</p>
                              <p className="text-xs text-zinc-300 mt-0.5 leading-relaxed">{ch.description}</p>
                              {ch.channelId && <p className="text-xs text-zinc-600 mt-0.5">ID: {ch.channelId}</p>}
                            </div>
                            <div className="flex items-center gap-1.5 shrink-0">
                              <a
                                href={`https://www.youtube.com/results?search_query=${encodeURIComponent(ch.name)}`}
                                target="_blank" rel="noopener noreferrer"
                                className="text-xs px-2.5 py-1 text-zinc-500 hover:text-zinc-300 transition-colors"
                              >↗ 確認する</a>
                              <button
                                onClick={() => { addSource("youtube", { id: `yt_${Date.now()}`, name: ch.name, channelId: ch.channelId }); setSection("sources"); }}
                                className="text-xs px-2.5 py-1 bg-zinc-700 hover:bg-zinc-600 text-zinc-300 rounded-lg transition-colors"
                              >追加</button>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* ── Xアカウント ── */}
              {(discoverResult.x.overseas.length > 0 || discoverResult.x.japan.length > 0) && (
                <div className="space-y-3">
                  <h4 className="text-sm font-semibold text-zinc-200 border-b border-zinc-700 pb-1">Xアカウント</h4>

                  {discoverResult.x.overseas.length > 0 && (
                    <div className="space-y-2">
                      <p className="text-xs text-zinc-500 font-medium">海外</p>
                      {discoverResult.x.overseas.map((acc, i) => (
                        <div key={i} className="bg-zinc-800 border border-zinc-700 rounded-xl p-3">
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium text-zinc-200">@{acc.username}</p>
                              <p className="text-xs text-zinc-300 mt-0.5 leading-relaxed">{acc.description}</p>
                            </div>
                            <div className="flex items-center gap-1.5 shrink-0">
                              <a
                                href={`https://x.com/search?q=${encodeURIComponent(acc.username)}`}
                                target="_blank" rel="noopener noreferrer"
                                className="text-xs px-2.5 py-1 text-zinc-500 hover:text-zinc-300 transition-colors"
                              >↗ 確認する</a>
                              <button
                                onClick={() => { addSource("x", { id: `x_${Date.now()}`, username: acc.username }); setSection("sources"); }}
                                className="text-xs px-2.5 py-1 bg-zinc-700 hover:bg-zinc-600 text-zinc-300 rounded-lg transition-colors"
                              >追加</button>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {discoverResult.x.japan.length > 0 && (
                    <div className="space-y-2">
                      <p className="text-xs text-zinc-500 font-medium">日本</p>
                      {discoverResult.x.japan.map((acc, i) => (
                        <div key={i} className="bg-zinc-800 border border-zinc-700 rounded-xl p-3">
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium text-zinc-200">@{acc.username}</p>
                              <p className="text-xs text-zinc-300 mt-0.5 leading-relaxed">{acc.description}</p>
                            </div>
                            <div className="flex items-center gap-1.5 shrink-0">
                              <a
                                href={`https://x.com/search?q=${encodeURIComponent(acc.username)}`}
                                target="_blank" rel="noopener noreferrer"
                                className="text-xs px-2.5 py-1 text-zinc-500 hover:text-zinc-300 transition-colors"
                              >↗ 確認する</a>
                              <button
                                onClick={() => { addSource("x", { id: `x_${Date.now()}`, username: acc.username }); setSection("sources"); }}
                                className="text-xs px-2.5 py-1 bg-zinc-700 hover:bg-zinc-600 text-zinc-300 rounded-lg transition-colors"
                              >追加</button>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* ── RSSフィード ── */}
              {(discoverResult.rss.overseas.length > 0 || discoverResult.rss.japan.length > 0) && (
                <div className="space-y-3">
                  <h4 className="text-sm font-semibold text-zinc-200 border-b border-zinc-700 pb-1">RSSフィード</h4>

                  {discoverResult.rss.overseas.length > 0 && (
                    <div className="space-y-2">
                      <p className="text-xs text-zinc-500 font-medium">海外</p>
                      {discoverResult.rss.overseas.map((feed, i) => (
                        <div key={i} className="bg-zinc-800 border border-zinc-700 rounded-xl p-3">
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium text-zinc-200">{feed.name}</p>
                              <p className="text-xs text-zinc-300 mt-0.5 leading-relaxed">{feed.description}</p>
                              <p className="text-xs text-zinc-600 truncate mt-0.5">{feed.url}</p>
                            </div>
                            <div className="flex items-center gap-1.5 shrink-0">
                              <a
                                href={feed.url}
                                target="_blank" rel="noopener noreferrer"
                                className="text-xs px-2.5 py-1 text-zinc-500 hover:text-zinc-300 transition-colors"
                              >↗ 確認する</a>
                              <button
                                onClick={() => { addSource("rss", { id: `rss_${Date.now()}`, name: feed.name, url: feed.url }); setSection("sources"); }}
                                className="text-xs px-2.5 py-1 bg-zinc-700 hover:bg-zinc-600 text-zinc-300 rounded-lg transition-colors"
                              >追加</button>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {discoverResult.rss.japan.length > 0 && (
                    <div className="space-y-2">
                      <p className="text-xs text-zinc-500 font-medium">日本</p>
                      {discoverResult.rss.japan.map((feed, i) => (
                        <div key={i} className="bg-zinc-800 border border-zinc-700 rounded-xl p-3">
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium text-zinc-200">{feed.name}</p>
                              <p className="text-xs text-zinc-300 mt-0.5 leading-relaxed">{feed.description}</p>
                              <p className="text-xs text-zinc-600 truncate mt-0.5">{feed.url}</p>
                            </div>
                            <div className="flex items-center gap-1.5 shrink-0">
                              <a
                                href={feed.url}
                                target="_blank" rel="noopener noreferrer"
                                className="text-xs px-2.5 py-1 text-zinc-500 hover:text-zinc-300 transition-colors"
                              >↗ 確認する</a>
                              <button
                                onClick={() => { addSource("rss", { id: `rss_${Date.now()}`, name: feed.name, url: feed.url }); setSection("sources"); }}
                                className="text-xs px-2.5 py-1 bg-zinc-700 hover:bg-zinc-600 text-zinc-300 rounded-lg transition-colors"
                              >追加</button>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

            </div>
          )}
        </div>
      )}
    </div>
  );
}
