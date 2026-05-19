import { useEffect, useState } from "react";
import { check, Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { Download, RefreshCw, X } from "lucide-react";

type Phase = "idle" | "downloading" | "installing" | "ready" | "error";

export function UpdateBanner() {
  const [update, setUpdate] = useState<Update | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState(0);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    check()
      .then((res) => {
        if (res) setUpdate(res);
      })
      .catch((e) => {
        console.error("[updater] check failed:", e);
      });
  }, []);

  if (!update || dismissed) return null;

  const handleInstall = async () => {
    setPhase("downloading");
    setErrorMsg(null);
    let downloaded = 0;
    let total = 0;
    try {
      await update.downloadAndInstall((event) => {
        switch (event.event) {
          case "Started":
            total = event.data.contentLength ?? 0;
            break;
          case "Progress":
            downloaded += event.data.chunkLength;
            setProgress(total ? Math.round((downloaded / total) * 100) : 0);
            break;
          case "Finished":
            setPhase("installing");
            break;
        }
      });
      setPhase("ready");
      await relaunch();
    } catch (e) {
      console.error("[updater] install failed:", e);
      setErrorMsg(String(e));
      setPhase("error");
    }
  };

  return (
    <div className="bg-amber-50 border-b border-amber-200 px-6 py-2 flex items-center justify-between text-sm">
      <div className="flex items-center gap-3 text-amber-900">
        <Download className="w-4 h-4" strokeWidth={2.2} />
        <span>
          新版 <span className="font-semibold">v{update.version}</span> 可下載
          {update.body && (
            <span className="ml-2 text-amber-700/80 hidden sm:inline">
              — {update.body.split("\n")[0].slice(0, 80)}
            </span>
          )}
        </span>
        {phase === "downloading" && (
          <span className="font-mono text-xs text-amber-700">
            下載中 {progress}%
          </span>
        )}
        {phase === "installing" && (
          <span className="font-mono text-xs text-amber-700">安裝中…</span>
        )}
        {phase === "ready" && (
          <span className="font-mono text-xs text-emerald-700">重啟中…</span>
        )}
        {phase === "error" && (
          <span className="font-mono text-xs text-red-700" title={errorMsg ?? ""}>
            失敗（看 console）
          </span>
        )}
      </div>
      <div className="flex gap-2">
        {phase === "idle" && (
          <>
            <button
              onClick={handleInstall}
              className="inline-flex items-center gap-1.5 px-3 py-1 bg-amber-600 text-white rounded-md hover:bg-amber-700 transition-colors text-xs font-medium"
            >
              <RefreshCw className="w-3 h-3" strokeWidth={2.5} />
              立即更新
            </button>
            <button
              onClick={() => setDismissed(true)}
              className="inline-flex items-center px-2 py-1 text-amber-900/70 hover:bg-amber-100 rounded-md transition-colors"
              aria-label="稍後"
            >
              <X className="w-4 h-4" />
            </button>
          </>
        )}
        {phase === "error" && (
          <button
            onClick={() => {
              setPhase("idle");
              setErrorMsg(null);
            }}
            className="px-3 py-1 text-amber-900 hover:bg-amber-100 rounded-md text-xs"
          >
            重試
          </button>
        )}
      </div>
    </div>
  );
}
