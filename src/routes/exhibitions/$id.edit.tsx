// src/routes/exhibitions/$id.edit.tsx
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  arrayMove,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { ArrowLeft, Loader2, Plus, Save, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  attachPostersToExhibition,
  deleteExhibition,
  detachPosterFromExhibition,
  listExhibitionPosters,
  patchExhibition,
  querySupabase,
  reorderExhibitionPosters,
  type AttachedPoster,
  type ExhibitionStatus,
} from "../../lib/api";
import { PosterPickerModal } from "../../components/PosterPickerModal";
import { SortablePosterCard } from "../../components/SortablePosterCard";

export const Route = createFileRoute("/exhibitions/$id/edit")({
  component: ExhibitionEditPage,
});

interface ExhibitionRow {
  id: string;
  name: string;
  description: string | null;
  cover_image_path: string | null;
  sort_order: number | null;
  status: ExhibitionStatus;
  start_date: string | null;
  end_date: string | null;
  location: string | null;
}

function ExhibitionEditPage() {
  const { id } = Route.useParams();
  const navigate = useNavigate();

  // ── State ──
  const [exhibition, setExhibition] = useState<ExhibitionRow | null>(null);
  const [attached, setAttached] = useState<AttachedPoster[]>([]);
  const [thumbCache, setThumbCache] = useState<Record<string, string | null>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);

  // ── Load ──
  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [rows, posters] = await Promise.all([
        querySupabase<ExhibitionRow>("exhibitions", `id=eq.${id}&limit=1`),
        listExhibitionPosters(id),
      ]);
      if (rows.length === 0) {
        setError("展覽不存在");
        return;
      }
      setExhibition(rows[0]);
      setAttached(posters);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    reload();
  }, [reload]);

  // ── Thumbnail signing (lazy + memoized) ──
  // poster_files.thumbnail_path is a Storage object key, not a URL. We pre-sign
  // each one once and cache.
  useEffect(() => {
    const missing = attached
      .map((a) => a.posters?.poster_files?.[0]?.thumbnail_path)
      .filter((p): p is string => !!p && thumbCache[p] === undefined);
    if (missing.length === 0) return;
    let cancelled = false;
    (async () => {
      const entries = await Promise.all(
        missing.map(async (path) => {
          try {
            const url = await invoke<string>("sign_thumbnail_url", { path });
            return [path, url] as const;
          } catch {
            return [path, null] as const;
          }
        }),
      );
      if (!cancelled) {
        setThumbCache((prev) => {
          const next = { ...prev };
          for (const [k, v] of entries) next[k] = v;
          return next;
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [attached, thumbCache]);

  const resolveThumb = useCallback(
    (path: string | null | undefined) => {
      if (!path) return null;
      return thumbCache[path] ?? null;
    },
    [thumbCache],
  );

  // ── DnD ──
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const handleDragEnd = async (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const oldIdx = attached.findIndex((a) => a.poster_id === active.id);
    const newIdx = attached.findIndex((a) => a.poster_id === over.id);
    if (oldIdx < 0 || newIdx < 0) return;
    const next = arrayMove(attached, oldIdx, newIdx);
    const snapshot = attached;
    setAttached(next); // optimistic
    try {
      await reorderExhibitionPosters(
        id,
        next.map((a) => a.poster_id),
      );
    } catch (err) {
      console.error("Reorder failed, rolling back:", err);
      setAttached(snapshot);
      alert(`排序失敗：${err}`);
    }
  };

  // ── Form handlers ──
  const updateField = <K extends keyof ExhibitionRow>(key: K, value: ExhibitionRow[K]) => {
    setExhibition((prev) => (prev ? { ...prev, [key]: value } : prev));
  };

  const handleSave = async () => {
    if (!exhibition) return;
    if (!exhibition.name.trim()) {
      alert("展覽名稱不可為空");
      return;
    }
    setSaving(true);
    try {
      await patchExhibition(id, {
        name: exhibition.name.trim(),
        description: exhibition.description ?? "",
        coverImagePath: exhibition.cover_image_path ?? "",
        sortOrder: exhibition.sort_order ?? undefined,
        status: exhibition.status,
        startDate: exhibition.start_date ?? "",
        endDate: exhibition.end_date ?? "",
        location: exhibition.location ?? "",
      });
    } catch (err) {
      alert(`儲存失敗：${err}`);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!exhibition) return;
    if (!confirm(`確認刪除展覽「${exhibition.name}」？此操作無法復原。`)) return;
    try {
      await deleteExhibition(id);
      navigate({ to: "/exhibition-structure" });
    } catch (err) {
      alert(`刪除失敗：${err}`);
    }
  };

  const handleRemoveAttached = async (posterId: string) => {
    setRemovingId(posterId);
    const snapshot = attached;
    setAttached((prev) => prev.filter((a) => a.poster_id !== posterId)); // optimistic
    try {
      await detachPosterFromExhibition(id, posterId);
    } catch (err) {
      setAttached(snapshot);
      alert(`移除失敗：${err}`);
    } finally {
      setRemovingId(null);
    }
  };

  const handleAttachConfirm = async (posterIds: string[]) => {
    try {
      await attachPostersToExhibition(id, posterIds);
      await reload();
    } catch (err) {
      alert(`掛海報失敗：${err}`);
    }
  };

  // ── Render ──
  if (loading) {
    return (
      <div className="max-w-7xl mx-auto px-4 py-8">
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-8 h-8 text-primary animate-spin" />
        </div>
      </div>
    );
  }
  if (error || !exhibition) {
    return (
      <div className="max-w-7xl mx-auto px-4 py-8">
        <button
          onClick={() => navigate({ to: "/exhibition-structure" })}
          className="text-sm text-gray-500 hover:text-primary inline-flex items-center gap-1"
        >
          <ArrowLeft className="w-4 h-4" /> 返回展覽列表
        </button>
        <p className="mt-6 text-red-500">{error ?? "展覽載入失敗"}</p>
      </div>
    );
  }

  const alreadyAttached = new Set(attached.map((a) => a.poster_id));

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6">
      {/* Top bar */}
      <div className="flex items-center justify-between mb-4">
        <button
          onClick={() => navigate({ to: "/exhibition-structure" })}
          className="text-sm text-gray-500 hover:text-primary inline-flex items-center gap-1 cursor-pointer"
        >
          <ArrowLeft className="w-4 h-4" /> 返回展覽列表
        </button>
        <div className="flex items-center gap-2">
          <button
            onClick={handleDelete}
            className="px-3 py-1.5 text-sm rounded-lg border border-red-200 text-red-600 hover:bg-red-50 inline-flex items-center gap-1 cursor-pointer"
          >
            <Trash2 className="w-4 h-4" /> 刪除展覽
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-4 py-1.5 text-sm rounded-lg bg-primary text-white font-medium hover:bg-primary/90 inline-flex items-center gap-1 cursor-pointer disabled:opacity-50"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            儲存
          </button>
        </div>
      </div>

      <h1 className="text-2xl font-bold text-primary mb-6">{exhibition.name || "（未命名展覽）"}</h1>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Left: basic fields */}
        <section className="card-box p-5 space-y-4">
          <h2 className="text-sm font-semibold text-gray-700">基本資料</h2>

          <Field label="名稱 *">
            <input
              type="text"
              value={exhibition.name}
              onChange={(e) => updateField("name", e.target.value)}
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:ring-2 focus:ring-primary/20 focus:border-primary"
            />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="起始日">
              <input
                type="date"
                value={exhibition.start_date ?? ""}
                onChange={(e) => updateField("start_date", e.target.value || null)}
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg"
              />
            </Field>
            <Field label="結束日">
              <input
                type="date"
                value={exhibition.end_date ?? ""}
                onChange={(e) => updateField("end_date", e.target.value || null)}
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg"
              />
            </Field>
          </div>

          <Field label="地點">
            <input
              type="text"
              value={exhibition.location ?? ""}
              onChange={(e) => updateField("location", e.target.value || null)}
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg"
              placeholder="例如：台北靜思堂"
            />
          </Field>

          <Field label="狀態">
            <select
              value={exhibition.status}
              onChange={(e) => updateField("status", e.target.value as ExhibitionStatus)}
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg"
            >
              <option value="planning">籌備中 (planning)</option>
              <option value="ongoing">進行中 (ongoing)</option>
              <option value="finished">已結束 (finished)</option>
            </select>
          </Field>

          <Field label="封面圖路徑">
            <input
              type="text"
              value={exhibition.cover_image_path ?? ""}
              onChange={(e) => updateField("cover_image_path", e.target.value || null)}
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg"
              placeholder="Storage path 或公開 URL"
            />
          </Field>

          <Field label="排序">
            <input
              type="number"
              value={exhibition.sort_order ?? 0}
              onChange={(e) => updateField("sort_order", Number(e.target.value) || 0)}
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg"
            />
          </Field>

          <Field label="描述">
            <textarea
              rows={3}
              value={exhibition.description ?? ""}
              onChange={(e) => updateField("description", e.target.value || null)}
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg"
            />
          </Field>
        </section>

        {/* Right: attached posters */}
        <section className="card-box p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-gray-700">
              掛海報 ({attached.length})
            </h2>
            <button
              onClick={() => setPickerOpen(true)}
              className="px-3 py-1.5 text-xs rounded-lg bg-primary text-white font-medium hover:bg-primary/90 inline-flex items-center gap-1 cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" /> 從海報庫新增
            </button>
          </div>

          {attached.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-12">
              尚未掛任何海報。點「從海報庫新增」開始。
            </p>
          ) : (
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={handleDragEnd}
            >
              <SortableContext
                items={attached.map((a) => a.poster_id)}
                strategy={verticalListSortingStrategy}
              >
                <div className="space-y-2">
                  {attached.map((a) => (
                    <SortablePosterCard
                      key={a.poster_id}
                      attached={a}
                      thumbnailUrl={resolveThumb(a.posters?.poster_files?.[0]?.thumbnail_path)}
                      onRemove={() => handleRemoveAttached(a.poster_id)}
                      removing={removingId === a.poster_id}
                    />
                  ))}
                </div>
              </SortableContext>
            </DndContext>
          )}
        </section>
      </div>

      {pickerOpen && (
        <PosterPickerModal
          alreadyAttached={alreadyAttached}
          resolveThumbnail={resolveThumb}
          onClose={() => setPickerOpen(false)}
          onConfirm={handleAttachConfirm}
        />
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-xs font-medium text-gray-600 mb-1">{label}</span>
      {children}
    </label>
  );
}
