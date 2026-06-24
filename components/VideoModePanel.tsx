"use client";

import { useState, useEffect } from "react";

interface ArticlePlan {
  id: string;
  content: string;
  generatedAt: string;
}

interface VideoItem {
  id: string;
  title: string;
  url: string;
  savedAt: string;
  analysis: string;
  articlePlans: ArticlePlan[];
}

interface Props {
  onBack: () => void;
  onStartWriting: (theme: string, fullContext: string) => void;
}

const YoutubeIcon = () => (
  <svg viewBox="0 0 24 24" className="w-5 h-5 shrink-0">
    <path
      fill="#ef4444"
      d="M23.5 6.2s-.3-2-1.2-2.8c-1.1-1.2-2.4-1.2-3-1.3C16.8 2 12 2 12 2s-4.8 0-7.3.1c-.6.1-1.9.1-3 1.3C.8 4.2.5 6.2.5 6.2S.2 8.5.2 10.8v2.1c0 2.3.3 4.6.3 4.6s.3 2 1.2 2.8c1.1 1.2 2.6 1.1 3.3 1.2C7.2 21.7 12 21.8 12 21.8s4.8 0 7.3-.2c.6-.1 1.9-.1 3-1.3.9-.8 1.2-2.8 1.2-2.8s.3-2.3.3-4.6v-2.1c0-2.3-.3-4.6-.3-4.6zm-13.9 9.3V8.5l8.1 3.5-8.1 3.5z"
    />
  </svg>
);

function extractTitle(content: string): string {
  const lines = content.split("\n").filter((l) => l.trim());
  const first = lines[0]?.trim() ?? "";
  return first.replace(/^#+\s*/, "").replace(/^【[^】]*】\s*/, "").slice(0, 60) || "（動画から生成）";
}

export default function VideoModePanel({ onBack, onStartWriting }: Props) {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [videos, setVideos] = useState<VideoItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedVideo, setSelectedVideo] = useState<VideoItem | null>(null);
  const [selectedPlan, setSelectedPlan] = useState<ArticlePlan | null>(null);
  const [additionalNotes, setAdditionalNotes] = useState("");

  useEffect(() => {
    fetch("/api/video-ideas")
      .then((r) => r.json())
      .then((d) => setVideos(d.videos ?? []))
      .catch(() => setVideos([]))
      .finally(() => setLoading(false));
  }, []);

  const handleSelectVideo = (video: VideoItem) => {
    setSelectedVideo(video);
    setStep(2);
  };

  const handleSelectPlan = (plan: ArticlePlan) => {
    setSelectedPlan(plan);
    setAdditionalNotes("");
    setStep(3);
  };

  const handleGenerate = () => {
    if (!selectedPlan) return;
    const fullContext = additionalNotes.trim()
      ? `${selectedPlan.content}\n\n---\n\n【追加の指示・要望】\n${additionalNotes.trim()}`
      : selectedPlan.content;
    onStartWriting(extractTitle(selectedPlan.content), fullContext);
  };

  // ── ステップ1：動画一覧 ──────────────────────────────────
  if (step === 1) {
    return (
      <div className="space-y-4">
        <button
          onClick={onBack}
          className="text-zinc-500 hover:text-zinc-300 text-sm flex items-center gap-1"
        >
          ← モード選択に戻る
        </button>

        <p className="text-zinc-400 text-sm font-medium">
          idea-engineの動画を選んでください
        </p>

        {loading ? (
          <div className="text-zinc-500 text-sm flex items-center gap-2">
            <span className="inline-block w-1 h-4 bg-amber-400 animate-pulse" />
            読み込み中...
          </div>
        ) : videos.length === 0 ? (
          <div className="bg-zinc-800 rounded-xl p-8 text-center">
            <YoutubeIcon />
            <p className="text-zinc-500 text-sm mt-3">
              idea-engineで動画を分析すると、ここに表示されます
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {videos.map((v) => (
              <button
                key={v.id}
                onClick={() => handleSelectVideo(v)}
                disabled={v.articlePlans.length === 0}
                className="w-full bg-zinc-800 hover:bg-zinc-700 disabled:opacity-40 disabled:cursor-not-allowed border border-zinc-700 rounded-xl p-4 text-left transition-colors"
              >
                <div className="flex items-start gap-3">
                  <YoutubeIcon />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-zinc-200 leading-snug">
                      {v.title || "（タイトルなし）"}
                    </p>
                    <p className="text-xs text-zinc-500 mt-1">
                      {new Date(v.savedAt).toLocaleDateString("ja-JP")}
                      {" · "}
                      {v.articlePlans.length === 0
                        ? "企画案なし（idea-engineで生成してください）"
                        : `企画案 ${v.articlePlans.length}件`}
                    </p>
                  </div>
                  {v.articlePlans.length > 0 && (
                    <span className="text-zinc-500 text-sm shrink-0 mt-0.5">→</span>
                  )}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }

  // ── ステップ2：企画案一覧 ────────────────────────────────
  if (step === 2 && selectedVideo) {
    return (
      <div className="space-y-4">
        <button
          onClick={() => setStep(1)}
          className="text-zinc-500 hover:text-zinc-300 text-sm flex items-center gap-1"
        >
          ← 動画一覧に戻る
        </button>

        <div className="bg-zinc-800/50 border border-zinc-700/50 rounded-lg px-3 py-2 flex items-start gap-2">
          <YoutubeIcon />
          <p className="text-sm text-zinc-300 leading-snug">{selectedVideo.title}</p>
        </div>

        <p className="text-zinc-400 text-sm font-medium">企画案を選んでください</p>

        {selectedVideo.articlePlans.length === 0 ? (
          <div className="bg-zinc-800 rounded-xl p-6 text-center text-zinc-500 text-sm">
            企画案がありません。idea-engineで「企画案を出す」を実行してください。
          </div>
        ) : (
          <div className="space-y-2">
            {selectedVideo.articlePlans.map((plan, i) => (
              <button
                key={plan.id}
                onClick={() => handleSelectPlan(plan)}
                className="w-full bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded-xl p-4 text-left transition-colors"
              >
                <p className="text-xs text-zinc-500 mb-1.5">企画案 {i + 1}</p>
                <p className="text-sm text-zinc-300 leading-relaxed">
                  {plan.content.slice(0, 100)}
                  {plan.content.length > 100 ? "…" : ""}
                </p>
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }

  // ── ステップ3：内容確認・追加指示・生成 ──────────────────
  if (step === 3 && selectedPlan) {
    return (
      <div className="space-y-4">
        <button
          onClick={() => setStep(2)}
          className="text-zinc-500 hover:text-zinc-300 text-sm flex items-center gap-1"
        >
          ← 企画案一覧に戻る
        </button>

        <div>
          <p className="text-xs text-zinc-500 mb-2">選択した企画案</p>
          <div className="bg-zinc-800 border border-zinc-700 rounded-xl p-4 max-h-52 overflow-y-auto">
            <pre className="text-sm text-zinc-300 whitespace-pre-wrap leading-relaxed font-sans">
              {selectedPlan.content}
            </pre>
          </div>
        </div>

        <div>
          <label className="text-xs text-zinc-400 mb-1.5 block">
            追加の指示・要望（任意）
          </label>
          <textarea
            placeholder={"例：ですます調で書いてください\n体験談を冒頭に入れてください"}
            value={additionalNotes}
            onChange={(e) => setAdditionalNotes(e.target.value)}
            rows={3}
            className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2.5 text-sm text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-amber-500 resize-none"
          />
        </div>

        <button
          onClick={handleGenerate}
          className="w-full py-3 bg-amber-500 hover:bg-amber-400 text-black font-bold rounded-xl transition-colors"
        >
          記事を生成 →
        </button>
      </div>
    );
  }

  return null;
}
