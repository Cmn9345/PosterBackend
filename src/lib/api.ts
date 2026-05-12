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
