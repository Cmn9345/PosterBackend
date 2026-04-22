import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useEffect, useState, useCallback } from "react";

export interface PosterNotification {
  title: string;
  body: string;
  action_url?: string;
  priority?: string;
  application_id?: string;
  poster_id?: string;
  status?: string;
}

export interface ProjectProgress {
  project_id?: string;
  file_id?: string;
  status?: string;
  progress?: number;
  total?: number;
}

export function useCoPawNotification() {
  const [connected, setConnected] = useState(false);
  const [notifications, setNotifications] = useState<PosterNotification[]>([]);
  const [projectProgress, setProjectProgress] = useState<ProjectProgress | null>(null);

  useEffect(() => {
    const unlisteners = [
      listen<PosterNotification>("copaw-notification", (event) => {
        setNotifications((prev) => [event.payload, ...prev].slice(0, 50));
      }),
      listen<{ connected: boolean }>("copaw-connected", (event) => {
        setConnected(event.payload.connected);
      }),
      listen<string>("copaw-project-progress", (event) => {
        try {
          setProjectProgress(JSON.parse(event.payload));
        } catch {
          // ignore
        }
      }),
      listen<string>("copaw-project-complete", () => {
        setProjectProgress(null);
      }),
      listen<string>("copaw-error", (event) => {
        try {
          const data = JSON.parse(event.payload);
          setNotifications((prev) =>
            [
              {
                title: "CoPaw Error",
                body: data.message || "Unknown error",
                priority: "high",
              },
              ...prev,
            ].slice(0, 50),
          );
        } catch {
          // ignore
        }
      }),
    ];
    return () => {
      unlisteners.forEach((p) => p.then((fn) => fn()));
    };
  }, []);

  useEffect(() => {
    const check = async () => {
      try {
        const status = await invoke<boolean>("get_copaw_status");
        setConnected(status);
      } catch {
        setConnected(false);
      }
    };
    check();
    const interval = setInterval(check, 30000);
    return () => clearInterval(interval);
  }, []);

  const clearNotifications = useCallback(() => {
    setNotifications([]);
  }, []);

  const sendAuth = useCallback(async (accessToken: string) => {
    try {
      await invoke("send_copaw_auth", { accessToken });
    } catch {
      // ignore if not connected
    }
  }, []);

  return {
    connected,
    notifications,
    latestNotification: notifications[0] ?? null,
    projectProgress,
    clearNotifications,
    sendAuth,
  };
}
