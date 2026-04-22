import { Check, Loader2, X } from "lucide-react";
import type { ProcessingStage } from "../hooks/useQwenpawProgress";

export const QWENPAW_STAGE_LABEL: Record<ProcessingStage, string> = {
  download: "下載中",
  metadata: "擷取資訊",
  thumbnail: "產生縮圖",
  analysis: "AI 分析",
  completed: "處理完成",
  failed: "處理失敗",
};

export const PIPELINE_STAGES: { key: ProcessingStage; label: string }[] = [
  { key: "download", label: "下載" },
  { key: "metadata", label: "中繼資料" },
  { key: "thumbnail", label: "縮圖" },
  { key: "analysis", label: "AI 分析" },
  { key: "completed", label: "完成" },
];

export const STAGE_INDEX: Record<ProcessingStage, number> = {
  download: 0,
  metadata: 1,
  thumbnail: 2,
  analysis: 3,
  completed: 4,
  failed: -1,
};

export interface ProjectProgressPanelProps {
  projectId: string | null;
  projectName: string;
  /** Canonical file names to show when qwenpawProgress is empty. */
  fileNames: string[];
  /** Live pipeline events keyed by file_id (from `useQwenpawProgress`). */
  qwenpawProgress: Record<
    string,
    { file_id: string; stage: ProcessingStage; message: string }
  >;
  /** Optional action bar (e.g. "繼續上傳" / "返回列表"). Rendered below the panel. */
  actions?: React.ReactNode;
  /** Optional hint shown below the pipeline. */
  footer?: React.ReactNode;
}

export function ProjectProgressPanel({
  projectId,
  projectName,
  fileNames,
  qwenpawProgress,
  actions,
  footer,
}: ProjectProgressPanelProps) {
  const entries = Object.values(qwenpawProgress);
  const rows =
    entries.length > 0
      ? entries.map((p) => ({
          fileId: p.file_id,
          label: fileNames[0] ?? p.file_id.slice(0, 8),
          stage: p.stage as ProcessingStage,
          message: p.message,
        }))
      : fileNames.map((name, i) => ({
          fileId: `placeholder-${i}`,
          label: name,
          stage: "download" as ProcessingStage,
          message: "等待後端處理…",
        }));

  const totalSteps = PIPELINE_STAGES.length * Math.max(rows.length, 1);
  const doneSteps = rows.reduce((sum, r) => {
    const idx = STAGE_INDEX[r.stage];
    return sum + Math.max(0, idx);
  }, 0);
  const overallPct =
    totalSteps > 0 ? Math.round((doneSteps / totalSteps) * 100) : 0;

  const allComplete =
    rows.length > 0 && rows.every((r) => r.stage === "completed");
  const anyFailed = rows.some((r) => r.stage === "failed");

  return (
    <div className="card-box">
      <header className="flex items-start justify-between mb-5">
        <div>
          <h2 className="text-xl font-bold text-gray-800 mb-1 flex items-center gap-2">
            <Loader2
              className={`w-5 h-5 text-primary ${
                allComplete ? "hidden" : "animate-spin"
              }`}
            />
            {allComplete ? (
              <Check className="w-5 h-5 text-emerald-600" />
            ) : null}
            {allComplete
              ? "專案處理完成"
              : anyFailed
                ? "部分檔案處理失敗"
                : "專案處理中…"}
          </h2>
          <p className="text-sm text-gray-500">
            {projectName || "（未命名專案）"}
            {projectId && (
              <span className="ml-2 text-xs text-gray-400">
                ID: {projectId.slice(0, 8)}
              </span>
            )}
          </p>
        </div>
        <div className="text-right">
          <div className="text-2xl font-bold text-primary">{overallPct}%</div>
          <div className="text-xs text-gray-500">
            {rows.filter((r) => r.stage === "completed").length}/{rows.length}{" "}
            檔案完成
          </div>
        </div>
      </header>

      <div className="h-2 bg-gray-100 rounded-full overflow-hidden mb-6">
        <div
          className={`h-full transition-all duration-500 ${
            allComplete
              ? "bg-emerald-500"
              : anyFailed
                ? "bg-amber-500"
                : "bg-primary"
          }`}
          style={{ width: `${overallPct}%` }}
        />
      </div>

      <div className="space-y-4">
        {rows.map((row) => (
          <FilePipelineRow
            key={row.fileId}
            label={row.label}
            stage={row.stage}
            message={row.message}
          />
        ))}
      </div>

      {footer && <div className="mt-6">{footer}</div>}
      {actions && (
        <div className="flex items-center justify-end gap-3 mt-6">{actions}</div>
      )}
    </div>
  );
}

export function FilePipelineRow({
  label,
  stage,
  message,
}: {
  label: string;
  stage: ProcessingStage;
  message: string;
}) {
  const currentIdx = STAGE_INDEX[stage];
  const isFailed = stage === "failed";

  return (
    <div className="border border-gray-200 rounded-lg p-3">
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-medium text-gray-800 truncate">
          {label}
        </span>
        <span
          className={`text-xs px-2 py-0.5 rounded-full ${
            isFailed
              ? "bg-red-100 text-red-700"
              : stage === "completed"
                ? "bg-emerald-100 text-emerald-700"
                : "bg-blue-50 text-blue-700"
          }`}
        >
          {QWENPAW_STAGE_LABEL[stage] ?? stage}
        </span>
      </div>

      <ol className="flex items-center gap-1">
        {PIPELINE_STAGES.map((s, i) => {
          const done = !isFailed && currentIdx >= i;
          const active =
            !isFailed && currentIdx === i && stage !== "completed";
          return (
            <li key={s.key} className="flex-1 flex items-center gap-1">
              <span
                className={`flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-xs transition-colors ${
                  isFailed
                    ? "bg-red-100 text-red-700"
                    : done
                      ? "bg-emerald-500 text-white"
                      : active
                        ? "bg-blue-500 text-white"
                        : "bg-gray-100 text-gray-400"
                }`}
                title={s.label}
              >
                {isFailed ? (
                  <X className="w-3.5 h-3.5" />
                ) : done && !active ? (
                  <Check className="w-3.5 h-3.5" />
                ) : active ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  i + 1
                )}
              </span>
              <span
                className={`text-xs hidden sm:block ${
                  active ? "text-blue-700 font-medium" : "text-gray-500"
                }`}
              >
                {s.label}
              </span>
              {i < PIPELINE_STAGES.length - 1 && (
                <span
                  className={`flex-1 h-0.5 ${
                    done ? "bg-emerald-300" : "bg-gray-200"
                  }`}
                />
              )}
            </li>
          );
        })}
      </ol>

      {message && (
        <p
          className={`text-xs mt-2 ${
            isFailed ? "text-red-600" : "text-gray-500"
          }`}
        >
          {message}
        </p>
      )}
    </div>
  );
}
