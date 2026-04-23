import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ChevronLeft, Save, FileIcon, Loader2, Sparkles, FileText, Send, Check, RefreshCw, RotateCcw } from "lucide-react";
import { useQwenpawProgress } from "../../hooks/useQwenpawProgress";
import { ProjectProgressPanel } from "../../components/ProjectProgressPanel";

// 直接拼 Supabase Storage public URL,避免 supabase-js 在 Vite env 沒設時
// createClient() 就丟 "supabaseKey is required" 把整頁炸白。
const SUPABASE_URL =
  (import.meta as unknown as { env: Record<string, string> }).env
    .VITE_POSTER_SUPABASE_URL || "https://ptsupabase.tzuchi-org.tw";
const THUMBNAIL_PUBLIC_URL_PREFIX = `${SUPABASE_URL}/storage/v1/object/public/poster-thumbnails`;

export const Route = createFileRoute("/posters/$projectId/edit")({
  component: EditProject,
});

interface Project {
  id: string;
  name: string;
  description: string | null;
  status: string;
  total_files: number;
  completed_files: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

interface ProjectFile {
  id: string;
  project_id: string;
  file_name: string;
  file_ext: string;
  file_size: number;
  file_type: string;
  processing_status: string;
  /** Set once the original has been uploaded to Supabase Storage. */
  storage_path: string | null;
  /** Set after Qwenpaw pipeline writes M-size WebP to poster-thumbnails bucket. */
  thumbnail_path: string | null;
  metadata_json: string | null;
  ai_analysis: string | null;
}

interface FileMetadata {
  title?: string;
  description?: string;
  keywords?: string[];
  category?: string;
}

/** Parsed from `project_files.ai_analysis` — mirrors the Rust `AiAnalysis` struct. */
interface AiScores {
  composition?: number;
  clarity?: number;
  design_quality?: number;
  content_completeness?: number;
  typography?: number;
}
interface AiAnalysis {
  ocr_text?: string;
  themes?: string[];
  description?: string;
  language?: string;
  has_logo?: boolean;
  has_person?: boolean;
  scores?: AiScores;
  suggestions?: string;
  raw_text?: string;
  error?: string;
}

const SCORE_LABELS: Array<{ key: keyof AiScores; label: string }> = [
  { key: "composition", label: "構圖" },
  { key: "clarity", label: "易讀性" },
  { key: "design_quality", label: "設計品質" },
  { key: "content_completeness", label: "資訊完整度" },
  { key: "typography", label: "字體排版" },
];

function scoreColor(v: number): string {
  if (v >= 80) return "text-emerald-600 bg-emerald-50 border-emerald-200";
  if (v >= 60) return "text-amber-700 bg-amber-50 border-amber-200";
  return "text-red-700 bg-red-50 border-red-200";
}

/** Parsed from `project_files.metadata_json` — produced by Rust `qwenpaw::metadata`. */
interface FileTechMeta {
  format?: string;
  mode?: string;
  width?: number;
  height?: number;
  dpi_x?: number;
  dpi_y?: number;
  exif?: Record<string, string>;
  error?: string;
}

function tryParse<T>(raw: string | null | undefined): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

/**
 * AI caption is often a flowing sentence — derive a short title from the
 * leading clause. Splits on CJK + ASCII terminators and trims to a readable
 * length so the "標題" field gets something like "柔 林詩柔" instead of the
 * whole paragraph.
 */
function leadingClause(s: string, max = 24): string {
  const trimmed = s.trim();
  if (!trimmed) return "";
  const cut = trimmed.split(/[。．\.！!？?；;，,、\n]/)[0] ?? trimmed;
  const clean = cut.trim().replace(/^["「『‘“]|["」』’”]$/g, "");
  return clean.length > max ? clean.slice(0, max) + "…" : clean;
}

/**
 * Merge `ai_analysis` into the blank review fields of a file edit record
 * without ever overwriting a non-empty value. Maps:
 *   - description (圖說) → 描述
 *   - themes (主題 array) → 關鍵字
 *   - themes[0] → 分類（沒有更好的來源時的 fallback）
 *   - description 首句 → 標題
 */
function mergeAiIntoEdits(
  base: FileMetadata,
  ai: AiAnalysis | null,
): FileMetadata {
  if (!ai) return base;
  const out = { ...base };
  const themes = (ai.themes ?? []).filter(
    (t): t is string => typeof t === "string" && t.trim().length > 0,
  );
  if (!out.description && ai.description) out.description = ai.description;
  if ((!out.keywords || out.keywords.length === 0) && themes.length) {
    out.keywords = themes;
  }
  if (!out.category && themes[0]) out.category = themes[0];
  if (!out.title && ai.description) {
    const title = leadingClause(ai.description);
    if (title) out.title = title;
  }
  return out;
}

const statusLabel: Record<string, string> = {
  draft: "草稿",
  uploading: "上傳中",
  processing: "處理中",
  pending_review: "待審核",
  published: "已上架",
  rejected: "已駁回",
  archived: "已封存",
  failed: "處理失敗",
};

const statusBadge: Record<string, string> = {
  draft: "bg-gray-100 text-gray-600",
  uploading: "bg-blue-100 text-blue-700",
  processing: "bg-yellow-100 text-yellow-700",
  pending_review: "bg-orange-100 text-orange-700",
  published: "bg-green-100 text-green-700",
  rejected: "bg-red-100 text-red-700",
  archived: "bg-gray-100 text-gray-500",
  failed: "bg-red-100 text-red-700",
};

const fileTypeLabel: Record<string, string> = {
  raster: "點陣圖",
  design: "設計原檔",
  vector: "向量圖",
  document: "文件",
  unknown: "其他",
};

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const inputClass =
  "w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary";
const labelClass = "block text-sm font-medium text-gray-700 mb-1.5";

function EditProject() {
  const navigate = useNavigate();
  const { projectId } = Route.useParams();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const [project, setProject] = useState<Project | null>(null);
  const [files, setFiles] = useState<ProjectFile[]>([]);

  // Editable fields
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [fileEdits, setFileEdits] = useState<Record<string, FileMetadata>>({});

  useEffect(() => {
    if (toast) {
      const t = setTimeout(() => setToast(null), 3000);
      return () => clearTimeout(t);
    }
  }, [toast]);

  // Stable ref to the latest file list so effects that subscribe to pipeline
  // events (which fire keyed by `file_id`) can decide whether to trigger a
  // refresh without re-subscribing every render.
  const fileIdsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    fileIdsRef.current = new Set(files.map((f) => f.id));
  }, [files]);

  // Single loader used by both the initial mount and later refresh triggers
  // (manual button + pipeline completion). Keeps the "merge metadata edits"
  // logic in one place so refreshing doesn't clobber in-progress field edits.
  const refresh = useCallback(
    async (opts: { preserveEdits?: boolean } = {}) => {
      try {
        const [proj, fileList] = await invoke<[Project, ProjectFile[]]>(
          "get_project",
          { projectId },
        );
        setProject(proj);
        setFiles(fileList);
        if (!opts.preserveEdits) {
          setName(proj.name);
          setDescription(proj.description ?? "");
        }
        setFileEdits((prev) => {
          const next: Record<string, FileMetadata> = {};
          for (const f of fileList) {
            // Keep the user's unsaved field edits on refresh; merge from
            // metadata_json and AI result only into the blank spots so the
            // form fills in progressively as the pipeline completes without
            // clobbering anything the user has already typed.
            const existing = opts.preserveEdits ? prev[f.id] : undefined;
            let base: FileMetadata = {};
            if (existing && Object.keys(existing).length > 0) {
              base = existing;
            } else if (f.metadata_json) {
              try {
                const parsed = JSON.parse(f.metadata_json);
                // metadata_json doubles as (a) the Rust-pipeline tech info
                // blob (format/mode/width…) and (b) the review metadata
                // (title/description/keywords/category). Only the latter
                // keys belong in the editor fields.
                base = {
                  title: parsed.title ?? undefined,
                  description: parsed.description ?? undefined,
                  keywords: Array.isArray(parsed.keywords)
                    ? parsed.keywords
                    : undefined,
                  category: parsed.category ?? undefined,
                };
              } catch {
                base = {};
              }
            }
            // Autofill from AI result — only fills empty fields.
            base = mergeAiIntoEdits(base, tryParse<AiAnalysis>(f.ai_analysis));
            next[f.id] = base;
          }
          return next;
        });
      } catch (err) {
        setError(typeof err === "string" ? err : "載入專案失敗");
      } finally {
        setLoading(false);
      }
    },
    [projectId],
  );

  useEffect(() => {
    refresh();
  }, [refresh]);

  function updateFileMeta(fileId: string, field: keyof FileMetadata, value: string) {
    setFileEdits((prev) => ({
      ...prev,
      [fileId]: {
        ...prev[fileId],
        [field]: field === "keywords" ? value.split(",").map((s) => s.trim()).filter(Boolean) : value,
      },
    }));
  }

  async function handleSave() {
    if (!project) return;
    setSaving(true);
    try {
      // Save file metadata edits
      const edits = Object.entries(fileEdits).map(([fileId, meta]) => ({
        file_id: fileId,
        title: meta.title ?? null,
        description: meta.description ?? null,
        keywords: meta.keywords ?? null,
        category: meta.category ?? null,
      }));

      if (edits.length > 0) {
        await invoke("update_file_review", { edits });
      }

      setToast("儲存成功");
    } catch (err) {
      setToast(typeof err === "string" ? err : "儲存失敗，請稍後再試");
    } finally {
      setSaving(false);
    }
  }

  const [submitting, setSubmitting] = useState(false);
  const [reprocessing, setReprocessing] = useState<Record<string, boolean>>({});

  async function handleReprocess(fileId: string) {
    if (!project) return;
    setReprocessing((prev) => ({ ...prev, [fileId]: true }));
    try {
      await invoke("reprocess_file", {
        projectId: project.id,
        fileId,
      });
      setToast("已重新送出處理，請稍候…");
      // Poll the project a couple of times so the status chip updates
      // without the user having to click around.
      for (let i = 0; i < 12; i++) {
        await new Promise((r) => setTimeout(r, 2500));
        try {
          const [proj, fileList] = await invoke<
            [Project, ProjectFile[]]
          >("get_project", { projectId: project.id });
          setProject(proj);
          setFiles(fileList);
          const target = fileList.find((f) => f.id === fileId);
          if (target?.processing_status === "completed") break;
        } catch {
          /* ignore, keep polling */
        }
      }
    } catch (err) {
      setToast(
        typeof err === "string" ? err : "重新處理失敗，請檢查後端 log",
      );
    } finally {
      setReprocessing((prev) => {
        const next = { ...prev };
        delete next[fileId];
        return next;
      });
    }
  }

  async function handleSubmitForReview() {
    if (!project) return;
    const confirmed = window.confirm(
      "送出審核後，專案會移交審核人員，此時編輯內容將鎖定。確定送出？",
    );
    if (!confirmed) return;
    setSubmitting(true);
    try {
      // Persist any unsaved edits first. Failures here aren't fatal — the
      // backend submit flow below is what actually gates whether the row
      // shows up in the reviewer list.
      const edits = Object.entries(fileEdits).map(([fileId, meta]) => ({
        file_id: fileId,
        title: meta.title ?? null,
        description: meta.description ?? null,
        keywords: meta.keywords ?? null,
        category: meta.category ?? null,
      }));
      if (edits.length > 0) {
        try {
          await invoke("update_file_review", { edits });
        } catch (err) {
          console.warn("save edits before submit failed:", err);
        }
      }
      // Use the dedicated submit command — it ensures the Supabase `posters`
      // + `poster_files` rows actually exist before flipping status, so the
      // reviewer list stops missing submissions.
      await invoke("submit_project_for_review", { projectId: project.id });
      setToast("已送出審核");
      setTimeout(() => navigate({ to: "/poster-reviews" }), 600);
    } catch (err) {
      const msg =
        typeof err === "string"
          ? err
          : err instanceof Error
            ? err.message
            : "送出審核失敗，請稍後再試";
      // Surface the backend's real reason (e.g. "尚未登入" / "補建雲端專案
      // 失敗：…") instead of a generic retry hint so the user can act on it.
      setToast(msg);
      // Revert the optimistic status change on failure — refresh pulls the
      // authoritative state, which the backend only flips locally when the
      // whole ensure chain succeeds.
      await refresh({ preserveEdits: true }).catch(() => {});
    } finally {
      setSubmitting(false);
    }
  }

  // Live pipeline events — used to switch the page into "progress mode" when
  // the project is still being processed by the Rust worker + local VLM.
  const { byFile: qwenpawProgress } = useQwenpawProgress();

  // Keep only events belonging to this project's files. `byFile` is keyed by
  // file_id; intersect with the file list we loaded from Rust to avoid
  // rendering events from sibling projects that happened to fire in the same
  // session.
  const scopedProgress = useMemo(() => {
    if (files.length === 0) return qwenpawProgress;
    const out: typeof qwenpawProgress = {};
    for (const [k, v] of Object.entries(qwenpawProgress)) {
      if (fileIdsRef.current.has(k)) out[k] = v;
    }
    return out;
  }, [qwenpawProgress, files]);

  // When a file in this project transitions into `completed` / `failed` we
  // need to re-pull the row from Rust so the edit form actually surfaces the
  // newly-written `metadata_json` (tech info) and `ai_analysis` (VLM caption,
  // themes, OCR). Without this the Rust worker silently persists to SQLite
  // and the UI keeps showing "尚未處理" from the initial page load.
  const lastHandledStage = useRef<Record<string, string>>({});
  useEffect(() => {
    let shouldRefresh = false;
    for (const [fileId, prog] of Object.entries(scopedProgress)) {
      if (prog.stage !== "completed" && prog.stage !== "failed") continue;
      if (lastHandledStage.current[fileId] === prog.stage) continue;
      lastHandledStage.current[fileId] = prog.stage;
      shouldRefresh = true;
    }
    if (shouldRefresh) {
      refresh({ preserveEdits: true }).catch(() => {
        /* refresh surfaces its own error state */
      });
      // Rust flips project status to "draft" AFTER persisting the last file,
      // which can race against this refresh. Do a follow-up read ~1s later so
      // the "inPipeline" gate drops and the edit form takes over the screen.
      const entries = Object.values(scopedProgress);
      const allCompleted =
        entries.length > 0 && entries.every((e) => e.stage === "completed");
      if (allCompleted) {
        setTimeout(() => {
          refresh({ preserveEdits: true }).catch(() => {});
        }, 1200);
      }
    }
  }, [scopedProgress, refresh]);

  const [refreshingManual, setRefreshingManual] = useState(false);
  async function handleManualRefresh() {
    setRefreshingManual(true);
    try {
      await refresh({ preserveEdits: true });
      setToast("已重新載入最新狀態");
    } finally {
      setRefreshingManual(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="w-6 h-6 text-primary animate-spin" />
      </div>
    );
  }

  if (error || !project) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-8">
        <p className="text-red-600">{error ?? "找不到專案"}</p>
        <button
          className="mt-4 text-sm text-primary hover:underline"
          onClick={() => navigate({ to: "/posters" })}
        >
          ← 返回列表
        </button>
      </div>
    );
  }

  // Pipeline still running → show live progress instead of the edit form.
  // Gate on status alone — `task_queue` flips the project to "processing"
  // when it picks up the first file and back to "draft" when all files are
  // done, so the status string is authoritative. (Earlier code also checked
  // `completed_files < total_files` as a fallback, but that mis-fires for
  // legacy drafts from before the counter started incrementing.)
  const inPipeline =
    project.status === "uploading" || project.status === "processing";

  if (inPipeline) {
    return (
      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-8 flex flex-col gap-6">
        {/* Header */}
        <div className="flex items-center gap-3">
          <button
            className="flex items-center justify-center w-9 h-9 rounded-lg border border-gray-300 hover:bg-gray-50 transition-colors"
            onClick={() => navigate({ to: "/posters" })}
          >
            <ChevronLeft className="w-5 h-5 text-gray-600" />
          </button>
          <div className="flex-1">
            <h1 className="text-xl font-bold text-gray-900">專案處理中</h1>
            <p className="text-sm text-gray-500">{project.id}</p>
          </div>
          <span
            className={`px-3 py-1 text-xs font-medium rounded-full ${statusBadge[project.status] ?? "bg-gray-100 text-gray-600"}`}
          >
            {statusLabel[project.status] ?? project.status}
          </span>
        </div>

        <ProjectProgressPanel
          projectId={project.id}
          projectName={project.name}
          fileNames={files.map((f) => f.file_name)}
          qwenpawProgress={scopedProgress}
          footer={
            <div className="p-4 rounded-lg bg-blue-50 text-sm text-blue-900">
              <p className="font-medium mb-1">處理完成後就能編輯</p>
              <p className="text-blue-800">
                每個檔案依序跑：下載 → 中繼資料 → 縮圖 → AI 分析（本機 VLM）。
                完成後此頁會自動切換成編輯表單。
              </p>
            </div>
          }
          actions={
            <>
              <Link
                to="/posters"
                className="px-5 py-2.5 text-sm font-medium text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
              >
                返回海報列表
              </Link>
              <button
                onClick={async () => {
                  // Refresh project status from DB; if processing now done,
                  // the conditional above drops us back into the edit form.
                  try {
                    const [proj, fileList] = await invoke<
                      [Project, ProjectFile[]]
                    >("get_project", { projectId });
                    setProject(proj);
                    setFiles(fileList);
                  } catch (err) {
                    console.error("refresh failed:", err);
                  }
                }}
                className="px-5 py-2.5 text-sm font-medium text-white bg-primary rounded-lg hover:bg-primary-light transition-colors cursor-pointer"
              >
                重新整理狀態
              </button>
            </>
          }
        />
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-8 flex flex-col gap-6">
      {/* Toast */}
      {toast && (
        <div className="fixed top-6 right-6 z-50 bg-emerald-600 text-white px-5 py-3 rounded-lg shadow-lg text-sm font-medium">
          {toast}
        </div>
      )}

      {/* Header */}
      <div className="flex items-center gap-3">
        <button
          className="flex items-center justify-center w-9 h-9 rounded-lg border border-gray-300 hover:bg-gray-50 transition-colors"
          onClick={() => navigate({ to: "/posters" })}
        >
          <ChevronLeft className="w-5 h-5 text-gray-600" />
        </button>
        <div className="flex-1">
          <h1 className="text-xl font-bold text-gray-900">編輯專案</h1>
          <p className="text-sm text-gray-500">{project.id}</p>
        </div>
        <span
          className={`px-3 py-1 text-xs font-medium rounded-full ${statusBadge[project.status] ?? "bg-gray-100 text-gray-600"}`}
        >
          {statusLabel[project.status] ?? project.status}
        </span>
      </div>

      {/* Project info card */}
      <div className="card-box">
        <h2 className="text-base font-semibold text-primary mb-4">專案資訊</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className={labelClass}>專案名稱</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={inputClass}
            />
          </div>
          <div>
            <label className={labelClass}>建立者</label>
            <input
              type="text"
              value={project.created_by ?? "—"}
              disabled
              className={`${inputClass} bg-gray-50 text-gray-500 cursor-not-allowed`}
            />
          </div>
          <div className="sm:col-span-2">
            <label className={labelClass}>描述</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              className={inputClass}
              placeholder="輸入專案描述..."
            />
          </div>
        </div>
      </div>

      {/* Files card */}
      <div className="card-box">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-semibold text-primary">
            檔案列表（{files.length}）
          </h2>
          <span className="text-xs text-gray-400">
            已完成 {project.completed_files} / {project.total_files}
          </span>
        </div>

        {files.length === 0 ? (
          <p className="text-sm text-gray-400 py-4">此專案尚無檔案</p>
        ) : (
          <div className="flex flex-col gap-4">
            {files.map((f) => {
              const meta = fileEdits[f.id] ?? {};
              const ai = tryParse<AiAnalysis>(f.ai_analysis);
              const tech = tryParse<FileTechMeta>(f.metadata_json);
              const thumbUrl = f.thumbnail_path
                ? `${THUMBNAIL_PUBLIC_URL_PREFIX}/${f.thumbnail_path}`
                : null;
              return (
                <div
                  key={f.id}
                  className="border border-gray-200 rounded-xl p-4"
                >
                  {/* File header */}
                  <div className="flex items-center gap-3 mb-3">
                    {thumbUrl ? (
                      <img
                        src={thumbUrl}
                        alt={f.file_name}
                        className="w-14 h-14 rounded-lg object-cover shrink-0 border border-gray-200 bg-gray-50"
                        loading="lazy"
                        onError={(e) => {
                          (e.currentTarget as HTMLImageElement).style.display =
                            "none";
                        }}
                      />
                    ) : (
                      <div className="w-14 h-14 bg-primary/10 rounded-lg flex items-center justify-center shrink-0">
                        <FileIcon className="w-5 h-5 text-primary" />
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-900 truncate">
                        {f.file_name}
                      </p>
                      <p className="text-xs text-gray-400">
                        {fileTypeLabel[f.file_type] ?? f.file_type} ·{" "}
                        {formatFileSize(f.file_size)} ·{" "}
                        <span
                          className={
                            f.processing_status === "completed"
                              ? "text-emerald-600"
                              : !f.storage_path
                                ? "text-amber-600"
                                : f.processing_status === "pending"
                                  ? "text-indigo-600"
                                  : f.processing_status === "failed"
                                    ? "text-red-600"
                                    : ""
                          }
                        >
                          {!f.storage_path
                            ? "尚未上傳"
                            : f.processing_status === "pending"
                              ? "等待處理"
                              : f.processing_status === "completed"
                                ? "已完成"
                                : f.processing_status === "failed"
                                  ? "處理失敗"
                                  : f.processing_status}
                        </span>
                      </p>
                    </div>
                    {f.storage_path ? (
                      <button
                        type="button"
                        disabled={
                          !!reprocessing[f.id] ||
                          f.processing_status === "processing"
                        }
                        onClick={() => handleReprocess(f.id)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-indigo-700 bg-indigo-50 border border-indigo-200 rounded-lg hover:bg-indigo-100 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        title="重新跑本機 VLM 分析 + 縮圖 + metadata"
                      >
                        {reprocessing[f.id] ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <RefreshCw className="w-3.5 h-3.5" />
                        )}
                        {ai || tech ? "重新分析" : "開始 AI 處理"}
                      </button>
                    ) : (
                      <span
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-amber-700 bg-amber-50 border border-amber-200 rounded-lg"
                        title="原始檔尚未上傳到 Supabase Storage — 請回到上傳頁補上傳完成"
                      >
                        尚未上傳
                      </span>
                    )}
                  </div>

                  {/* Tech metadata (EXIF / dims / DPI) — read-only from Rust pipeline */}
                  <div className="mb-3 border border-gray-100 rounded-lg bg-gray-50/60 p-3">
                    <h3 className="flex items-center gap-1.5 text-xs font-semibold text-gray-600 uppercase tracking-wide mb-2">
                      <FileIcon className="w-3.5 h-3.5" />
                      檔案資訊
                    </h3>
                    {tech ? (
                      <>
                        <dl className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-1 text-xs text-gray-700">
                          <MetaCell k="格式" v={tech.format} />
                          <MetaCell k="色彩模式" v={tech.mode} />
                          <MetaCell
                            k="尺寸"
                            v={
                              tech.width && tech.height
                                ? `${tech.width} × ${tech.height} px`
                                : undefined
                            }
                          />
                          <MetaCell
                            k="DPI"
                            v={
                              tech.dpi_x || tech.dpi_y
                                ? `${tech.dpi_x ?? "?"} × ${tech.dpi_y ?? "?"}`
                                : undefined
                            }
                          />
                        </dl>
                        {tech.error && (
                          <p className="text-xs text-amber-600 mt-1">
                            {tech.error}
                          </p>
                        )}
                      </>
                    ) : (
                      <p className="text-xs text-gray-400">
                        尚未處理 — 點右上「開始 AI 處理」抓取檔案資訊
                      </p>
                    )}
                  </div>

                  {/* AI analysis — read-only from local VLM pipeline */}
                  <div className="mb-3 border border-indigo-100 rounded-lg bg-indigo-50/50 p-3">
                    <h3 className="flex items-center gap-1.5 text-xs font-semibold text-indigo-700 uppercase tracking-wide mb-2">
                      <Sparkles className="w-3.5 h-3.5" />
                      AI 分析
                    </h3>
                    {!ai ? (
                      <p className="text-xs text-gray-400">
                        尚未分析 — 點右上「開始 AI 處理」讓本機 VLM 產生圖說、主題與 OCR
                      </p>
                    ) : ai.error && !ai.description ? (
                      <p className="text-xs text-amber-700">
                        尚未取得 AI 結果（{ai.error}）
                      </p>
                    ) : (
                      <div className="space-y-2">
                        {ai.description && (
                          <p className="text-sm text-gray-800 leading-relaxed">
                            {ai.description}
                          </p>
                        )}
                          <div className="flex flex-wrap items-center gap-1.5">
                            {ai.themes?.map((t) => (
                              <span
                                key={t}
                                className="px-2 py-0.5 rounded-full text-xs bg-white border border-indigo-200 text-indigo-700"
                              >
                                {t}
                              </span>
                            ))}
                            {ai.language && (
                              <span className="px-2 py-0.5 rounded-full text-xs bg-white border border-gray-200 text-gray-600">
                                {ai.language}
                              </span>
                            )}
                            {ai.has_logo && (
                              <span className="px-2 py-0.5 rounded-full text-xs bg-white border border-amber-200 text-amber-700">
                                含 logo
                              </span>
                            )}
                            {ai.has_person && (
                              <span className="px-2 py-0.5 rounded-full text-xs bg-white border border-pink-200 text-pink-700">
                                含人物
                              </span>
                            )}
                          </div>
                        {ai.scores && (
                          <div className="mt-2 grid grid-cols-2 sm:grid-cols-5 gap-1.5">
                            {SCORE_LABELS.map(({ key, label }) => {
                              const v = ai.scores?.[key];
                              if (v == null) return null;
                              return (
                                <div
                                  key={key}
                                  className={`flex items-center justify-between px-2 py-1 border rounded text-xs ${scoreColor(v)}`}
                                >
                                  <span>{label}</span>
                                  <span className="font-mono font-semibold">{v}</span>
                                </div>
                              );
                            })}
                          </div>
                        )}
                        {ai.suggestions && (
                          <div className="mt-2 p-2 border border-amber-100 bg-amber-50/50 rounded text-xs text-amber-900 leading-relaxed">
                            <span className="font-semibold">💡 審核建議：</span>
                            {ai.suggestions}
                          </div>
                        )}
                        {ai.ocr_text && (
                          <details className="mt-2">
                            <summary className="text-xs text-gray-600 cursor-pointer inline-flex items-center gap-1">
                              <FileText className="w-3.5 h-3.5" />
                              OCR 文字（點擊展開）
                            </summary>
                            <pre className="mt-1 p-2 bg-white border border-gray-100 rounded text-xs whitespace-pre-wrap text-gray-700">
                              {ai.ocr_text}
                            </pre>
                          </details>
                        )}
                      </div>
                    )}
                  </div>

                  {/* File metadata edits */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">
                        標題
                      </label>
                      <input
                        type="text"
                        value={meta.title ?? ""}
                        onChange={(e) =>
                          updateFileMeta(f.id, "title", e.target.value)
                        }
                        className={inputClass}
                        placeholder="檔案標題"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">
                        分類
                      </label>
                      <input
                        type="text"
                        value={meta.category ?? ""}
                        onChange={(e) =>
                          updateFileMeta(f.id, "category", e.target.value)
                        }
                        className={inputClass}
                        placeholder="例如：活動海報、宣導海報"
                      />
                    </div>
                    <div className="sm:col-span-2">
                      <label className="block text-xs text-gray-500 mb-1">
                        描述
                      </label>
                      <input
                        type="text"
                        value={meta.description ?? ""}
                        onChange={(e) =>
                          updateFileMeta(f.id, "description", e.target.value)
                        }
                        className={inputClass}
                        placeholder="檔案描述"
                      />
                    </div>
                    <div className="sm:col-span-2">
                      <label className="block text-xs text-gray-500 mb-1">
                        關鍵字（逗號分隔）
                      </label>
                      <input
                        type="text"
                        value={(meta.keywords ?? []).join(", ")}
                        onChange={(e) =>
                          updateFileMeta(f.id, "keywords", e.target.value)
                        }
                        className={inputClass}
                        placeholder="例如：環保, 回收, 2024"
                      />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Action bar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-xs text-gray-500">
          {project.status === "pending_review" && (
            <span className="inline-flex items-center gap-1.5 text-amber-700">
              <Check className="w-3.5 h-3.5" />
              已送出審核，等待審核人員處理
            </span>
          )}
          {project.status === "published" && (
            <span className="inline-flex items-center gap-1.5 text-emerald-700">
              <Check className="w-3.5 h-3.5" />
              已核可上架
            </span>
          )}
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            className="flex items-center gap-2 bg-white border border-gray-300 text-gray-700 rounded-lg px-4 py-2.5 text-sm font-medium hover:bg-gray-50 transition-colors disabled:opacity-50"
            disabled={saving || submitting || refreshingManual}
            onClick={handleManualRefresh}
            title="重新從本機資料庫讀取檔案資訊與 AI 圖說"
          >
            {refreshingManual ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <RotateCcw className="w-4 h-4" />
            )}
            重新載入
          </button>
          <button
            className="flex items-center gap-2 bg-white border border-gray-300 text-gray-700 rounded-lg px-5 py-2.5 text-sm font-medium hover:bg-gray-50 transition-colors disabled:opacity-50"
            disabled={saving || submitting}
            onClick={handleSave}
          >
            {saving ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Save className="w-4 h-4" />
            )}
            {saving ? "儲存中..." : "儲存變更"}
          </button>
          {project.status !== "pending_review" &&
            project.status !== "published" &&
            project.status !== "archived" && (
              <button
                className="flex items-center gap-2 bg-primary text-white rounded-lg px-6 py-2.5 text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
                disabled={saving || submitting}
                onClick={handleSubmitForReview}
              >
                {submitting ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Send className="w-4 h-4" />
                )}
                {submitting ? "送出中..." : "提交審核"}
              </button>
            )}
        </div>
      </div>
    </div>
  );
}

function MetaCell({
  k,
  v,
}: {
  k: string;
  v?: string | number;
}) {
  return (
    <div className="flex flex-col">
      <dt className="text-[10px] text-gray-400 uppercase tracking-wide">{k}</dt>
      <dd className="text-gray-800">{v ?? "—"}</dd>
    </div>
  );
}
