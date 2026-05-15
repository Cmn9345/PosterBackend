import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState, useEffect, useRef } from "react";
import {
  Check,
  Clock,
  Sparkles,
  ArrowRight,
  Download,
  AlertCircle,
  Loader2,
} from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { useAuthStore } from "../stores/authStore";

export const Route = createFileRoute("/onboarding")({
  component: Onboarding,
});

// Mirrors `commands::model_download::ModelStatus` (Rust).
interface ModelStatus {
  all_present: boolean;
  missing: string[];
  models_dir: string;
}

// Mirrors `commands::model_download::DownloadProgress` (Rust).
interface DownloadProgress {
  stage: "checking" | "downloading" | "renaming" | "complete" | "error";
  file_index: number;
  file_label: string;
  file_name: string;
  bytes_done: number;
  bytes_total: number;
  speed_bps: number;
  error: string | null;
}

type Step = "consent" | "model-download" | "complete";

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function formatSpeed(bps: number): string {
  return bps > 0 ? `${formatBytes(bps)}/s` : "—";
}

function formatEta(remainingBytes: number, bps: number): string {
  if (bps <= 0 || remainingBytes <= 0) return "—";
  const seconds = Math.ceil(remainingBytes / bps);
  if (seconds < 60) return `${seconds} 秒`;
  if (seconds < 3600) return `${Math.ceil(seconds / 60)} 分鐘`;
  return `${(seconds / 3600).toFixed(1)} 小時`;
}

function Onboarding() {
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const [step, setStep] = useState<Step>("consent");
  const [countdown, setCountdown] = useState(5);

  // Model download state — populated only when step === "model-download".
  const [progress, setProgress] = useState<DownloadProgress | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [downloadDone, setDownloadDone] = useState(false);
  const downloadStartedRef = useRef(false);

  useEffect(() => {
    if (step !== "consent") return;
    setCountdown(5);
    const timer = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          clearInterval(timer);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [step]);

  /**
   * Click handler for the 著作權 consent button. Probes the local model
   * cache first: if both GGUFs are already on disk (returning install), we
   * skip the download step entirely. Otherwise we transition into the
   * download progress UI.
   */
  const handleAgree = async () => {
    try {
      const status = await invoke<ModelStatus>("check_models");
      if (status.all_present) {
        setStep("complete");
      } else {
        setStep("model-download");
      }
    } catch (e) {
      // Tauri not available (e.g. running in web preview / Vite-only) or
      // disk error. Don't block onboarding — surface in console and proceed.
      console.error("[Onboarding] check_models failed:", e);
      setStep("complete");
    }
  };

  /**
   * When the user lands on the model-download step, start the download and
   * subscribe to the `model-download-progress` event for the progress bar.
   * Guard with a ref so React StrictMode's double-invoke doesn't fire two
   * concurrent downloads.
   */
  useEffect(() => {
    if (step !== "model-download") return;
    if (downloadStartedRef.current) return;
    downloadStartedRef.current = true;

    let unlisten: UnlistenFn | null = null;
    let cancelled = false;

    (async () => {
      try {
        unlisten = await listen<DownloadProgress>(
          "model-download-progress",
          (event) => {
            if (cancelled) return;
            setProgress(event.payload);
            if (event.payload.stage === "error" && event.payload.error) {
              setDownloadError(event.payload.error);
            }
          },
        );
        await invoke<void>("download_models_if_missing");
        if (!cancelled) setDownloadDone(true);
      } catch (e) {
        if (!cancelled) setDownloadError(String(e));
      }
    })();

    return () => {
      cancelled = true;
      if (unlisten) unlisten();
    };
  }, [step]);

  const primaryBtnClass =
    "flex items-center justify-center gap-2 w-full max-w-[380px] h-11 bg-primary text-white text-[15px] font-semibold rounded-[10px] hover:bg-primary-light disabled:opacity-40 disabled:cursor-not-allowed transition-colors";

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Simplified header */}
      <nav className="bg-white border-b border-gray-200 px-6 py-3 flex items-center justify-between sticky top-0 z-40">
        <div className="flex items-center gap-3">
          <img src="/tzuchi-logo.png" alt="慈濟" className="h-8 w-auto" />
          <span className="font-title font-semibold text-lg text-primary">
            海報資料庫後台
          </span>
        </div>
        <span className="text-sm text-gray-400">
          {step === "consent" && "首次登入 — 著作權同意"}
          {step === "model-download" && "首次登入 — AI 模型下載"}
          {step === "complete" && "首次登入 — 完成"}
        </span>
      </nav>

      <div className="max-w-2xl mx-auto px-4 sm:px-6 py-8">
        {/* Welcome banner */}
        {step === "consent" && (
          <div className="card-box text-center py-8 mb-8">
            <div className="w-14 h-14 bg-primary/10 rounded-full flex items-center justify-center mx-auto mb-4">
              <Sparkles className="w-7 h-7 text-primary" />
            </div>
            <h1 className="text-xl font-bold text-gray-900 mb-2">
              歡迎加入海報資料庫系統
            </h1>
            <p className="text-sm text-gray-500 mb-4">
              單位資料將由 GWS 整合後自動帶入，請先閱讀並同意著作權授權條款
            </p>
            <div className="inline-flex items-center gap-2 text-sm text-emerald-600 bg-emerald-50 px-4 py-2 rounded-full">
              <Check className="w-4 h-4" />
              已透過 Google 帳號驗證：{user?.email ?? "未登入"}
            </div>
          </div>
        )}

        {/* 著作權同意 */}
        {step === "consent" && (
          <div className="card-box">
            <div className="flex items-center gap-3 mb-6">
              <h2 className="text-lg font-bold text-gray-900">
                著作權授權同意書
              </h2>
            </div>

            <p className="text-sm text-gray-500 mb-4">
              請詳閱以下著作權授權同意書內容，閱讀完畢後方可按下「我同意」繼續。
            </p>

            <div className="border border-gray-200 rounded-xl overflow-hidden mb-6">
              <div className="bg-gray-50 px-5 py-3 border-b border-gray-200">
                <h3 className="text-sm font-semibold text-gray-700">
                  約定著作人同意書
                </h3>
              </div>
              <div className="px-5 py-4 max-h-[360px] overflow-y-auto text-sm text-gray-600 leading-relaxed space-y-4">
                <div>
                  <h4 className="font-semibold text-gray-800 mb-2">壹、前言</h4>
                  <p>
                    本人瞭解並同意，因參與慈濟基金會（以下簡稱「本會」）之採編工作所產出之著作（包括但不限於文字、照片、影音、圖表等），依據中華民國著作權法之相關規定，同意以下約定：
                  </p>
                </div>

                <div>
                  <h4 className="font-semibold text-gray-800 mb-2">
                    貳、著作權歸屬
                  </h4>
                  <p className="mb-2">
                    一、本人於執行本會採編任務期間所完成之著作，同意以本會為著作人，著作財產權及著作人格權均歸屬本會所有。
                  </p>
                  <p className="mb-2">
                    二、本人同意不對本會主張著作人格權，包括但不限於公開發表權、姓名表示權及同一性保持權。
                  </p>
                  <p>
                    三、本人保證所提供之著作為原創作品，未侵害任何第三人之智慧財產權或其他權利。如因著作內容涉及第三人權利爭議，由本人自負其責。
                  </p>
                </div>

                <div>
                  <h4 className="font-semibold text-gray-800 mb-2">
                    參、授權範圍
                  </h4>
                  <p className="mb-2">
                    一、本人同意本會得不限地域、不限期間、不限次數地利用上述著作，利用方式包括但不限於：重製、公開播送、公開傳輸、改作、編輯、出版、發行及其他一切著作財產權之行使。
                  </p>
                  <p className="mb-2">
                    二、本人同意本會得將上述著作授權予第三人使用，無須另行通知或取得本人同意。
                  </p>
                  <p>
                    三、本人同意本會基於推廣慈濟志業之目的，得將著作用於網站、出版品、展覽、多媒體及其他傳播媒介。
                  </p>
                </div>

                <div>
                  <h4 className="font-semibold text-gray-800 mb-2">
                    肆、個人資料之蒐集與利用
                  </h4>
                  <p className="mb-2">
                    一、本人同意本會於採編作業必要範圍內，蒐集、處理及利用本人之姓名、聯絡資訊及其他必要之個人資料。
                  </p>
                  <p>
                    二、本會承諾依個人資料保護法之規定妥善保管及利用前述個人資料，並於目的消失後依法處理。
                  </p>
                </div>

                <div>
                  <h4 className="font-semibold text-gray-800 mb-2">
                    伍、其他約定
                  </h4>
                  <p className="mb-2">
                    一、本同意書自簽署之日起生效，持續有效至本人以書面通知本會終止為止。惟終止前已完成之著作，仍適用本同意書之約定。
                  </p>
                  <p className="mb-2">
                    二、本同意書之解釋與適用，以中華民國法律為準據法。如有爭議，雙方同意以臺灣花蓮地方法院為第一審管轄法院。
                  </p>
                  <p>
                    三、本人已充分閱讀並理解本同意書之全部內容，同意遵守上述各項約定。
                  </p>
                </div>
              </div>
            </div>

            {countdown > 0 ? (
              <div className="flex items-center gap-2 text-sm text-amber-600 mb-6">
                <Clock className="w-4 h-4 animate-pulse" />
                請閱讀同意書，{countdown} 秒後可按下同意
              </div>
            ) : (
              <div className="flex items-center gap-2 text-sm text-emerald-600 mb-6">
                <Check className="w-4 h-4" />
                您已可按下「我同意」繼續
              </div>
            )}

            <div className="flex justify-end">
              <button
                className={primaryBtnClass}
                disabled={countdown > 0}
                onClick={handleAgree}
              >
                我同意
              </button>
            </div>
          </div>
        )}

        {/* AI 模型下載 */}
        {step === "model-download" && (
          <ModelDownloadStep
            progress={progress}
            error={downloadError}
            done={downloadDone}
            onContinue={() => setStep("complete")}
            onRetry={() => {
              setDownloadError(null);
              setDownloadDone(false);
              setProgress(null);
              downloadStartedRef.current = false;
              // Bouncing through "consent" would clobber state; force the
              // effect to re-run by toggling and back.
              setStep("consent");
              setTimeout(() => setStep("model-download"), 50);
            }}
          />
        )}

        {/* Complete screen */}
        {step === "complete" && (
          <div className="card-box text-center py-16">
            <div className="w-20 h-20 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-6">
              <Check className="w-10 h-10 text-emerald-600" />
            </div>
            <h1 className="text-2xl font-bold text-gray-900 mb-3">
              設定完成！
            </h1>
            <p className="text-sm text-gray-500 mb-8">
              您的帳號已準備就緒，歡迎使用海報資料庫系統
            </p>
            <div className="flex justify-center">
              <button
                className={primaryBtnClass}
                onClick={() => {
                  navigate({ to: "/" });
                }}
              >
                進入系統
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Self-contained download progress UI. Renders three sub-states off of the
 * latest `DownloadProgress` event:
 *   - no progress yet → spinner + "initializing"
 *   - downloading     → progress bar + speed + ETA
 *   - error           → message + retry button
 *   - done            → continue button
 */
function ModelDownloadStep({
  progress,
  error,
  done,
  onContinue,
  onRetry,
}: {
  progress: DownloadProgress | null;
  error: string | null;
  done: boolean;
  onContinue: () => void;
  onRetry: () => void;
}) {
  // Total over both files; assumes 2 GGUFs.
  // Approximate model + mmproj sizes — used when the HTTP Content-Length
  // header is missing so the bar still moves.
  const TOTAL_BYTES_ESTIMATE = 986_047_232 + 1_331_656_192;

  const percent = progress?.bytes_total
    ? Math.min(100, Math.round((progress.bytes_done / progress.bytes_total) * 100))
    : 0;

  return (
    <div className="card-box py-10 px-6">
      <div className="text-center mb-6">
        <div className="w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center mx-auto mb-4">
          {error ? (
            <AlertCircle className="w-8 h-8 text-red-500" />
          ) : done ? (
            <Check className="w-8 h-8 text-emerald-600" />
          ) : (
            <Download className="w-8 h-8 text-primary animate-pulse" />
          )}
        </div>
        <h1 className="text-xl font-bold text-gray-900 mb-2">
          {error ? "AI 模型下載失敗" : done ? "AI 模型下載完成" : "正在下載 AI 模型"}
        </h1>
        <p className="text-sm text-gray-500 max-w-md mx-auto">
          {error
            ? "請檢查網路連線後重試。本機 AI 模型用於海報自動分析。"
            : done
              ? "您的帳號已準備就緒，請繼續完成設定"
              : `首次安裝需要下載本地視覺語言模型（約 ${formatBytes(TOTAL_BYTES_ESTIMATE)}），請保持連線。`}
        </p>
      </div>

      {!error && !done && (
        <div className="space-y-3 mb-6">
          {progress ? (
            <>
              <div className="flex items-center justify-between text-sm">
                <span className="text-gray-600">
                  {progress.file_index} / 2 — {progress.file_label}
                </span>
                <span className="text-gray-400 text-xs">{progress.file_name}</span>
              </div>
              <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                <div
                  className="h-full bg-primary transition-[width] duration-200"
                  style={{ width: `${percent}%` }}
                />
              </div>
              <div className="flex items-center justify-between text-xs text-gray-500">
                <span>
                  {formatBytes(progress.bytes_done)} / {formatBytes(progress.bytes_total)}
                  {" • "}
                  {percent}%
                </span>
                <span>
                  {formatSpeed(progress.speed_bps)}
                  {progress.stage === "downloading" && progress.speed_bps > 0 && (
                    <>
                      {" • 剩餘 "}
                      {formatEta(
                        progress.bytes_total - progress.bytes_done,
                        progress.speed_bps,
                      )}
                    </>
                  )}
                </span>
              </div>
              <p className="text-xs text-gray-400 text-center">
                {progress.stage === "downloading" && "下載中…"}
                {progress.stage === "renaming" && "存檔中…"}
                {progress.stage === "complete" && "已下載 ✓"}
                {progress.stage === "checking" && "檢查檔案中…"}
              </p>
            </>
          ) : (
            <div className="flex items-center justify-center py-6 gap-2 text-sm text-gray-400">
              <Loader2 className="w-4 h-4 animate-spin" />
              連線中…
            </div>
          )}
        </div>
      )}

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-6">
          <p className="text-sm text-red-700 break-words">{error}</p>
        </div>
      )}

      <div className="flex justify-end gap-2">
        {error && (
          <button
            onClick={onRetry}
            className="flex items-center justify-center gap-2 px-5 h-11 bg-primary text-white text-[15px] font-semibold rounded-[10px] hover:bg-primary-light transition-colors"
          >
            重試
          </button>
        )}
        {done && (
          <button
            onClick={onContinue}
            className="flex items-center justify-center gap-2 px-5 h-11 bg-primary text-white text-[15px] font-semibold rounded-[10px] hover:bg-primary-light transition-colors"
          >
            繼續
            <ArrowRight className="w-4 h-4" />
          </button>
        )}
      </div>
    </div>
  );
}
