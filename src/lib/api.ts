// src/lib/api.ts
// Shared API helpers for Tauri invoke calls
import { invoke } from "@tauri-apps/api/core";

/** Generic Supabase query via Rust backend */
export async function querySupabase<T = unknown>(table: string, query: string): Promise<T[]> {
  const raw = await invoke<string>("query_supabase", { table, query });
  const parsed = JSON.parse(raw);
  return Array.isArray(parsed) ? (parsed as T[]) : [];
}

/** Query with single result */
export async function queryOne<T = unknown>(table: string, query: string): Promise<T | null> {
  const results = await querySupabase<T>(table, `${query}&limit=1`);
  return results[0] ?? null;
}

// ── Exhibitions (展覽 CRUD) ──────────────────────────────────────────
// 對應 production schema:
//   public.exhibitions (id, name, cover_image_path, description, status,
//                       sort_order, start_date, end_date, location,
//                       created_at, updated_at)
//   status enum: planning | ongoing | finished
//   start_date/end_date: ISO date "YYYY-MM-DD"; end_date 為 null/空字串 = 常設
//   location: 純文字「台北靜思堂 / 花蓮靜思精舍」之類

export type ExhibitionStatus = "planning" | "ongoing" | "finished";

export interface ExhibitionInput {
  name: string;
  description?: string;
  coverImagePath?: string;
  sortOrder?: number;
  status: ExhibitionStatus;
  /** ISO date "YYYY-MM-DD" — 空字串表示「未指定」(update 時會清空欄位) */
  startDate?: string;
  /** ISO date "YYYY-MM-DD" — 空字串/未提供 表示常設展（前端顯示「常設」） */
  endDate?: string;
  /** 展出地點純文字；空字串會清空 */
  location?: string;
}

/** Create a new exhibition. Returns the created row's JSON (single-element array). */
export async function createExhibition(input: ExhibitionInput): Promise<string> {
  return invoke<string>("create_exhibition", {
    name: input.name,
    description: input.description ?? null,
    coverImagePath: input.coverImagePath ?? null,
    sortOrder: input.sortOrder ?? null,
    status: input.status,
    startDate: input.startDate ?? null,
    endDate: input.endDate ?? null,
    location: input.location ?? null,
  });
}

/** Update an existing exhibition. Pass only the fields you want changed. */
export async function patchExhibition(
  id: string,
  patch: Partial<ExhibitionInput>,
): Promise<void> {
  return invoke<void>("patch_exhibition", {
    id,
    name: patch.name ?? null,
    description: patch.description ?? null,
    coverImagePath: patch.coverImagePath ?? null,
    sortOrder: patch.sortOrder ?? null,
    status: patch.status ?? null,
    startDate: patch.startDate ?? null,
    endDate: patch.endDate ?? null,
    location: patch.location ?? null,
  });
}

/** Delete an exhibition by id. */
export async function deleteExhibition(id: string): Promise<void> {
  return invoke<void>("delete_exhibition", { id });
}

// ── Exhibition posters (掛海報 — Phase 2) ─────────────────────────────

/** 一張掛在展覽上的海報，含縮圖與狀態（從 list_exhibition_posters 解析）。
 *  Note: production schema has no `thumbnail_path`; we carry `poster_files[].id`
 *  and reconstruct `{poster_id}/{file_id}_m.webp` on the frontend. */
export interface AttachedPoster {
  poster_id: string;
  sort_order: number;
  posters: {
    id: string;
    project_name: string;
    status: string;
    poster_files?: Array<{ id: string }>;
  } | null;
}

/** 海報庫選擇器用的縮表結構。
 *  Note: production schema has no `thumbnail_path`; see `AttachedPoster`. */
export interface PickerPoster {
  id: string;
  project_name: string;
  status: string;
  poster_files?: Array<{ id: string }>;
}

/** List posters attached to an exhibition, ordered by sort_order ascending. */
export async function listExhibitionPosters(
  exhibitionId: string,
): Promise<AttachedPoster[]> {
  const raw = await invoke<string>("list_exhibition_posters", { exhibitionId });
  const parsed = JSON.parse(raw);
  return Array.isArray(parsed) ? (parsed as AttachedPoster[]) : [];
}

/** List candidate posters for the attach picker. `statusFilter` empty = backend default (published+approved). */
export async function listPostersForPicker(
  statusFilter: string[] = [],
  search?: string,
): Promise<PickerPoster[]> {
  const raw = await invoke<string>("list_posters_for_picker", {
    statusFilter,
    search: search ?? null,
  });
  const parsed = JSON.parse(raw);
  return Array.isArray(parsed) ? (parsed as PickerPoster[]) : [];
}

/** Attach posters to an exhibition. Already-attached are skipped silently. */
export async function attachPostersToExhibition(
  exhibitionId: string,
  posterIds: string[],
): Promise<number> {
  return invoke<number>("attach_posters_to_exhibition", {
    exhibitionId,
    posterIds,
  });
}

/** Detach a single poster from an exhibition. Idempotent. */
export async function detachPosterFromExhibition(
  exhibitionId: string,
  posterId: string,
): Promise<void> {
  return invoke<void>("detach_poster_from_exhibition", {
    exhibitionId,
    posterId,
  });
}

/** Rewrite sort_order: input array index = new sort_order. */
export async function reorderExhibitionPosters(
  exhibitionId: string,
  orderedPosterIds: string[],
): Promise<void> {
  return invoke<void>("reorder_exhibition_posters", {
    exhibitionId,
    orderedPosterIds,
  });
}

// ── Vocabulary themes (主題 CRUD — PR-B) ──────────────────────────────

export interface VocabularyTheme {
  id: string;
  name: string;
  code?: string | null;
  description?: string | null;
  icon?: string | null;
  color?: string | null;
  bg_color?: string | null;
  cover_image?: string | null;
  sort_order?: number | null;
  is_active: boolean;
  poster_count?: number | null;
  created_at?: string;
  updated_at?: string;
}

export interface ThemePayload {
  name: string;
  code?: string;
  icon?: string;
  color?: string;
  bgColor?: string;
  description?: string;
  coverImage?: string;
  sortOrder?: number;
  isActive?: boolean;
}

export async function listVocabularyThemesAdmin(): Promise<VocabularyTheme[]> {
  const raw = await invoke<string>("list_vocabulary_themes_admin");
  const parsed = JSON.parse(raw);
  return Array.isArray(parsed) ? (parsed as VocabularyTheme[]) : [];
}

export async function createVocabularyTheme(input: ThemePayload): Promise<string> {
  return invoke<string>("create_vocabulary_theme", {
    name: input.name,
    code: input.code ?? null,
    icon: input.icon ?? null,
    color: input.color ?? null,
    bgColor: input.bgColor ?? null,
    description: input.description ?? null,
    coverImage: input.coverImage ?? null,
    sortOrder: input.sortOrder ?? null,
    isActive: input.isActive ?? true,
  });
}

export async function updateVocabularyTheme(
  id: string,
  newName: string,
  patch: Omit<ThemePayload, "name">,
): Promise<void> {
  return invoke<void>("update_vocabulary_theme", {
    id,
    newName,
    code: patch.code ?? null,
    icon: patch.icon ?? null,
    color: patch.color ?? null,
    bgColor: patch.bgColor ?? null,
    description: patch.description ?? null,
    coverImage: patch.coverImage ?? null,
    sortOrder: patch.sortOrder ?? null,
    isActive: patch.isActive ?? null,
  });
}

export async function deleteVocabularyTheme(id: string): Promise<void> {
  return invoke<void>("delete_vocabulary_theme", { id });
}

// ── Manual classification (海報手動歸類) ──────────────────────────────

export async function updatePosterFileThemes(
  fileId: string,
  themes: string[],
): Promise<void> {
  return invoke<void>("update_poster_file_themes", { fileId, themes });
}
