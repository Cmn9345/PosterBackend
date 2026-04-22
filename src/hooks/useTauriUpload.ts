// src/hooks/useTauriUpload.ts
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useEffect, useState, useCallback } from "react";

export interface UploadProgress {
  upload_id: string;
  file_name: string;
  bytes_sent: number;
  total_bytes: number;
  percentage: number;
  status: "pending" | "uploading" | "paused" | "completed" | "failed";
  speed_bps: number | null;
}

export interface UploadRecord {
  id: string;
  file_path: string;
  poster_id: string;
  storage_path: string;
  total_bytes: number;
  uploaded_bytes: number;
  status: string;
}

export function useTauriUpload() {
  const [progress, setProgress] = useState<Map<string, UploadProgress>>(new Map());
  const [resumable, setResumable] = useState<UploadRecord[]>([]);

  // Listen for progress events from Rust
  useEffect(() => {
    const unlisten = listen<UploadProgress>("upload-progress", (event) => {
      setProgress((prev) => {
        const next = new Map(prev);
        next.set(event.payload.upload_id, event.payload);
        return next;
      });
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  // Check for resumable uploads on mount
  useEffect(() => {
    invoke<UploadRecord[]>("get_resumable_uploads")
      .then(setResumable)
      .catch(console.error);
  }, []);

  const uploadFiles = useCallback(
    async (items: { file_path: string; poster_id: string; original_filename: string }[]) => {
      const ids = await invoke<string[]>("upload_files", { items });
      return ids;
    },
    []
  );

  const resumeUploads = useCallback(async () => {
    const count = await invoke<number>("resume_uploads");
    return count;
  }, []);

  const allProgress = Array.from(progress.values());
  const activeCount = allProgress.filter((p) => p.status === "uploading").length;
  const completedCount = allProgress.filter((p) => p.status === "completed").length;
  const totalFiles = allProgress.length;

  const overallPercentage =
    totalFiles > 0
      ? allProgress.reduce((sum, p) => sum + p.percentage, 0) / totalFiles
      : 0;

  return {
    progress,
    allProgress,
    resumable,
    activeCount,
    completedCount,
    totalFiles,
    overallPercentage,
    uploadFiles,
    resumeUploads,
  };
}
