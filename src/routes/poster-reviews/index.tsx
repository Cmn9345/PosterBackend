import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  Check,
  X,
  Loader2,
  Calendar,
  User,
  FileImage,
  Sparkles,
  FileText,
  Image as ImageIcon,
  Star,
  Lightbulb,
} from "lucide-react";
import { querySupabase } from "../../lib/api";

/**
 * Optional `?id=<posterId>` deep-link — used by /exhibitions drawer to drop
 * the user straight onto a specific review row. Validated loosely so an
 * unknown / malformed id silently falls back to the default list view.
 */
interface ReviewsSearch {
  id?: string;
}

export const Route = createFileRoute("/poster-reviews/")({
  component: PosterReviewsPage,
  validateSearch: (raw: Record<string, unknown>): ReviewsSearch => ({
    id: typeof raw.id === "string" && raw.id.length > 0 ? raw.id : undefined,
  }),
});

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface PosterRow {
  id: string;
  /** Human-readable short id — e.g. `P-20260422-abc12345`. */
  poster_id: string | null;
  project_name: string | null;
  status: string;
  creator_id: string | null;
  created_at: string | null;
  updated_at: string | null;
}

/** poster_files columns this page actually consumes (production schema). */
interface FileRow {
  id: string;
  poster_id: string;
  original_filename: string | null;
  storage_path: string | null;
  processing_status: string | null;
  /** AI caption — written by the Rust pipeline from the VLM result. */
  description: string | null;
  people_summary: string | null;
  file_type: string | null;
  file_size: number | null;
  poster_size: string | null;
  access_level: string | null;
  immich_asset_id: string | null;
  immich_sync_status: string | null;
  /** Full VLM result JSONB — includes 5-dimension `scores` + `suggestions`
   *  used by the rating section below. */
  ai_analysis: AiAnalysis | null;
}

interface AiScores {
  composition?: number | null;
  clarity?: number | null;
  design_quality?: number | null;
  content_completeness?: number | null;
  typography?: number | null;
}

interface AiAnalysis {
  scores?: AiScores | null;
  suggestions?: string | null;
}

const SCORE_DIMENSIONS: { key: keyof AiScores; label: string }[] = [
  { key: "composition", label: "構圖" },
  { key: "clarity", label: "易讀性" },
  { key: "design_quality", label: "設計品質" },
  { key: "content_completeness", label: "資訊完整" },
  { key: "typography", label: "字體排版" },
];

/* ------------------------------------------------------------------ */
/*  Page                                                               */
/* ------------------------------------------------------------------ */

function PosterReviewsPage() {
  // Deep-link via `?id=...` opens that poster's review pane directly.
  const { id: deepLinkId } = Route.useSearch();
  const [posters, setPosters] = useState<PosterRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(deepLinkId ?? null);

  // Sync state if the URL search param changes after mount (browser back/forward).
  useEffect(() => {
    if (deepLinkId) setSelectedId(deepLinkId);
  }, [deepLinkId]);

  const fetchPending = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const rows = await querySupabase<PosterRow>(
        "posters",
        "status=in.(pending_review,processing)&order=updated_at.desc&limit=50",
      );
      setPosters(rows);
    } catch (err) {
      console.error("[PosterReviews] fetch failed:", err);
      setError(err instanceof Error ? err.message : "載入待審核海報失敗");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPending();
  }, [fetchPending]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { pending_review: 0, processing: 0 };
    for (const p of posters) c[p.status] = (c[p.status] ?? 0) + 1;
    return c;
  }, [posters]);

  return (
    <div className="min-h-screen">
      <div className="px-6 py-6">
        <header className="mb-6">
          <h1 className="text-2xl font-semibold text-gray-900">上架審核</h1>
          <p className="text-sm text-gray-500 mt-1">
            審核建檔者上傳的海報 — 核可後公開於前台，駁回則退還建檔者修改。
          </p>
          <div className="flex gap-3 mt-3 text-sm">
            <span className="px-2.5 py-1 rounded-full bg-yellow-50 text-yellow-700">
              待審核 {counts.pending_review ?? 0}
            </span>
            <span className="px-2.5 py-1 rounded-full bg-indigo-50 text-indigo-700">
              處理中 {counts.processing ?? 0}
            </span>
          </div>
        </header>

        {loading && (
          <div className="flex items-center gap-2 text-gray-500">
            <Loader2 className="w-4 h-4 animate-spin" /> 載入中…
          </div>
        )}

        {error && (
          <div className="p-4 rounded-lg bg-red-50 text-red-700 text-sm">
            {error}
          </div>
        )}

        {!loading && !error && posters.length === 0 && (
          <div className="py-16 text-center text-gray-400">
            <FileImage className="w-12 h-12 mx-auto mb-3 opacity-40" />
            <p>目前沒有待審核的海報</p>
          </div>
        )}

        <div className="grid gap-3">
          {posters.map((p) => (
            <button
              key={p.id}
              onClick={() => setSelectedId(p.id)}
              className="text-left w-full bg-white border border-gray-200 hover:border-blue-300 hover:shadow-sm rounded-lg p-4 transition"
            >
              <div className="flex items-center justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-gray-900">
                      {p.project_name || "（未命名）"}
                    </span>
                    <StatusPill status={p.status} />
                  </div>
                  <div className="mt-1 text-xs text-gray-500 flex items-center gap-4">
                    <span className="flex items-center gap-1">
                      <User className="w-3.5 h-3.5" />
                      {p.creator_id ? p.creator_id.slice(0, 8) : "unknown"}
                    </span>
                    <span className="flex items-center gap-1">
                      <Calendar className="w-3.5 h-3.5" />
                      {formatDate(p.updated_at || p.created_at)}
                    </span>
                    {p.poster_id && (
                      <span className="text-gray-400">{p.poster_id}</span>
                    )}
                  </div>
                </div>
                <span className="text-sm text-blue-600">開啟審核 →</span>
              </div>
            </button>
          ))}
        </div>
      </div>

      {selectedId && (
        <ReviewModal
          posterId={selectedId}
          onClose={() => setSelectedId(null)}
          onDone={() => {
            setSelectedId(null);
            fetchPending();
          }}
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Modal                                                              */
/* ------------------------------------------------------------------ */

function ReviewModal({
  posterId,
  onClose,
  onDone,
}: {
  posterId: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [files, setFiles] = useState<FileRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reviewerNotes, setReviewerNotes] = useState("");
  const [rejectionReason, setRejectionReason] = useState("");
  const [acting, setActing] = useState(false);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const rows = await querySupabase<FileRow>(
          "poster_files",
          `poster_id=eq.${posterId}&order=created_at.asc`,
        );
        setFiles(rows);
      } catch (err) {
        // Surface the raw backend error so transient network / RLS / schema
        // issues are debuggable from the UI instead of the generic "載入檔案
        // 失敗" placeholder that hid the real reason.
        const msg =
          typeof err === "string"
            ? err
            : err instanceof Error
              ? err.message
              : JSON.stringify(err);
        setError(`載入檔案失敗：${msg}`);
      } finally {
        setLoading(false);
      }
    })();
  }, [posterId]);

  const submit = async (decision: "approved" | "rejected") => {
    if (decision === "rejected" && !rejectionReason.trim()) {
      alert("駁回時請填寫退回原因，方便建檔者修正");
      return;
    }
    setActing(true);
    try {
      await invoke("submit_review", {
        decision: {
          project_id: posterId,
          decision,
          reviewer_notes: reviewerNotes.trim() || null,
          rejection_reason:
            decision === "rejected" ? rejectionReason.trim() : null,
        },
      });
      onDone();
    } catch (err) {
      alert(`審核失敗：${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setActing(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-5xl max-h-[90vh] overflow-hidden flex flex-col">
        <header className="px-6 py-4 border-b flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold">海報上架審核</h2>
            <p className="text-xs text-gray-500 mt-0.5">{posterId}</p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 hover:bg-gray-100 rounded"
            aria-label="關閉"
          >
            <X className="w-5 h-5" />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-5">
          {loading ? (
            <div className="flex items-center gap-2 text-gray-500">
              <Loader2 className="w-4 h-4 animate-spin" /> 載入檔案中…
            </div>
          ) : error ? (
            <div className="p-4 rounded-lg bg-red-50 text-red-700">{error}</div>
          ) : (
            files.map((f) => <FileReviewCard key={f.id} file={f} />)
          )}
        </div>

        <footer className="px-6 py-4 border-t bg-gray-50 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-xs text-gray-600">審核備註（選填）</span>
              <textarea
                value={reviewerNotes}
                onChange={(e) => setReviewerNotes(e.target.value)}
                rows={2}
                className="mt-1 w-full border border-gray-300 rounded px-3 py-2 text-sm"
                placeholder="例如：素材品質良好，建議放進年度資料庫"
              />
            </label>
            <label className="block">
              <span className="text-xs text-gray-600">駁回原因（若駁回必填）</span>
              <textarea
                value={rejectionReason}
                onChange={(e) => setRejectionReason(e.target.value)}
                rows={2}
                className="mt-1 w-full border border-gray-300 rounded px-3 py-2 text-sm"
                placeholder="例如：解析度不足，請重新上傳 300dpi 版本"
              />
            </label>
          </div>
          <div className="flex justify-end gap-2">
            <button
              onClick={onClose}
              disabled={acting}
              className="px-4 py-2 text-sm rounded border border-gray-300 hover:bg-gray-100"
            >
              取消
            </button>
            <button
              onClick={() => submit("rejected")}
              disabled={acting}
              className="px-4 py-2 text-sm rounded bg-red-600 text-white hover:bg-red-700 disabled:opacity-50 flex items-center gap-1"
            >
              {acting ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <X className="w-4 h-4" />
              )}
              駁回
            </button>
            <button
              onClick={() => submit("approved")}
              disabled={acting}
              className="px-4 py-2 text-sm rounded bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50 flex items-center gap-1"
            >
              {acting ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Check className="w-4 h-4" />
              )}
              核可上架
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  File card                                                          */
/* ------------------------------------------------------------------ */

function FileReviewCard({ file }: { file: FileRow }) {
  return (
    <article className="border border-gray-200 rounded-lg overflow-hidden">
      <div className="grid grid-cols-[240px_1fr] gap-4 p-4">
        <ThumbPreview posterId={file.poster_id} fileId={file.id} />
        <div className="space-y-3 text-sm">
          <div>
            <div className="font-medium text-gray-900">
              {file.original_filename || "（未命名檔案）"}
            </div>
            <div className="text-xs text-gray-500 mt-0.5">
              狀態：{file.processing_status || "unknown"}
              {file.file_type && ` · ${file.file_type.toUpperCase()}`}
              {file.file_size != null && ` · ${formatBytes(file.file_size)}`}
            </div>
          </div>

          <section>
            <SectionTitle icon={<FileImage className="w-4 h-4" />}>
              檔案資訊
            </SectionTitle>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
              <MetaRow k="海報尺寸" v={file.poster_size ?? undefined} />
              <MetaRow k="存取等級" v={file.access_level ?? undefined} />
              <MetaRow k="Immich 同步" v={file.immich_sync_status ?? undefined} />
              <MetaRow k="Immich asset" v={file.immich_asset_id?.slice(0, 8)} />
            </dl>
          </section>

          <section>
            <SectionTitle icon={<Sparkles className="w-4 h-4" />}>
              AI 圖說
            </SectionTitle>
            {file.description ? (
              <p className="text-sm text-gray-700 leading-relaxed">
                {file.description}
              </p>
            ) : (
              <p className="text-xs text-amber-700 inline-flex items-center gap-1">
                <FileText className="w-3.5 h-3.5" />
                尚未取得 AI 結果
              </p>
            )}
            {file.people_summary && (
              <p className="text-xs text-gray-500 mt-1">
                人物：{file.people_summary}
              </p>
            )}
          </section>

          <ScoreSection ai={file.ai_analysis} />
        </div>
      </div>
    </article>
  );
}

/* ------------------------------------------------------------------ */
/*  AI 品質評分                                                         */
/* ------------------------------------------------------------------ */

function ScoreSection({ ai }: { ai: AiAnalysis | null }) {
  const scores = ai?.scores ?? null;
  const present = scores
    ? SCORE_DIMENSIONS.filter((d) => typeof scores[d.key] === "number")
    : [];
  if (present.length === 0 && !ai?.suggestions) return null;

  const avg =
    present.length > 0
      ? Math.round(
          present.reduce((sum, d) => sum + (scores![d.key] as number), 0) /
            present.length,
        )
      : null;

  return (
    <section>
      <SectionTitle icon={<Star className="w-4 h-4" />}>
        AI 品質評分
        {avg != null && (
          <span
            className={`ml-2 text-[11px] font-semibold normal-case tracking-normal ${tierColor(
              avg,
            )}`}
          >
            平均 {avg} / 100 · {tierLabel(avg)}
          </span>
        )}
      </SectionTitle>

      {present.length > 0 && (
        <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
          {present.map((d) => (
            <ScoreRow
              key={d.key}
              label={d.label}
              value={scores![d.key] as number}
            />
          ))}
        </div>
      )}

      {ai?.suggestions && (
        <p className="mt-2 flex items-start gap-1.5 text-xs text-gray-600 bg-amber-50/50 border border-amber-100 rounded px-2 py-1.5">
          <Lightbulb className="w-3.5 h-3.5 mt-0.5 text-amber-600 shrink-0" />
          <span className="leading-relaxed">{ai.suggestions}</span>
        </p>
      )}
    </section>
  );
}

function ScoreRow({ label, value }: { label: string; value: number }) {
  const clamped = Math.max(0, Math.min(100, value));
  const color = tierBar(clamped);
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="w-16 shrink-0 text-gray-500">{label}</span>
      <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
        <div
          className={`h-full ${color} rounded-full`}
          style={{ width: `${clamped}%` }}
        />
      </div>
      <span className={`w-7 text-right tabular-nums ${tierColor(clamped)}`}>
        {clamped}
      </span>
    </div>
  );
}

function tierColor(v: number): string {
  if (v >= 85) return "text-emerald-600";
  if (v >= 70) return "text-blue-600";
  if (v >= 55) return "text-amber-600";
  return "text-red-600";
}

function tierBar(v: number): string {
  if (v >= 85) return "bg-emerald-500";
  if (v >= 70) return "bg-blue-500";
  if (v >= 55) return "bg-amber-500";
  return "bg-red-500";
}

function tierLabel(v: number): string {
  if (v >= 85) return "優秀";
  if (v >= 70) return "良好";
  if (v >= 55) return "尚可";
  return "需改善";
}

/* ------------------------------------------------------------------ */
/*  Small helpers                                                      */
/* ------------------------------------------------------------------ */

function SectionTitle({
  icon,
  children,
}: {
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <h3 className="flex items-center gap-1.5 text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1">
      {icon}
      {children}
    </h3>
  );
}

function MetaRow({ k, v }: { k: string; v?: string | number }) {
  return (
    <>
      <dt className="text-gray-500">{k}</dt>
      <dd className="text-gray-800">{v ?? "—"}</dd>
    </>
  );
}

function StatusPill({ status }: { status: string }) {
  const cls =
    status === "pending_review"
      ? "bg-yellow-100 text-yellow-700"
      : status === "processing"
        ? "bg-indigo-100 text-indigo-700"
        : "bg-gray-100 text-gray-600";
  const label =
    status === "pending_review"
      ? "待審核"
      : status === "processing"
        ? "處理中"
        : status;
  return (
    <span className={`px-2 py-0.5 rounded-full text-xs ${cls}`}>{label}</span>
  );
}

/**
 * Load a thumbnail by deriving its path from the canonical Rust naming
 * convention: `{poster_id}/{file_id}_m.webp` inside `poster-thumbnails`.
 * The Supabase schema has no `thumbnail_path` column, so we reconstruct.
 */
function ThumbPreview({
  posterId,
  fileId,
}: {
  posterId: string;
  fileId: string;
}) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    const path = `${posterId}/${fileId}_m.webp`;
    (async () => {
      try {
        const signed = await invoke<string>("sign_thumbnail_url", {
          path,
        }).catch(() => null);
        if (!cancelled) setUrl(signed);
      } catch {
        /* signing helper optional; placeholder shown otherwise */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [posterId, fileId]);

  return (
    <div className="bg-gray-100 rounded-lg aspect-[3/4] flex items-center justify-center overflow-hidden">
      {url ? (
        <img src={url} alt="thumbnail" className="w-full h-full object-cover" />
      ) : (
        <ImageIcon className="w-10 h-10 text-gray-300" />
      )}
    </div>
  );
}

function formatDate(s: string | null | undefined): string {
  if (!s) return "—";
  return s.length > 10 ? s.slice(0, 10) : s;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
