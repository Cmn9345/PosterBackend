// src/stores/posterStore.ts
import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";

interface Poster {
  id: string;
  title: string;
  status: string;
  file_count: number;
  created_at: string;
  updated_at: string;
}

interface Project {
  id: string;
  name: string;
  status: string;
  total_files: number;
  completed_files: number;
}

interface PosterState {
  posters: Poster[];
  projects: Project[];
  loading: boolean;
  error: string | null;
  fetchPosters: () => Promise<void>;
  fetchProjects: () => Promise<void>;
  createProject: (name: string, files: { path: string; name: string }[]) => Promise<string>;
}

export const usePosterStore = create<PosterState>((set) => ({
  posters: [],
  projects: [],
  loading: false,
  error: null,

  fetchPosters: async () => {
    set({ loading: true });
    try {
      const result = await invoke<string>("query_supabase", {
        table: "posters",
        query: "order=created_at.desc&limit=50",
      });
      set({ posters: JSON.parse(result), loading: false });
    } catch (e) {
      set({ error: String(e), loading: false });
    }
  },

  fetchProjects: async () => {
    set({ loading: true });
    try {
      const result = await invoke<string>("list_projects");
      set({ projects: JSON.parse(result), loading: false });
    } catch (e) {
      set({ error: String(e), loading: false });
    }
  },

  createProject: async (name, files) => {
    const result = await invoke<string>("create_project", {
      name,
      files: files.map((f) => ({ path: f.path, name: f.name })),
    });
    return result;
  },
}));
