import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState, useCallback, useEffect, useRef } from "react";
import {
  ChevronRight,
  CloudUpload,
  Check,
  X,
  Trash2,
  Pause,
  Play,
  AlertTriangle,
  Loader2,
} from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { useTauriUpload, UploadProgress } from "../../hooks/useTauriUpload";
import { useQwenpawProgress, ProcessingStage } from "../../hooks/useQwenpawProgress";
import {
  ProjectProgressPanel,
  QWENPAW_STAGE_LABEL,
} from "../../components/ProjectProgressPanel";

export const Route = createFileRoute("/posters/upload")({
  component: UploadWizard,
});

type Step = 1 | 2 | 3 | "complete";

interface SelectedFile {
  file_path: string;
  file_name: string;
  dimension: string;
  access: string;
}

const themes = [
  { name: "朔源", color: "bg-stone-100" },
  { name: "慈善", color: "bg-red-100" },
  { name: "醫療", color: "bg-blue-100" },
  { name: "教育", color: "bg-yellow-100" },
  { name: "人文", color: "bg-purple-100" },
  { name: "環保", color: "bg-green-100" },
  { name: "茹素護生", color: "bg-lime-100" },
  { name: "國際賑災", color: "bg-sky-100" },
  { name: "靜思語", color: "bg-cyan-100" },
  { name: "大事記", color: "bg-orange-100" },
  { name: "法華坡道", color: "bg-violet-100" },
  { name: "年度主題", color: "bg-pink-100" },
];

const steps = [
  { num: 1, label: "基本資訊" },
  { num: 2, label: "檔案上傳" },
  { num: 3, label: "主題關聯" },
];

function getFileExtension(name: string): string {
  const ext = name.split(".").pop()?.toUpperCase() ?? "";
  return ext;
}

function getFileTypeBadge(ext: string): { bg: string; color: string } {
  const map: Record<string, { bg: string; color: string }> = {
    PSD: { bg: "bg-pink-50", color: "text-pink-600" },
    AI: { bg: "bg-orange-50", color: "text-orange-600" },
    PDF: { bg: "bg-red-50", color: "text-red-600" },
    PNG: { bg: "bg-blue-50", color: "text-blue-600" },
    JPG: { bg: "bg-green-50", color: "text-green-600" },
    JPEG: { bg: "bg-green-50", color: "text-green-600" },
  };
  return map[ext] ?? { bg: "bg-gray-50", color: "text-gray-600" };
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
}

function formatSpeed(bps: number | null): string {
  if (!bps || bps <= 0) return "";
  return formatBytes(bps) + "/s";
}

// (Pipeline constants + ProjectProgressPanel now live in components/ProjectProgressPanel.tsx —
//  reused by the Edit page to show live progress when a project is still processing.)

function UploadWizard() {
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>(1);
  const [showResumeAlert, setShowResumeAlert] = useState(true);
  // Fire-once guard so a re-render after navigation doesn't spam navigate().
  const autoRedirectedRef = useRef(false);

  // Step 1 form state
  const [projectName, setProjectName] = useState("");
  const [category, setCategory] = useState("");
  const [dateStart, setDateStart] = useState("");
  const [dateEnd, setDateEnd] = useState("");
  const [locations, setLocations] = useState<string[]>([]);
  const [locationInput, setLocationInput] = useState("");
  const [publicDesc, setPublicDesc] = useState("");
  const [internalNote, setInternalNote] = useState("");

  // Step 2 file state
  const [selectedFiles, setSelectedFiles] = useState<SelectedFile[]>([]);
  const [createdProjectId, setCreatedProjectId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  // Step 3 theme state
  const [selectedThemes, setSelectedThemes] = useState<Set<string>>(new Set());

  // Upload hook
  const {
    allProgress,
    resumable,
    overallPercentage,
    completedCount,
    totalFiles: uploadTotalFiles,
    uploadFiles,
    resumeUploads,
  } = useTauriUpload();

  const { byFile: qwenpawProgress } = useQwenpawProgress();

  const handleOpenFilePicker = useCallback(async () => {
    try {
      const result = await open({
        multiple: true,
        directory: false,
        filters: [
          {
            name: "Image & Design Files",
            extensions: ["psd", "ai", "pdf", "png", "jpg", "jpeg"],
          },
        ],
      });
      if (result && Array.isArray(result)) {
        const newFiles: SelectedFile[] = result.map((filePath) => {
          const pathStr = typeof filePath === "string" ? filePath : filePath.path;
          const name = pathStr.split(/[\\/]/).pop() ?? pathStr;
          return {
            file_path: pathStr,
            file_name: name,
            dimension: "A0",
            access: "公開",
          };
        });
        setSelectedFiles((prev) => [...prev, ...newFiles]);
      } else if (result && typeof result === "object" && !Array.isArray(result)) {
        // Single file selected
        const pathStr = typeof result === "string" ? result : (result as any).path;
        const name = pathStr.split(/[\\/]/).pop() ?? pathStr;
        setSelectedFiles((prev) => [
          ...prev,
          { file_path: pathStr, file_name: name, dimension: "A0", access: "公開" },
        ]);
      }
    } catch (err) {
      console.error("File picker error:", err);
    }
  }, []);

  const removeFile = useCallback((index: number) => {
    setSelectedFiles((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const updateFileDimension = useCallback((index: number, dimension: string) => {
    setSelectedFiles((prev) =>
      prev.map((f, i) => (i === index ? { ...f, dimension } : f))
    );
  }, []);

  const updateFileAccess = useCallback((index: number, access: string) => {
    setSelectedFiles((prev) =>
      prev.map((f, i) => (i === index ? { ...f, access } : f))
    );
  }, []);

  const handleAddLocation = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && locationInput.trim()) {
      e.preventDefault();
      setLocations((prev) => [...prev, locationInput.trim()]);
      setLocationInput("");
    }
  };

  const removeLocation = (index: number) => {
    setLocations((prev) => prev.filter((_, i) => i !== index));
  };

  const toggleTheme = (name: string) => {
    setSelectedThemes((prev) => {
      const next = new Set(prev);
      next.has(name) ? next.delete(name) : next.add(name);
      return next;
    });
  };

  const handleResumeUploads = async () => {
    try {
      await resumeUploads();
      setShowResumeAlert(false);
    } catch (err) {
      console.error("Resume failed:", err);
    }
  };

  const handleConfirmUpload = async () => {
    if (!projectName.trim()) {
      alert("請輸入專案名稱");
      return;
    }

    setUploading(true);
    setUploadError(null);

    try {
      // Step 1: Create project if not already created
      let projectId = createdProjectId;
      if (!projectId) {
        const project = await invoke<any>("create_project", {
          input: {
            name: projectName,
            description: publicDesc || undefined,
            files: selectedFiles.map((f) => ({
              file_path: f.file_path,
              file_name: f.file_name,
            })),
          },
        });
        projectId =
          typeof project === "string" ? JSON.parse(project).id : project.id;
        setCreatedProjectId(projectId);
      }

      // Step 2: Upload files via TUS
      if (selectedFiles.length > 0 && projectId) {
        const items = selectedFiles.map((f) => ({
          file_path: f.file_path,
          poster_id: projectId!,
          original_filename: f.file_name,
        }));
        await uploadFiles(items);
      }

      setStep("complete");
    } catch (err) {
      console.error("Upload failed:", err);
      setUploadError(typeof err === "string" ? err : "上傳失敗，請稍後再試");
    } finally {
      setUploading(false);
    }
  };

  const goNext = () => {
    if (step === 1) {
      if (!projectName.trim()) {
        alert("請輸入專案名稱");
        return;
      }
      if (!category) {
        alert("請選擇品項分類");
        return;
      }
      setStep(2);
    } else if (step === 2) setStep(3);
    else if (step === 3) handleConfirmUpload();
  };

  const goPrev = () => {
    if (step === 2) setStep(1);
    else if (step === 3) setStep(2);
  };

  // Merge selected files with live upload progress
  const filesWithProgress = selectedFiles.map((f) => {
    const prog = allProgress.find(
      (p) => p.file_name === f.file_name || p.upload_id === f.file_path
    );
    return { ...f, progress: prog };
  });

  const hasResumable = resumable.length > 0;

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8">
      {/* Breadcrumb */}
      <nav className="flex items-center gap-1.5 text-sm text-gray-500 mb-4">
        <Link to="/posters" className="hover:text-primary transition-colors">
          海報管理
        </Link>
        <ChevronRight className="w-3.5 h-3.5" />
        <span className="text-primary font-medium">新增海報</span>
      </nav>

      {/* Title */}
      <h1 className="text-2xl font-bold text-primary mb-8">新增海報</h1>

      {/* Step Indicator */}
      {step !== "complete" && (
        <div className="flex items-center justify-center mb-10">
          {steps.map((s, i) => {
            const isActive = step === s.num;
            const isDone = typeof step === "number" && step > s.num;
            return (
              <div key={s.num} className="flex items-center">
                {i > 0 && (
                  <div
                    className={`flex-1 min-w-[60px] h-[2px] ${
                      isDone || isActive ? "bg-primary" : "bg-gray-200"
                    }`}
                  />
                )}
                <div className="flex flex-col items-center gap-1.5">
                  <div
                    className={`w-9 h-9 rounded-full flex items-center justify-center text-sm font-semibold ${
                      isDone
                        ? "bg-primary text-white"
                        : isActive
                          ? "bg-primary text-white"
                          : "bg-gray-200 text-gray-500"
                    }`}
                  >
                    {isDone ? <Check className="w-4 h-4" /> : s.num}
                  </div>
                  <span
                    className={`text-xs whitespace-nowrap ${
                      isActive || isDone
                        ? "text-primary font-medium"
                        : "text-gray-400"
                    }`}
                  >
                    {s.label}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Step 1 - 基本資訊 */}
      {step === 1 && (
        <div className="card-box">
          <h2 className="text-lg font-semibold text-gray-800 mb-6">基本資訊</h2>
          <div className="space-y-5">
            {/* 上架編號 */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">
                上架編號
              </label>
              <input
                type="text"
                readOnly
                value="(自動產生)"
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg bg-gray-100 text-gray-500 cursor-not-allowed"
              />
            </div>

            {/* 專案名稱 */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">
                專案名稱 <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                placeholder="請輸入專案名稱"
                value={projectName}
                onChange={(e) => setProjectName(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
              />
            </div>

            {/* 品項分類 */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">
                品項分類 <span className="text-red-500">*</span>
              </label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
              >
                <option value="">請選擇</option>
                <option>海報</option>
                <option>展板</option>
                <option>布條</option>
                <option>旗幟</option>
                <option>其他</option>
              </select>
            </div>

            {/* 展覽時間 */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">
                展覽時間
              </label>
              <div className="flex items-center gap-3">
                <input
                  type="date"
                  value={dateStart}
                  onChange={(e) => setDateStart(e.target.value)}
                  className="flex-1 px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                />
                <span className="text-gray-400">~</span>
                <input
                  type="date"
                  value={dateEnd}
                  onChange={(e) => setDateEnd(e.target.value)}
                  className="flex-1 px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                />
              </div>
            </div>

            {/* 展覽地點 */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">
                展覽地點
              </label>
              <div className="flex flex-wrap items-center gap-2 px-3 py-2 border border-gray-200 rounded-lg min-h-[42px]">
                {locations.map((loc, idx) => (
                  <span
                    key={idx}
                    className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[13px] bg-indigo-100 text-primary"
                  >
                    {loc}
                    <button
                      onClick={() => removeLocation(idx)}
                      className="hover:text-red-500 cursor-pointer"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </span>
                ))}
                <input
                  type="text"
                  placeholder="輸入地點後按 Enter"
                  value={locationInput}
                  onChange={(e) => setLocationInput(e.target.value)}
                  onKeyDown={handleAddLocation}
                  className="flex-1 min-w-[120px] text-sm outline-none border-none"
                />
              </div>
            </div>

            {/* 公開說明 */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">
                公開說明
              </label>
              <textarea
                rows={3}
                placeholder="此說明會顯示在前台"
                value={publicDesc}
                onChange={(e) => setPublicDesc(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary resize-none"
              />
            </div>

            {/* 內部備註 */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">
                內部備註
              </label>
              <textarea
                rows={2}
                placeholder="僅內部可見"
                value={internalNote}
                onChange={(e) => setInternalNote(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary resize-none"
              />
            </div>
          </div>
        </div>
      )}

      {/* Step 2 - 檔案上傳 */}
      {step === 2 && (
        <div className="card-box">
          {/* Resume Alert */}
          {showResumeAlert && hasResumable && (
            <div className="mb-6 bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-amber-500 mt-0.5 shrink-0" />
              <div className="flex-1">
                <p className="text-sm font-medium text-amber-800">
                  有 {resumable.length} 個未完成的上傳
                </p>
                <ul className="mt-1 text-xs text-amber-700 space-y-0.5">
                  {resumable.map((r) => {
                    const pct =
                      r.total_bytes > 0
                        ? Math.round((r.uploaded_bytes / r.total_bytes) * 100)
                        : 0;
                    const name = r.file_path.split(/[\\/]/).pop() ?? r.file_path;
                    return (
                      <li key={r.id}>
                        {name} -- {r.status === "paused" ? "已暫停" : `${pct}%`}
                      </li>
                    );
                  })}
                </ul>
                <div className="mt-2 flex items-center gap-2">
                  <button
                    onClick={handleResumeUploads}
                    className="px-3 py-1.5 text-xs font-medium text-white bg-primary rounded-lg hover:bg-primary-light cursor-pointer"
                  >
                    繼續上傳
                  </button>
                  <button
                    onClick={() => setShowResumeAlert(false)}
                    className="px-3 py-1.5 text-xs font-medium text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50 cursor-pointer"
                  >
                    放棄
                  </button>
                </div>
              </div>
              <button
                onClick={() => setShowResumeAlert(false)}
                className="text-amber-400 hover:text-amber-600 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          )}

          <h2 className="text-lg font-semibold text-gray-800 mb-6">檔案上傳</h2>

          {/* Drag Zone */}
          <div
            onClick={handleOpenFilePicker}
            className="border-2 border-dashed border-gray-300 rounded-xl py-16 flex flex-col items-center justify-center gap-3 mb-6 hover:border-primary/40 transition-colors cursor-pointer"
          >
            <CloudUpload className="w-12 h-12 text-gray-300" />
            <p className="text-sm text-gray-500">
              拖拽檔案或資料夾到這裡，或
              <span className="text-primary underline cursor-pointer">
                點擊選擇
              </span>
            </p>
            <p className="text-xs text-gray-400">
              支援格式：PSD, AI, PDF, PNG, JPG
            </p>
          </div>

          {/* Stats Bar */}
          {(selectedFiles.length > 0 || uploadTotalFiles > 0) && (
            <div className="bg-gray-50 rounded-lg px-4 py-3 flex flex-wrap items-center justify-between gap-3 mb-4">
              <span className="text-sm text-gray-600">
                共 {selectedFiles.length} 個檔案
              </span>
              <div className="flex items-center gap-3">
                {uploadTotalFiles > 0 && (
                  <>
                    <span className="text-sm text-gray-600">
                      已完成 {completedCount}/{uploadTotalFiles}
                    </span>
                    <div className="w-32 h-2 bg-gray-200 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-primary rounded-full transition-all"
                        style={{ width: `${Math.round(overallPercentage)}%` }}
                      />
                    </div>
                    <span className="text-sm font-medium text-primary">
                      {Math.round(overallPercentage)}%
                    </span>
                  </>
                )}
              </div>
            </div>
          )}

          {/* Upload Error */}
          {uploadError && (
            <div className="mb-4 px-4 py-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-600">
              {uploadError}
            </div>
          )}

          {/* File List */}
          {filesWithProgress.length > 0 && (
            <div className="overflow-x-auto">
              {/* Header */}
              <div className="grid grid-cols-[1fr_90px_110px_100px_180px_40px] gap-2 px-3 py-2 text-xs font-medium text-gray-500 uppercase tracking-wider border-b border-gray-100">
                <span>檔案名稱</span>
                <span>大小</span>
                <span>尺寸</span>
                <span>存取等級</span>
                <span>上傳進度</span>
                <span />
              </div>

              {/* Rows */}
              {filesWithProgress.map((f, idx) => {
                const ext = getFileExtension(f.file_name);
                const badge = getFileTypeBadge(ext);
                const prog = f.progress;
                return (
                  <div
                    key={f.file_path + idx}
                    className="grid grid-cols-[1fr_90px_110px_100px_180px_40px] gap-2 items-center px-3 py-2.5 border-b border-gray-50 hover:bg-gray-50/50 transition-colors"
                  >
                    {/* File Name */}
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div
                        className={`w-8 h-8 rounded-lg ${badge.bg} flex items-center justify-center shrink-0`}
                      >
                        <span className={`text-[10px] font-bold ${badge.color}`}>
                          {ext}
                        </span>
                      </div>
                      <span className="text-sm text-gray-700 truncate">
                        {f.file_name}
                      </span>
                    </div>

                    {/* Size */}
                    <span className="text-sm text-gray-500">
                      {prog ? formatBytes(prog.total_bytes) : "--"}
                    </span>

                    {/* Dimension */}
                    <select
                      value={f.dimension}
                      onChange={(e) => updateFileDimension(idx, e.target.value)}
                      className="px-2 py-1 text-xs border border-gray-200 rounded bg-white"
                    >
                      <option>A0</option>
                      <option>A1</option>
                      <option>A2</option>
                      <option>A3</option>
                      <option>自訂</option>
                    </select>

                    {/* Access */}
                    <select
                      value={f.access}
                      onChange={(e) => updateFileAccess(idx, e.target.value)}
                      className="px-2 py-1 text-xs border border-gray-200 rounded bg-white"
                    >
                      <option>公開</option>
                      <option>內部</option>
                      <option>限定</option>
                    </select>

                    {/* Status */}
                    <div className="flex items-center gap-1.5">
                      {!prog && (
                        <span className="text-xs text-gray-400">待上傳</span>
                      )}
                      {prog?.status === "completed" && (() => {
                        const qp = prog.upload_id ? qwenpawProgress[prog.upload_id] : undefined;
                        if (!qp) {
                          return (
                            <span className="inline-flex items-center gap-1 text-xs text-emerald-600">
                              <Check className="w-3.5 h-3.5" />
                              已上傳
                            </span>
                          );
                        }
                        if (qp.stage === "completed") {
                          return (
                            <span className="inline-flex items-center gap-1 text-xs text-emerald-600">
                              <Check className="w-3.5 h-3.5" />
                              處理完成
                            </span>
                          );
                        }
                        if (qp.stage === "failed") {
                          return (
                            <span className="inline-flex items-center gap-1 text-xs text-red-500">
                              <X className="w-3.5 h-3.5" />
                              處理失敗
                            </span>
                          );
                        }
                        return (
                          <span className="inline-flex items-center gap-1 text-xs text-[#3b7db8]">
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            {QWENPAW_STAGE_LABEL[qp.stage]}
                          </span>
                        );
                      })()}
                      {prog?.status === "uploading" && (
                        <div className="flex items-center gap-2 w-full">
                          <div className="flex-1 h-1.5 bg-gray-200 rounded-full overflow-hidden">
                            <div
                              className="h-full bg-primary rounded-full transition-all"
                              style={{ width: `${prog.percentage}%` }}
                            />
                          </div>
                          <span className="text-xs text-gray-500 whitespace-nowrap">
                            {Math.round(prog.percentage)}%
                            {prog.speed_bps
                              ? ` · ${formatSpeed(prog.speed_bps)}`
                              : ""}
                          </span>
                        </div>
                      )}
                      {prog?.status === "paused" && (
                        <span className="inline-flex items-center gap-1.5 text-xs">
                          <span className="text-amber-600">已暫停</span>
                        </span>
                      )}
                      {prog?.status === "pending" && (
                        <span className="text-xs text-gray-400">排隊中</span>
                      )}
                      {prog?.status === "failed" && (
                        <span className="inline-flex items-center gap-1.5 text-xs">
                          <span className="inline-flex items-center gap-0.5 text-red-500">
                            <X className="w-3.5 h-3.5" />
                            失敗
                          </span>
                        </span>
                      )}
                    </div>

                    {/* Delete */}
                    <button
                      onClick={() => removeFile(idx)}
                      className="text-gray-300 hover:text-red-500 cursor-pointer"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Step 3 - 主題關聯 */}
      {step === 3 && (
        <div className="card-box">
          <h2 className="text-lg font-semibold text-gray-800 mb-1">
            選擇相關主題
          </h2>
          <p className="text-sm text-gray-500 mb-6">
            為海報標記相關主題，方便前台分類瀏覽
          </p>

          {/* Selected Tags */}
          <div className="flex flex-wrap gap-2 mb-6">
            {themes
              .filter((t) => selectedThemes.has(t.name))
              .map((t) => (
                <span
                  key={t.name}
                  className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[13px] bg-indigo-100 text-primary"
                >
                  {t.name}
                  <button
                    onClick={() => toggleTheme(t.name)}
                    className="hover:text-red-500 cursor-pointer"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </span>
              ))}
          </div>

          {/* Theme Grid */}
          <div className="grid grid-cols-3 gap-3">
            {themes.map((t) => {
              const checked = selectedThemes.has(t.name);
              return (
                <label
                  key={t.name}
                  className={`flex items-center gap-3 px-4 py-3 rounded-lg border cursor-pointer transition-colors ${
                    checked
                      ? "border-primary/30 bg-primary/5"
                      : "border-gray-200 hover:bg-gray-50"
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleTheme(t.name)}
                    className="accent-primary"
                  />
                  <div className="flex items-center gap-2">
                    <span
                      className={`w-3 h-3 rounded-full ${t.color}`}
                    />
                    <span className="text-sm text-gray-700">{t.name}</span>
                  </div>
                </label>
              );
            })}
          </div>
        </div>
      )}

      {/* Complete Screen — live project processing progress */}
      {step === "complete" && (() => {
        const allComplete =
          Object.values(qwenpawProgress).length > 0 &&
          Object.values(qwenpawProgress).every((p) => p.stage === "completed");

        // Auto-redirect to the edit page as soon as all files finish pipeline,
        // so the user never has to click "前往編輯" manually. The guard prevents
        // re-fires on subsequent renders once redirected.
        if (
          allComplete &&
          createdProjectId &&
          !autoRedirectedRef.current
        ) {
          autoRedirectedRef.current = true;
          setTimeout(() => {
            navigate({
              to: "/posters/$projectId/edit",
              params: { projectId: createdProjectId },
            });
          }, 400);
        }
        const reset = () => {
          setStep(1);
          setShowResumeAlert(true);
          setSelectedFiles([]);
          setProjectName("");
          setCategory("");
          setDateStart("");
          setDateEnd("");
          setLocations([]);
          setPublicDesc("");
          setInternalNote("");
          setSelectedThemes(new Set());
          setCreatedProjectId(null);
          setUploadError(null);
          autoRedirectedRef.current = false;
        };
        return (
          <ProjectProgressPanel
            projectId={createdProjectId}
            projectName={projectName}
            fileNames={selectedFiles.map((f) => f.file_name)}
            qwenpawProgress={qwenpawProgress}
            footer={
              <div className="p-4 rounded-lg bg-blue-50 text-sm text-blue-900">
                <p className="font-medium mb-1">處理完成後會做什麼？</p>
                <ul className="list-disc pl-5 space-y-0.5 text-blue-800">
                  <li>每個檔案依序跑：下載 → 中繼資料 (EXIF/W×H/DPI) → 縮圖 → AI 分析 (OCR + 圖說)</li>
                  <li>完成後會自動跳到編輯頁面，讓你檢視 AI 結果、補充欄位</li>
                  <li>確認內容後在編輯頁點「提交審核」，送給審核人員做核可 / 駁回</li>
                </ul>
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
                {createdProjectId ? (
                  <Link
                    to="/posters/$projectId/edit"
                    params={{ projectId: createdProjectId }}
                    className={`px-5 py-2.5 text-sm font-medium rounded-lg transition-colors ${
                      allComplete
                        ? "bg-emerald-600 text-white hover:bg-emerald-700"
                        : "bg-gray-100 text-gray-500 pointer-events-none"
                    }`}
                  >
                    {allComplete ? "前往編輯頁面 →" : "等待處理完成…"}
                  </Link>
                ) : null}
                <button
                  onClick={reset}
                  className="px-5 py-2.5 text-sm font-medium text-white bg-primary rounded-lg hover:bg-primary-light transition-colors cursor-pointer"
                >
                  繼續上傳
                </button>
              </>
            }
          />
        );
      })()}

      {/* Bottom Action Bar */}
      {step !== "complete" && (
        <div className="flex items-center justify-between mt-8 pb-8">
          <button
            onClick={goPrev}
            className={`px-5 py-2.5 text-sm font-medium text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors cursor-pointer ${
              step === 1 ? "invisible" : ""
            }`}
          >
            上一步
          </button>
          <button
            onClick={goNext}
            disabled={uploading}
            className="px-5 py-2.5 text-sm font-medium text-white bg-primary rounded-lg hover:bg-primary-light transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
          >
            {uploading && <Loader2 className="w-4 h-4 animate-spin" />}
            {step === 3
              ? uploading
                ? "上傳中..."
                : "確認上傳"
              : "下一步"}
          </button>
        </div>
      )}
    </div>
  );
}

