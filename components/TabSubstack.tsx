"use client";

import { useState, useEffect, useCallback } from "react";
import {
  SubstackNewsItem, SubstackSources,
  SubstackYouTubeSource, SubstackXSource, SubstackRSSSource,
  BrightDataXSource,
} from "@/lib/types";

type Section = "items" | "create" | "drafts" | "sources";
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

export default function TabSubstack() {
  const [section, setSection] = useState<Section>("items");

  // ── ネタ一覧 state ─────────────────────────────────
  const [items, setItems] = useState<SubstackNewsItem[]>([]);
  const [lastCollected, setLastCollected] = useState<string | null>(null);
  const [itemsLoaded, setItemsLoaded] = useState(false);
  const [collecting, setCollecting] = useState(false);
  const [collectMsg, setCollectMsg] = useState<string | null>(null);
  const [lastNewCount, setLastNewCount] = useState<number | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("unread");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [addUrlInput, setAddUrlInput] = useState("");
  const [addingUrl, setAddingUrl] = useState(false);
  const [addUrlMsg, setAddUrlMsg] = useState<string | null>(null);

  // ── ソース管理 state ───────────────────────────────
  const [sources, setSources] = useState<SubstackSources>({ youtube: [], x: [], rss: [] });
  const [sourcesLoaded, setSourcesLoaded] = useState(false);
  const [ytName, setYtName] = useState("");
  const [ytChannelId, setYtChannelId] = useState("");
  const [xUsername, setXUsername] = useState("");
  const [rssName, setRssName] = useState("");
  const [rssUrl, setRssUrl] = useState("");
  const [sourceMsg, setSourceMsg] = useState<string | null>(null);

  // ── Bright Data state ──────────────────────────────
  const [bdAccounts, setBdAccounts] = useState<BrightDataXSource[]>([]);
  const [bdLoaded, setBdLoaded] = useState(false);
  const [bdUsername, setBdUsername] = useState("");
  const [bdTriggering, setBdTriggering] = useState(false);
  const [bdTriggerMsg, setBdTriggerMsg] = useState<string | null>(null);
  const [bdMonthly, setBdMonthly] = useState<{ month: string; requested: number; received?: number } | null>(null);

  // ── 投稿作成 state ─────────────────────────────────
  const [discoverQuery, setDiscoverQuery] = useState("");
  const [discovering, setDiscovering] = useState(false);
  const [discoverResult, setDiscoverResult] = useState<DiscoverResult | null>(null);
  const [discoverError, setDiscoverError] = useState<string | null>(null);
  // 「使う」ボタンから引き継いだメモ
  const [prefillMemo, setPrefillMemo] = useState<string | null>(null);

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

  useEffect(() => {
    loadItems();
    fetch("/api/brightdata/accounts")
      .then((r) => r.json())
      .then((d) => setBdAccounts(d.accounts ?? []))
      .catch(() => {});
  }, [loadItems]);

  useEffect(() => {
    if (section === "sources" && !sourcesLoaded) {
      fetch("/api/substack-sources")
        .then((r) => r.json())
        .then((d) => setSources(d))
        .catch(() => {})
        .finally(() => setSourcesLoaded(true));
    }
    if (section === "sources" && !bdLoaded) {
      fetch("/api/brightdata/accounts")
        .then((r) => r.json())
        .then((d) => { setBdAccounts(d.accounts ?? []); })
        .catch(() => {})
        .finally(() => setBdLoaded(true));
    }
  }, [section, sourcesLoaded, bdLoaded]);

  // ── 収集 ──────────────────────────────────────────
  const handleCollect = async () => {
    setCollecting(true);
    setCollectMsg(null);
    try {
      const res = await fetch("/api/collect-substack-news", { method: "POST" });
      const data = await res.json();
      if (data.ok) {
        setLastNewCount(data.newCount ?? 0);
        await loadItems();
      } else {
        setCollectMsg(data.error ?? "エラーが発生しました");
      }
    } catch {
      setCollectMsg("収集に失敗しました");
    } finally {
      setCollecting(false);
    }
  };

  // ── Bright Data ───────────────────────────────────
  const handleBdTrigger = async () => {
    if (bdTriggering) return;
    setBdTriggering(true);
    setBdTriggerMsg(null);
    try {
      const res = await fetch("/api/brightdata/trigger", { method: "POST" });
      const data = await res.json();
      if (data.ok) {
        setBdTriggerMsg(`収集リクエスト送信（${data.accounts}アカウント × 最大${data.estimatedRecords / data.accounts}件）。数分後にネタ一覧へ反映されます。`);
        if (data.monthlyCounter) setBdMonthly(data.monthlyCounter);
      } else {
        setBdTriggerMsg(data.error ?? data.message ?? "エラーが発生しました");
      }
    } catch {
      setBdTriggerMsg("トリガーに失敗しました");
    } finally {
      setBdTriggering(false);
      setTimeout(() => setBdTriggerMsg(null), 8000);
    }
  };

  const handleBdAddAccount = async () => {
    if (!bdUsername.trim()) return;
    try {
      const res = await fetch("/api/brightdata/accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: bdUsername.trim() }),
      });
      const data = await res.json();
      if (data.accounts) { setBdAccounts(data.accounts); setBdUsername(""); }
    } catch {}
  };

  const handleBdDeleteAccount = async (id: string) => {
    if (!confirm("このアカウントをBright Data監視対象から削除しますか？")) return;
    try {
      const res = await fetch("/api/brightdata/accounts", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      const data = await res.json();
      if (data.accounts) setBdAccounts(data.accounts);
    } catch {}
  };

  const handleBdTogglePause = async (id: string, paused: boolean) => {
    try {
      const res = await fetch("/api/brightdata/accounts", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, paused }),
      });
      const data = await res.json();
      if (res.ok) setBdAccounts(data.accounts ?? []);
    } catch {}
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

  const toggleRssPause = async (id: string, paused: boolean) => {
    try {
      const res = await fetch("/api/substack-sources", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "rss", id, paused }),
      });
      const data = await res.json();
      setSources(data);
    } catch {}
  };

  const handleAddYouTube = () => {
    if (!ytName.trim() || !ytChannelId.trim()) return;
    const channelId = ytChannelId.trim().replace(/.*\/channel\//, "").replace(/^@/, "").trim();
    addSource("youtube", { id: `yt_${Date.now()}`, name: ytName.trim(), channelId });
    setYtName(""); setYtChannelId("");
  };
  const handleAddX = () => {
    if (!xUsername.trim()) return;
    addSource("x", { id: `x_${Date.now()}`, username: xUsername.trim().replace(/^@/, "") });
    setXUsername("");
  };
  const handleAddRss = () => {
    if (!rssUrl.trim()) return;
    addSource("rss", { id: `rss_${Date.now()}`, name: rssName.trim() || rssUrl.trim(), url: rssUrl.trim() });
    setRssName(""); setRssUrl("");
  };

  // ── ソース候補を探す（投稿作成タブ） ────────────────
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
    if (typeFilter === "x") {
      // Xフィルター時はstatusによる絞り込みを無効にして全件表示
    } else if (statusFilter !== "all" && item.status !== statusFilter) {
      return false;
    }
    if (typeFilter !== "all" && item.sourceType?.toLowerCase() !== typeFilter) return false;
    return true;
  });

  const SECTIONS: { key: Section; label: string }[] = [
    { key: "items", label: "ネタ一覧" },
    { key: "create", label: "投稿作成" },
    { key: "drafts", label: "下書き" },
    { key: "sources", label: "ソース管理" },
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
                <span className="text-sm text-zinc-400">
                  最終収集：{formatDateTime(lastCollected)}
                  {lastNewCount !== null && (
                    lastNewCount === 0
                      ? <span className="text-zinc-500">（新着なし）</span>
                      : <span className="text-green-400">（{lastNewCount}件追加）</span>
                  )}
                </span>
              )}
              {collectMsg && (
                <span className="text-xs text-red-400">{collectMsg}</span>
              )}
            </div>
            <p className="text-xs text-zinc-600">登録済みの YouTube・RSS ソースから一括取得します（X は Bright Data で別途収集）</p>
          </div>

          {/* Bright Data収集 */}
          <div className="space-y-1 border-t border-zinc-700/50 pt-2">
            <div className="flex items-center gap-3 flex-wrap">
              <button
                onClick={handleBdTrigger}
                disabled={bdTriggering || bdAccounts.length === 0}
                className="px-3 py-1.5 text-xs bg-sky-800/60 hover:bg-sky-700/70 disabled:bg-zinc-800 disabled:text-zinc-500 text-sky-200 border border-sky-700/50 rounded-lg transition-colors"
              >
                {bdTriggering ? "リクエスト中..." : "Bright Data収集"}
              </button>
              {bdAccounts.length === 0 && (
                <span className="text-xs text-zinc-600">※ ソース管理でBDアカウントを登録してください</span>
              )}
              {bdMonthly && (
                <span className="text-xs text-zinc-600">
                  今月推定: {bdMonthly.requested}{bdMonthly.received !== undefined ? ` / 受信: ${bdMonthly.received}` : ""}件
                </span>
              )}
              {bdTriggerMsg && (
                <span className={`text-xs ${bdTriggerMsg.includes("失敗") || bdTriggerMsg.includes("エラー") ? "text-red-400" : "text-sky-300"}`}>
                  {bdTriggerMsg}
                </span>
              )}
            </div>
            <p className="text-xs text-zinc-600">Bright Data経由でXアカウントの投稿を収集します（毎朝6:00 JST に自動収集）</p>
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
          <div className="flex gap-1 flex-wrap">
            {(["all", "unread", "use", "skip"] as StatusFilter[]).map((f) => (
              <button
                key={f}
                onClick={() => setStatusFilter(f)}
                className={`text-xs px-2.5 py-1 rounded-lg border transition-colors ${
                  statusFilter === f ? "border-zinc-500 bg-zinc-600 text-white" : "border-zinc-700 text-zinc-500 hover:text-zinc-300 hover:border-zinc-600"
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
                  typeFilter === f ? "border-zinc-500 bg-zinc-600 text-white" : "border-zinc-700 text-zinc-500 hover:text-zinc-300 hover:border-zinc-600"
                }`}
              >
                {f === "all" ? "すべて" : TYPE_LABEL[f]}
              </button>
            ))}
          </div>

          {/* カード一覧 */}
          {!itemsLoaded ? (
            <div className="text-zinc-500 text-sm flex items-center gap-2">
              <span className="inline-block w-1 h-4 bg-amber-400 animate-pulse" />読み込み中...
            </div>
          ) : filtered.length === 0 ? (
            <div className="bg-zinc-800 rounded-xl p-8 text-center">
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
                    item.status === "skip" ? "opacity-40" : ""
                  } ${item.status === "use" ? "border-green-700/50" : "border-zinc-700"}`}
                >
                  <div className="flex items-start gap-2 flex-wrap">
                    <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium ${TYPE_BADGE[item.sourceType] ?? TYPE_BADGE.manual}`}>
                      {TYPE_LABEL[item.sourceType] ?? "手動"}
                    </span>
                    {item.id.startsWith("bd_") && (
                      <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-sky-900/60 text-sky-300 border border-sky-700/50">BD</span>
                    )}
                    <span className="text-xs text-zinc-400">{item.sourceName}</span>
                    <span className="ml-auto text-xs text-zinc-600">{formatDateTime(item.collectedAt)}</span>
                  </div>
                  <a
                    href={item.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block text-sm font-medium text-zinc-100 hover:text-amber-300 leading-snug transition-colors"
                  >
                    {item.title}
                  </a>
                  {item.summary && (
                    <p className="text-xs text-zinc-400 leading-relaxed border-l-2 border-zinc-600 pl-2">{item.summary}</p>
                  )}
                  {item.ideaSeed && (
                    <div className="bg-amber-900/20 border border-amber-700/30 rounded-lg px-3 py-2">
                      <p className="text-xs text-amber-300 leading-relaxed">💡 {item.ideaSeed}</p>
                    </div>
                  )}
                  <div className="flex items-center gap-2 pt-0.5">
                    <button
                      onClick={() => {
                        updateStatus(item.id, "use");
                        setPrefillMemo(`【ネタ元】${item.sourceName}\n${item.summary}\n\n【種】${item.ideaSeed}`);
                        setSection("create");
                      }}
                      className="px-3 py-1.5 bg-green-700/80 hover:bg-green-600 text-white text-xs font-medium rounded-lg transition-colors"
                    >
                      使う → 投稿作成へ
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

      {/* ━━━━━━━━━━━ 投稿作成 ━━━━━━━━━━━ */}
      {section === "create" && (
        <div className="space-y-4">
          {prefillMemo && (
            <div className="bg-amber-900/20 border border-amber-700/30 rounded-xl px-4 py-3 space-y-2">
              <p className="text-xs text-amber-400 font-medium">ネタ一覧から引き継ぎ</p>
              <p className="text-xs text-zinc-300 whitespace-pre-wrap leading-relaxed">{prefillMemo}</p>
              <button
                onClick={() => setPrefillMemo(null)}
                className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
              >
                クリア
              </button>
            </div>
          )}

          <div className="bg-zinc-800/60 border border-zinc-700 rounded-xl p-5 text-center space-y-2">
            <p className="text-sm text-zinc-400">Substack 投稿作成機能</p>
            <p className="text-xs text-zinc-600">近日実装予定。現在はネタ一覧で「使う」を押すとメモが引き継がれます。</p>
          </div>
        </div>
      )}

      {/* ━━━━━━━━━━━ 下書き ━━━━━━━━━━━ */}
      {section === "drafts" && (
        <div className="bg-zinc-800 rounded-xl p-8 text-center space-y-2">
          <p className="text-zinc-400 text-sm">下書き機能は近日実装予定です</p>
          <p className="text-xs text-zinc-600">作成した Substack 投稿の下書き保存・管理ができるようになります</p>
        </div>
      )}

      {/* ━━━━━━━━━━━ ソース管理 ━━━━━━━━━━━ */}
      {section === "sources" && (
        <div className="space-y-6">
          {sourceMsg && (
            <div className="text-xs text-green-400 bg-green-900/20 border border-green-700/30 rounded-lg px-3 py-2">{sourceMsg}</div>
          )}

          {/* YouTube */}
          <div className="space-y-3">
            <h4 className="text-sm font-semibold text-zinc-200">YouTubeチャンネル</h4>
            <div className="flex gap-2">
              <input value={ytName} onChange={(e) => setYtName(e.target.value)} placeholder="チャンネル名" className="w-36 bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-xs text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-amber-500" />
              <input value={ytChannelId} onChange={(e) => setYtChannelId(e.target.value)} placeholder="チャンネルID（UCで始まる）またはURL" className="flex-1 bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-xs text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-amber-500" />
              <button onClick={handleAddYouTube} disabled={!ytName.trim() || !ytChannelId.trim()} className="px-3 py-2 text-xs bg-zinc-700 hover:bg-zinc-600 disabled:bg-zinc-800 disabled:text-zinc-600 text-zinc-200 rounded-lg transition-colors">追加</button>
            </div>
            <div className="space-y-1">
              {!sourcesLoaded ? <p className="text-xs text-zinc-600">読み込み中...</p>
                : sources.youtube.length === 0 ? <p className="text-xs text-zinc-600">登録済みチャンネルなし</p>
                : sources.youtube.map((ch) => (
                  <div key={ch.id} className="flex items-center justify-between bg-zinc-800 rounded-lg px-3 py-2">
                    <div>
                      <span className="text-xs text-zinc-200">{ch.name}</span>
                      <span className="text-xs text-zinc-600 ml-2">{ch.channelId}</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <a href={`https://www.youtube.com/channel/${ch.channelId}`} target="_blank" rel="noopener noreferrer" className="text-xs text-zinc-600 hover:text-zinc-300 transition-colors">↗ 確認</a>
                      <button onClick={() => deleteSource("youtube", ch.id)} className="text-xs text-zinc-600 hover:text-red-400 transition-colors">削除</button>
                    </div>
                  </div>
                ))}
            </div>
          </div>

          {/* Bright Data — Xアカウント */}
          <div className="space-y-3">
            <h4 className="text-sm font-semibold text-zinc-200">XアカウントをBright Dataで収集</h4>
            <p className="text-xs text-sky-400/80 bg-sky-900/15 border border-sky-800/30 rounded-lg px-3 py-2">
              ✅ Bright Data経由でXポストを収集します。ここで登録したアカウントが「Bright Data収集」ボタンの対象になります。毎朝6:00 JST に自動収集されます。
            </p>
            <div className="flex gap-2">
              <input value={bdUsername} onChange={(e) => setBdUsername(e.target.value)} onKeyDown={(e) => e.key === "Enter" && handleBdAddAccount()} placeholder="ユーザー名（@なし）" className="flex-1 bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-xs text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-sky-500" />
              <button onClick={handleBdAddAccount} disabled={!bdUsername.trim()} className="px-3 py-2 text-xs bg-sky-800/60 hover:bg-sky-700/70 disabled:bg-zinc-800 disabled:text-zinc-600 text-sky-200 border border-sky-700/50 rounded-lg transition-colors">追加</button>
            </div>
            <div className="space-y-1">
              {bdAccounts.length === 0 ? <p className="text-xs text-zinc-600">登録済みアカウントなし</p>
                : bdAccounts.map((acc) => (
                  <div key={acc.id} className={`flex items-center justify-between bg-zinc-800 rounded-lg px-3 py-2 ${acc.paused ? "opacity-50" : ""}`}>
                    <div className="flex items-center gap-2">
                      <span className={`text-xs ${acc.paused ? "text-zinc-500" : "text-zinc-200"}`}>@{acc.username}</span>
                      {acc.paused && (
                        <span className="text-xs text-zinc-600 border border-zinc-700 rounded px-1 py-0.5">停止中</span>
                      )}
                    </div>
                    <div className="flex items-center gap-3">
                      <a href={`https://x.com/${acc.username}`} target="_blank" rel="noopener noreferrer" className="text-xs text-zinc-600 hover:text-zinc-300 transition-colors">↗ 確認</a>
                      <button onClick={() => handleBdTogglePause(acc.id, !acc.paused)} className="text-xs text-zinc-500 hover:text-sky-400 transition-colors">
                        {acc.paused ? "再開" : "停止"}
                      </button>
                      <button onClick={() => handleBdDeleteAccount(acc.id)} className="text-xs text-zinc-600 hover:text-red-400 transition-colors">削除</button>
                    </div>
                  </div>
                ))}
            </div>
            {bdAccounts.filter((a) => !a.paused).length > 0 && (
              <button
                onClick={handleBdTrigger}
                disabled={bdTriggering}
                className="w-full py-2 text-xs bg-sky-800/40 hover:bg-sky-700/50 disabled:bg-zinc-800 disabled:text-zinc-500 text-sky-300 border border-sky-700/40 rounded-lg transition-colors"
              >
                {bdTriggering ? "リクエスト中..." : "今すぐBright Data収集を実行"}
              </button>
            )}
          </div>

          {/* RSS */}
          <div className="space-y-3">
            <h4 className="text-sm font-semibold text-zinc-200">RSSフィード</h4>
            <div className="flex gap-2">
              <input value={rssName} onChange={(e) => setRssName(e.target.value)} placeholder="フィード名（任意）" className="w-40 bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-xs text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-amber-500" />
              <input value={rssUrl} onChange={(e) => setRssUrl(e.target.value)} placeholder="RSS URL" className="flex-1 bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-xs text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-amber-500" />
              <button onClick={handleAddRss} disabled={!rssUrl.trim()} className="px-3 py-2 text-xs bg-zinc-700 hover:bg-zinc-600 disabled:bg-zinc-800 disabled:text-zinc-600 text-zinc-200 rounded-lg transition-colors">追加</button>
            </div>
            <div className="space-y-1">
              {sources.rss.length === 0 ? <p className="text-xs text-zinc-600">登録済みフィードなし</p>
                : sources.rss.map((feed) => (
                  <div key={feed.id} className={`flex items-center justify-between bg-zinc-800 rounded-lg px-3 py-2 ${feed.paused ? "opacity-50" : ""}`}>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className={`text-xs ${feed.paused ? "text-zinc-500" : "text-zinc-200"}`}>{feed.name}</span>
                        {feed.paused && <span className="text-xs text-zinc-600 border border-zinc-700 rounded px-1 py-0.5">停止中</span>}
                      </div>
                      <p className="text-xs text-zinc-600 truncate">{feed.url}</p>
                    </div>
                    <div className="flex items-center gap-3 ml-3 shrink-0">
                      <button onClick={() => toggleRssPause(feed.id, !feed.paused)} className="text-xs text-zinc-500 hover:text-sky-400 transition-colors">
                        {feed.paused ? "再開" : "停止"}
                      </button>
                      <button onClick={() => deleteSource("rss", feed.id)} className="text-xs text-zinc-600 hover:text-red-400 transition-colors">削除</button>
                    </div>
                  </div>
                ))}
            </div>
          </div>

          {/* おすすめ発見 */}
          <div className="space-y-3 border-t border-zinc-700 pt-6">
            <h4 className="text-sm font-semibold text-zinc-200">新しいソースを探す（おすすめ発見）</h4>
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

            {discoverError && (
              <div className="text-xs text-red-400 bg-red-900/20 border border-red-800/30 rounded-lg px-3 py-2">{discoverError}</div>
            )}
            {discovering && (
              <div className="text-zinc-500 text-sm flex items-center gap-2">
                <span className="inline-block w-1 h-4 bg-amber-400 animate-pulse" />AIが候補を探しています...
              </div>
            )}

            {discoverResult && (
              <div className="space-y-6">
                {(discoverResult.youtube.overseas.length > 0 || discoverResult.youtube.japan.length > 0) && (
                  <div className="space-y-3">
                    <h4 className="text-sm font-semibold text-zinc-200 border-b border-zinc-700 pb-1">YouTubeチャンネル</h4>
                    {[...discoverResult.youtube.overseas.map(i => ({...i, region: "海外"})),
                      ...discoverResult.youtube.japan.map(i => ({...i, region: "日本"}))].reduce<{region: string; items: typeof discoverResult.youtube.overseas}[]>((acc, item) => {
                      const last = acc[acc.length - 1];
                      if (last?.region === item.region) last.items.push(item);
                      else acc.push({ region: item.region, items: [item] });
                      return acc;
                    }, []).map(({ region, items: regionItems }) => (
                      <div key={region} className="space-y-2">
                        <p className="text-xs text-zinc-500 font-medium">{region}</p>
                        {regionItems.map((ch, i) => {
                          const ytUrl = !ch.channelId
                            ? `https://www.youtube.com/results?search_query=${encodeURIComponent(ch.name)}`
                            : ch.channelId.startsWith("UC")
                              ? `https://www.youtube.com/channel/${ch.channelId}`
                              : `https://www.youtube.com/${ch.channelId.startsWith("@") ? ch.channelId : "@" + ch.channelId}`;
                          return (
                            <div key={i} className="bg-zinc-800 border border-zinc-700 rounded-xl p-3">
                              <div className="flex items-start justify-between gap-2">
                                <div className="flex-1 min-w-0">
                                  <p className="text-sm font-medium text-zinc-200">{ch.name}</p>
                                  <p className="text-xs text-zinc-300 mt-0.5 leading-relaxed">{ch.description}</p>
                                  {ch.channelId && <p className="text-xs text-zinc-600 mt-0.5">{ch.channelId.startsWith("UC") ? "ID: " : "handle: "}{ch.channelId}</p>}
                                </div>
                                <div className="flex items-center gap-1.5 shrink-0">
                                  <a href={ytUrl} target="_blank" rel="noopener noreferrer" className="text-xs px-2.5 py-1 text-zinc-500 hover:text-zinc-300 transition-colors">↗ 確認する</a>
                                  <button onClick={() => { addSource("youtube", { id: `yt_${Date.now()}`, name: ch.name, channelId: ch.channelId }); }} className="text-xs px-2.5 py-1 bg-zinc-700 hover:bg-zinc-600 text-zinc-300 rounded-lg transition-colors">追加</button>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    ))}
                  </div>
                )}

                {(discoverResult.x.overseas.length > 0 || discoverResult.x.japan.length > 0) && (
                  <div className="space-y-3">
                    <h4 className="text-sm font-semibold text-zinc-200 border-b border-zinc-700 pb-1">Xアカウント</h4>
                    {[...discoverResult.x.overseas.map(i => ({...i, region: "海外"})),
                      ...discoverResult.x.japan.map(i => ({...i, region: "日本"}))].reduce<{region: string; items: typeof discoverResult.x.overseas}[]>((acc, item) => {
                      const last = acc[acc.length - 1];
                      if (last?.region === item.region) last.items.push(item);
                      else acc.push({ region: item.region, items: [item] });
                      return acc;
                    }, []).map(({ region, items: regionItems }) => (
                      <div key={region} className="space-y-2">
                        <p className="text-xs text-zinc-500 font-medium">{region}</p>
                        {regionItems.map((acc2, i) => (
                          <div key={i} className="bg-zinc-800 border border-zinc-700 rounded-xl p-3 space-y-2">
                            <div className="flex items-start justify-between gap-2">
                              <div className="flex-1 min-w-0">
                                <p className="text-sm font-medium text-zinc-200">@{acc2.username}</p>
                                <p className="text-xs text-zinc-300 mt-0.5 leading-relaxed">{acc2.description}</p>
                              </div>
                              <div className="flex items-center gap-1.5 shrink-0">
                                <a href={`https://x.com/${acc2.username}`} target="_blank" rel="noopener noreferrer" className="text-xs px-2.5 py-1 text-zinc-500 hover:text-zinc-300 transition-colors">↗ 確認する</a>
                                <button onClick={() => { addSource("x", { id: `x_${Date.now()}`, username: acc2.username }); }} className="text-xs px-2.5 py-1 bg-zinc-700 hover:bg-zinc-600 text-zinc-300 rounded-lg transition-colors">追加</button>
                              </div>
                            </div>
                            <p className="text-xs text-yellow-500/80">⚠️ 実在を確認してから追加してください</p>
                          </div>
                        ))}
                      </div>
                    ))}
                  </div>
                )}

                {(discoverResult.rss.overseas.length > 0 || discoverResult.rss.japan.length > 0) && (
                  <div className="space-y-3">
                    <h4 className="text-sm font-semibold text-zinc-200 border-b border-zinc-700 pb-1">RSSフィード</h4>
                    {[...discoverResult.rss.overseas.map(i => ({...i, region: "海外"})),
                      ...discoverResult.rss.japan.map(i => ({...i, region: "日本"}))].reduce<{region: string; items: typeof discoverResult.rss.overseas}[]>((acc, item) => {
                      const last = acc[acc.length - 1];
                      if (last?.region === item.region) last.items.push(item);
                      else acc.push({ region: item.region, items: [item] });
                      return acc;
                    }, []).map(({ region, items: regionItems }) => (
                      <div key={region} className="space-y-2">
                        <p className="text-xs text-zinc-500 font-medium">{region}</p>
                        {regionItems.map((feed, i) => (
                          <div key={i} className="bg-zinc-800 border border-zinc-700 rounded-xl p-3">
                            <div className="flex items-start justify-between gap-2">
                              <div className="flex-1 min-w-0">
                                <p className="text-sm font-medium text-zinc-200">{feed.name}</p>
                                <p className="text-xs text-zinc-300 mt-0.5 leading-relaxed">{feed.description}</p>
                                <p className="text-xs text-zinc-600 truncate mt-0.5">{feed.url}</p>
                              </div>
                              <div className="flex items-center gap-1.5 shrink-0">
                                <a href={feed.url} target="_blank" rel="noopener noreferrer" className="text-xs px-2.5 py-1 text-zinc-500 hover:text-zinc-300 transition-colors">↗ 確認する</a>
                                <button onClick={() => { addSource("rss", { id: `rss_${Date.now()}`, name: feed.name, url: feed.url }); }} className="text-xs px-2.5 py-1 bg-zinc-700 hover:bg-zinc-600 text-zinc-300 rounded-lg transition-colors">追加</button>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
