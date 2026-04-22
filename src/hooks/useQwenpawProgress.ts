import { listen } from "@tauri-apps/api/event";
import { useEffect, useState } from "react";

export type ProcessingStage =
  | "download"
  | "metadata"
  | "thumbnail"
  | "analysis"
  | "completed"
  | "failed";

export interface ProcessingProgress {
  file_id: string;
  poster_id: string;
  stage: ProcessingStage;
  message: string;
}

export type ImmichStage =
  | "query"
  | "download"
  | "upload"
  | "persist"
  | "completed"
  | "failed";

export interface ImmichProgress {
  project_id: string;
  stage: ImmichStage;
  message: string;
}

/**
 * Subscribe to the in-process Qwenpaw worker. Emits one event per stage
 * per file (download → metadata → thumbnail → completed / failed).
 *
 * Returns:
 *   - byFile: map of file_id → latest progress (useful for list rows)
 *   - latest: most recent event (useful for a global spinner)
 */
export function useQwenpawProgress() {
  const [byFile, setByFile] = useState<Record<string, ProcessingProgress>>({});
  const [latest, setLatest] = useState<ProcessingProgress | null>(null);

  useEffect(() => {
    const p = listen<ProcessingProgress>("qwenpaw-progress", (e) => {
      setByFile((prev) => ({ ...prev, [e.payload.file_id]: e.payload }));
      setLatest(e.payload);
    });
    return () => {
      p.then((fn) => fn());
    };
  }, []);

  return { byFile, latest };
}

/**
 * Subscribe to Immich sync progress (fires after review approve).
 * Returns keyed map of project_id → latest stage.
 */
export function useImmichSyncProgress() {
  const [byProject, setByProject] = useState<Record<string, ImmichProgress>>({});
  const [latest, setLatest] = useState<ImmichProgress | null>(null);

  useEffect(() => {
    const p = listen<ImmichProgress>("immich-sync-progress", (e) => {
      setByProject((prev) => ({ ...prev, [e.payload.project_id]: e.payload }));
      setLatest(e.payload);
    });
    return () => {
      p.then((fn) => fn());
    };
  }, []);

  return { byProject, latest };
}
