import { createFileRoute } from "@tanstack/react-router";
import { Loader2, X, Search, FolderOpen, Pencil, Plus, Trash2 } from "lucide-react";
import { useState, useEffect, useMemo, useCallback } from "react";
import {
  listVocabularyThemesAdmin,
  querySupabase,
  type VocabularyTheme,
} from "../../lib/api";
import { ThemeEditModal } from "../../components/ThemeEditModal";
import { ThemeDeleteConfirm } from "../../components/ThemeDeleteConfirm";

export const Route = createFileRoute("/exhibitions/")({
  component: ThemePosterManagement,
});

// ── Types ───────────────────────────────────────────────────────────────

/**
 * Row from `poster_files` joined with `posters`. Themes live as a Postgres
 * `text[]` on poster_files; we filter on the array with PostgREST's `cs`
 * (contains) operator.
 */
interface PosterFileRow {
  id: string;
  poster_id: string;
  description?: string | null;
  themes?: string[] | null;
  posters: {
    id: string;
    project_name: string;
    status: string;
    updated_at?: string;
  } | null;
}

// ── Page ────────────────────────────────────────────────────────────────

function ThemePosterManagement() {
  const [themes, setThemes] = useState<VocabularyTheme[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedTheme, setSelectedTheme] = useState<VocabularyTheme | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [editingTheme, setEditingTheme] = useState<VocabularyTheme | null>(null);
  const [creatingTheme, setCreatingTheme] = useState(false);
  const [deleting, setDeleting] = useState<VocabularyTheme | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // 管理模式撈全部（含 inactive）；瀏覽模式維持舊行為（只撈 active）。
      const data = editMode
        ? await listVocabularyThemesAdmin()
        : await querySupabase<VocabularyTheme>(
            "vocabulary_themes",
            "is_active=eq.true&order=sort_order.asc",
          );
      setThemes(data);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [editMode]);

  useEffect(() => {
    reload();
  }, [reload]);

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8">
      {/* Header */}
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-primary">
            主題海報{editMode && " · 管理模式"}
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            {editMode
              ? "點任一卡編輯；卡的右下角可刪除。改名與刪除會自動處理已歸類海報。"
              : "依 12 個主題瀏覽底下收錄的海報。"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {editMode && (
            <button
              onClick={() => setCreatingTheme(true)}
              className="px-3 py-1.5 text-sm rounded-lg bg-primary text-white font-medium hover:bg-primary/90 cursor-pointer inline-flex items-center gap-1"
            >
              <Plus className="w-4 h-4" /> 新增主題
            </button>
          )}
          <button
            onClick={() => setEditMode((v) => !v)}
            className={`px-3 py-1.5 text-sm rounded-lg cursor-pointer inline-flex items-center gap-1 ${
              editMode
                ? "bg-gray-100 text-gray-700 hover:bg-gray-200"
                : "border border-gray-200 text-gray-700 hover:border-primary/40"
            }`}
          >
            {editMode ? "完成" : (
              <>
                <Pencil className="w-4 h-4" /> 編輯主題
              </>
            )}
          </button>
        </div>
      </div>

      {/* Loading / error 略，沿用既有版本 */}
      {loading && (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-8 h-8 text-primary animate-spin" />
        </div>
      )}
      {error && (
        <div className="text-center py-12">
          <p className="text-red-500 text-sm mb-2">載入主題失敗</p>
          <p className="text-gray-400 text-xs">{error}</p>
        </div>
      )}

      {/* Theme grid */}
      {!loading && !error && (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {themes.length === 0 ? (
            <div className="col-span-full text-center py-12">
              <p className="text-gray-400 text-sm">
                還沒有任何主題。請先於 Supabase 套用 006_vocabulary_themes.sql migration。
              </p>
            </div>
          ) : (
            themes.map((t) => (
              <div
                key={t.id}
                onClick={() => {
                  if (editMode) setEditingTheme(t);
                  else setSelectedTheme(t);
                }}
                className={`relative card-box overflow-hidden text-left transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg cursor-pointer ${
                  !t.is_active ? "opacity-50" : ""
                }`}
              >
                {/* Banner image header — title 已內嵌於圖，下方文字僅留描述 */}
                {t.cover_image ? (
                  <div
                    className="relative aspect-[16/9] w-full"
                    style={{ backgroundColor: t.bg_color || "#f9fafb" }}
                  >
                    <img
                      src={t.cover_image}
                      alt={t.name}
                      loading="lazy"
                      className="w-full h-full object-cover"
                    />
                    <span className="absolute top-3 right-3 px-2 py-0.5 text-xs font-semibold rounded-full bg-white/90 text-gray-800 shadow-sm">
                      {t.poster_count ?? 0} 張
                    </span>
                  </div>
                ) : (
                  <div
                    className="flex items-start justify-between p-5"
                    style={{ backgroundColor: t.bg_color || "#f9fafb" }}
                  >
                    <span className="text-3xl" aria-hidden>
                      {t.icon || "📁"}
                    </span>
                    <span className="px-2 py-0.5 text-xs font-semibold rounded-full bg-white/80 text-gray-700">
                      {t.poster_count ?? 0} 張
                    </span>
                  </div>
                )}

                {/* Caption — 描述（編輯模式留垃圾桶位置）*/}
                <div className="relative px-4 pt-3 pb-10">
                  {/* When the banner already shows the name, keep it in DOM
                      for screen readers / search but visually hidden. */}
                  {t.cover_image ? (
                    <h3 className="sr-only">{t.name}</h3>
                  ) : (
                    <h3
                      className="text-lg font-bold mb-1"
                      style={{ color: t.color || "#1f2937" }}
                    >
                      {t.name}
                    </h3>
                  )}
                  <p className="text-xs text-gray-600 line-clamp-3 min-h-[3rem]">
                    {t.description || "—"}
                  </p>
                  {editMode && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setDeleting(t);
                      }}
                      className="absolute bottom-2 right-3 p-1.5 rounded-md text-gray-400 hover:text-red-500 hover:bg-white/60 cursor-pointer"
                      title="刪除主題"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* Drawer (browse mode only) */}
      {!editMode && selectedTheme && (
        <ThemePosterDrawer theme={selectedTheme} onClose={() => setSelectedTheme(null)} />
      )}

      {/* Edit / create modals */}
      {(editingTheme || creatingTheme) && (
        <ThemeEditModal
          initial={editingTheme}
          onClose={() => {
            setEditingTheme(null);
            setCreatingTheme(false);
          }}
          onSaved={reload}
        />
      )}

      {/* Delete confirm */}
      {deleting && (
        <ThemeDeleteConfirm
          theme={deleting}
          onClose={() => setDeleting(null)}
          onConfirmed={() => {
            setDeleting(null);
            reload();
          }}
        />
      )}
    </div>
  );
}

// ── Drawer ──────────────────────────────────────────────────────────────

const statusLabel: Record<string, { label: string; cls: string }> = {
  draft: { label: "草稿", cls: "bg-gray-100 text-gray-600" },
  pending_review: { label: "審核中", cls: "bg-amber-100 text-amber-700" },
  approved: { label: "已通過", cls: "bg-emerald-100 text-emerald-700" },
  published: { label: "已發布", cls: "bg-green-100 text-green-700" },
  rejected: { label: "退件", cls: "bg-red-100 text-red-700" },
};

function ThemePosterDrawer({
  theme,
  onClose,
}: {
  theme: VocabularyTheme;
  onClose: () => void;
}) {
  const [rows, setRows] = useState<PosterFileRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  useEffect(() => {
    let cancelled = false;
    async function fetchPosters() {
      setLoading(true);
      setError(null);
      try {
        // PostgREST `cs` operator on text[]: themes=cs.{慈善}
        // Need to encode the curly braces so they survive URL parsing.
        const encoded = encodeURIComponent(`{${theme.name}}`);
        const data = await querySupabase<PosterFileRow>(
          "poster_files",
          `themes=cs.${encoded}&select=id,poster_id,description,themes,posters(id,project_name,status,updated_at)&limit=200`,
        );
        if (!cancelled) setRows(data);
      } catch (e) {
        if (!cancelled) setError(String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    fetchPosters();
    return () => {
      cancelled = true;
    };
  }, [theme.name]);

  const filteredSorted = useMemo(() => {
    // De-dupe by poster_id — one project can have multiple files all tagged
    // the same theme; reviewer cares about projects, not files.
    const seen = new Set<string>();
    const unique: PosterFileRow[] = [];
    for (const r of rows) {
      if (!r.posters) continue;
      if (seen.has(r.poster_id)) continue;
      seen.add(r.poster_id);
      unique.push(r);
    }
    const filtered = searchQuery
      ? unique.filter(
          (r) =>
            r.posters?.project_name.includes(searchQuery) ||
            r.description?.includes(searchQuery),
        )
      : unique;
    // Newest first by posters.updated_at
    return filtered.sort((a, b) => {
      const ta = a.posters?.updated_at ?? "";
      const tb = b.posters?.updated_at ?? "";
      return tb.localeCompare(ta);
    });
  }, [rows, searchQuery]);

  return (
    <div className="fixed inset-0 z-50 flex justify-end" onClick={onClose}>
      <div className="fixed inset-0 bg-black/30" />
      <div
        className="relative bg-white w-full max-w-2xl h-full shadow-2xl flex flex-col animate-[slideInRight_0.2s_ease-out]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          className="px-6 py-4 border-b border-gray-100 flex items-center justify-between"
          style={{ backgroundColor: theme.bg_color || "#f9fafb" }}
        >
          <div className="flex items-center gap-3">
            <span className="text-2xl" aria-hidden>
              {theme.icon || "📁"}
            </span>
            <div>
              <h3 className="text-lg font-bold" style={{ color: theme.color || "#1f2937" }}>
                {theme.name}
              </h3>
              <p className="text-xs text-gray-600">
                {loading ? "載入中…" : `${filteredSorted.length} 張海報`}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-white/50 cursor-pointer"
            aria-label="關閉"
          >
            <X className="w-5 h-5 text-gray-600" />
          </button>
        </div>

        {/* Search */}
        <div className="px-6 py-3 border-b border-gray-100">
          <div className="relative">
            <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="搜尋海報名稱或描述..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
            />
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {loading && (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-6 h-6 text-primary animate-spin" />
            </div>
          )}
          {error && (
            <div className="text-center py-8">
              <p className="text-red-500 text-sm">載入失敗</p>
              <p className="text-gray-400 text-xs mt-1 break-all">{error}</p>
            </div>
          )}
          {!loading && !error && filteredSorted.length === 0 && (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <FolderOpen className="w-12 h-12 text-gray-200 mb-3" strokeWidth={1.5} />
              <p className="text-gray-400 text-sm">
                {searchQuery ? "無符合的海報" : "此主題尚無海報"}
              </p>
              {!searchQuery && (
                <p className="text-gray-300 text-xs mt-1">
                  海報在 VLM 分析時會自動歸入相關主題
                </p>
              )}
            </div>
          )}
          {!loading && !error && filteredSorted.length > 0 && (
            <ul className="divide-y divide-gray-100">
              {filteredSorted.map((row) => {
                const p = row.posters!;
                const st = statusLabel[p.status] ?? { label: p.status, cls: "bg-gray-100 text-gray-600" };
                return (
                  <li key={row.id} className="py-3 hover:bg-gray-50 -mx-2 px-2 rounded-md transition-colors">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <h4 className="text-sm font-medium text-gray-800 truncate">
                          {p.project_name || "（未命名）"}
                        </h4>
                        {row.description && (
                          <p className="text-xs text-gray-500 line-clamp-2 mt-0.5">{row.description}</p>
                        )}
                        <p className="text-xs text-gray-400 mt-1">
                          更新於 {p.updated_at?.slice(0, 10) ?? "—"}
                        </p>
                      </div>
                      <span className={`shrink-0 px-2 py-0.5 text-xs font-medium rounded-full ${st.cls}`}>
                        {st.label}
                      </span>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
