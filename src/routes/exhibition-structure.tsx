import { createFileRoute } from "@tanstack/react-router";
import { Plus, Search, ImageIcon, Loader2, Trash2 } from "lucide-react";
import { useState, useEffect, useMemo, useCallback } from "react";
import {
  querySupabase,
  createExhibition,
  patchExhibition,
  deleteExhibition,
  type ExhibitionInput,
  type ExhibitionStatus,
} from "../lib/api";

export const Route = createFileRoute("/exhibition-structure")({
  component: ExhibitionManagement,
});

// 對應 production schema：public.exhibitions
interface Exhibition {
  id: string;
  name: string;
  description: string | null;
  cover_image_path: string | null;
  status: ExhibitionStatus;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

type ModalMode =
  | { kind: "closed" }
  | { kind: "create" }
  | { kind: "edit"; exhibition: Exhibition };

// 三種狀態的中文標籤 + 顏色配置
const statusMeta: Record<
  ExhibitionStatus,
  { label: string; pillCls: string; cardTint: string }
> = {
  planning: {
    label: "籌備中",
    pillCls: "bg-amber-100 text-amber-700",
    cardTint: "bg-amber-50",
  },
  ongoing: {
    label: "進行中",
    pillCls: "bg-green-100 text-green-700",
    cardTint: "bg-green-50",
  },
  finished: {
    label: "已結束",
    pillCls: "bg-gray-200 text-gray-600",
    cardTint: "bg-gray-100",
  },
};

const statusOrder: ExhibitionStatus[] = ["planning", "ongoing", "finished"];

/** Surface PostgREST errors as a human-readable Chinese message. */
function formatMutationError(err: unknown): string {
  const raw = String(err ?? "");
  if (raw.includes("22P02") || (raw.includes("invalid input value for enum"))) {
    return "狀態不正確（只能是 籌備中 / 進行中 / 已結束）";
  }
  if (raw.includes("permission denied") || raw.includes("row-level security") || raw.includes("42501")) {
    return "權限不足：只有系統管理員可以建立 / 編輯 / 刪除展覽";
  }
  if (raw.includes("PGRST") || (raw.includes("relation") && raw.includes("does not exist"))) {
    return "資料表存取失敗，請確認 009 migration 是否已套用";
  }
  return raw || "未知錯誤";
}

function ExhibitionManagement() {
  const [modal, setModal] = useState<ModalMode>({ kind: "closed" });
  const [exhibitions, setExhibitions] = useState<Exhibition[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | ExhibitionStatus>("all");
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const fetchExhibitions = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // Order by sort_order ASC (frontend display order), tie-break by newer first.
      const data = await querySupabase<Exhibition>(
        "exhibitions",
        "order=sort_order.asc,created_at.desc",
      );
      setExhibitions(data);
    } catch (e) {
      setError(formatMutationError(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchExhibitions();
  }, [fetchExhibitions]);

  const filteredExhibitions = useMemo(() => {
    return exhibitions.filter((t) => {
      if (statusFilter !== "all" && t.status !== statusFilter) return false;
      if (searchQuery && !t.name.includes(searchQuery) && !t.description?.includes(searchQuery)) return false;
      return true;
    });
  }, [exhibitions, searchQuery, statusFilter]);

  const handleDelete = useCallback(async (ex: Exhibition) => {
    const ok = window.confirm(`確定要刪除展覽「${ex.name}」嗎？此操作無法復原。`);
    if (!ok) return;
    setDeletingId(ex.id);
    try {
      await deleteExhibition(ex.id);
      setExhibitions((prev) => prev.filter((e) => e.id !== ex.id));
    } catch (e) {
      alert(`刪除失敗：${formatMutationError(e)}`);
    } finally {
      setDeletingId(null);
    }
  }, []);

  // 算出下一個建議 sort_order：當前最大 +10（留間隙便於後插）
  const nextSortOrder = useMemo(() => {
    const max = exhibitions.reduce((m, e) => Math.max(m, e.sort_order ?? 0), 0);
    return max + 10;
  }, [exhibitions]);

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-primary">展覽管理</h1>
          <p className="text-sm text-gray-500 mt-1">
            建立、編輯、刪除展覽資訊。<span className="text-green-700">「進行中」「已結束」</span>會顯示於前台，<span className="text-amber-700">「籌備中」</span>僅內部可見。
          </p>
        </div>
        <button
          onClick={() => setModal({ kind: "create" })}
          className="px-5 py-2.5 bg-primary text-white text-sm font-medium rounded-lg hover:bg-primary-light transition-colors flex items-center gap-2 cursor-pointer"
        >
          <Plus className="w-4 h-4" />
          新增展覽
        </button>
      </div>

      {/* Filter */}
      <div className="flex flex-wrap items-center gap-3 mb-6">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="搜尋展覽名稱..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
          />
        </div>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as "all" | ExhibitionStatus)}
          className="px-3 py-2 text-sm border border-gray-200 rounded-lg bg-white"
        >
          <option value="all">全部狀態</option>
          {statusOrder.map((s) => (
            <option key={s} value={s}>
              {statusMeta[s].label}
            </option>
          ))}
        </select>
      </div>

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-8 h-8 text-primary animate-spin" />
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="text-center py-12">
          <p className="text-red-500 text-sm mb-2">載入失敗</p>
          <p className="text-gray-400 text-xs">{error}</p>
          <button
            onClick={fetchExhibitions}
            className="mt-4 px-4 py-2 text-sm text-primary border border-primary rounded-lg hover:bg-primary/5 cursor-pointer"
          >
            重試
          </button>
        </div>
      )}

      {/* Card Grid */}
      {!loading && !error && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredExhibitions.length === 0 ? (
            <div className="col-span-full text-center py-12">
              <p className="text-gray-400 text-sm">
                {exhibitions.length === 0
                  ? "目前還沒有任何展覽，按右上「新增展覽」開始建立"
                  : "無符合條件的展覽"}
              </p>
            </div>
          ) : (
            filteredExhibitions.map((t) => {
              const meta = statusMeta[t.status] ?? statusMeta.planning;
              const dateStr = t.created_at ? t.created_at.slice(0, 10) : "";
              const isDeleting = deletingId === t.id;

              return (
                <div
                  key={t.id}
                  className={`card-box !p-0 overflow-hidden transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg ${
                    isDeleting ? "opacity-50 pointer-events-none" : ""
                  }`}
                >
                  <div className={`h-[180px] flex items-center justify-center relative ${meta.cardTint}`}>
                    {t.cover_image_path ? (
                      <img
                        src={t.cover_image_path}
                        alt={t.name}
                        className="w-full h-full object-cover"
                        onError={(e) => {
                          // 路徑壞掉時直接隱藏 img，露出底色 + ImageIcon
                          (e.currentTarget as HTMLImageElement).style.display = "none";
                        }}
                      />
                    ) : (
                      <div className="border-2 border-dashed border-gray-300 rounded-xl w-3/4 h-3/4 flex flex-col items-center justify-center gap-1">
                        <ImageIcon className="w-10 h-10 text-gray-300" />
                        <span className="text-xs text-gray-400">無封面圖</span>
                      </div>
                    )}
                    <span
                      className={`absolute top-3 right-3 px-2 py-0.5 text-xs font-medium rounded-full ${meta.pillCls}`}
                    >
                      {meta.label}
                    </span>
                    <span className="absolute top-3 left-3 px-1.5 py-0.5 text-[10px] font-medium rounded bg-white/80 text-gray-500">
                      #{t.sort_order ?? 0}
                    </span>
                  </div>
                  <div className="p-5">
                    <h3 className="text-base font-bold text-primary mb-1 truncate" title={t.name}>
                      {t.name}
                    </h3>
                    <p className="text-sm text-gray-500 line-clamp-2 mb-3 min-h-[2.5rem]">
                      {t.description || "—"}
                    </p>
                    <div className="flex items-center justify-between text-xs text-gray-400">
                      <span>建立於 {dateStr}</span>
                      <span>排序 {t.sort_order ?? 0}</span>
                    </div>
                    <div className="flex items-center justify-between mt-4 pt-3 border-t border-gray-100">
                      <button
                        onClick={() => setModal({ kind: "edit", exhibition: t })}
                        className="text-sm font-medium text-primary hover:underline cursor-pointer"
                      >
                        編輯
                      </button>
                      <button
                        onClick={() => handleDelete(t)}
                        disabled={isDeleting}
                        className="p-1.5 rounded-md text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors cursor-pointer disabled:cursor-not-allowed"
                        title="刪除展覽"
                      >
                        {isDeleting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}

      {/* Modal */}
      {modal.kind !== "closed" && (
        <ExhibitionModal
          mode={modal}
          defaultSortOrder={nextSortOrder}
          onClose={() => setModal({ kind: "closed" })}
          onSaved={async () => {
            setModal({ kind: "closed" });
            await fetchExhibitions();
          }}
        />
      )}
    </div>
  );
}

// ── Modal component ─────────────────────────────────────────────────────

interface ExhibitionModalProps {
  mode: Exclude<ModalMode, { kind: "closed" }>;
  defaultSortOrder: number;
  onClose: () => void;
  onSaved: () => Promise<void> | void;
}

function ExhibitionModal({ mode, defaultSortOrder, onClose, onSaved }: ExhibitionModalProps) {
  const initial: ExhibitionInput = mode.kind === "edit"
    ? {
        name: mode.exhibition.name,
        description: mode.exhibition.description ?? "",
        coverImagePath: mode.exhibition.cover_image_path ?? "",
        sortOrder: mode.exhibition.sort_order ?? 0,
        status: mode.exhibition.status,
      }
    : {
        name: "",
        description: "",
        coverImagePath: "",
        sortOrder: defaultSortOrder,
        status: "planning",
      };

  const [form, setForm] = useState<ExhibitionInput>(initial);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const isEdit = mode.kind === "edit";

  const handleSubmit = async () => {
    const trimmedName = form.name.trim();
    if (!trimmedName) {
      setSubmitError("展覽名稱為必填");
      return;
    }
    setSubmitting(true);
    setSubmitError(null);
    try {
      const payload: ExhibitionInput = {
        name: trimmedName,
        description: form.description?.trim() ?? "",
        coverImagePath: form.coverImagePath?.trim() ?? "",
        sortOrder: typeof form.sortOrder === "number" ? form.sortOrder : 0,
        status: form.status,
      };
      if (isEdit) {
        await patchExhibition(mode.exhibition.id, payload);
      } else {
        await createExhibition(payload);
      }
      await onSaved();
    } catch (e) {
      setSubmitError(formatMutationError(e));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 bg-black/30 z-50 flex items-center justify-center"
      onClick={() => !submitting && onClose()}
    >
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between sticky top-0 bg-white z-10">
          <h3 className="text-lg font-bold text-gray-900">{isEdit ? "編輯展覽" : "新增展覽"}</h3>
          <button
            onClick={onClose}
            disabled={submitting}
            className="p-1 rounded-lg hover:bg-gray-100 cursor-pointer disabled:cursor-not-allowed"
          >
            ✕
          </button>
        </div>
        <div className="p-6 space-y-5">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              展覽名稱 <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="例如：歲末祝福 2026"
              className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
              autoFocus
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">描述</label>
            <textarea
              rows={3}
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              placeholder="這場展覽的主旨、場地或對外文字（會出現在前台）"
              className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary resize-none"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">封面圖片 URL / 路徑</label>
            <input
              type="text"
              value={form.coverImagePath}
              onChange={(e) => setForm({ ...form, coverImagePath: e.target.value })}
              placeholder="https://… 或 Supabase Storage 內的路徑"
              className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
            />
            {form.coverImagePath && (
              <div className="mt-2 h-24 w-full rounded-lg overflow-hidden bg-gray-50 border border-gray-200">
                <img
                  src={form.coverImagePath}
                  alt="預覽"
                  className="w-full h-full object-cover"
                  onError={(e) => {
                    (e.currentTarget as HTMLImageElement).style.display = "none";
                  }}
                />
              </div>
            )}
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">
                排序（小→大）
              </label>
              <input
                type="number"
                value={form.sortOrder ?? 0}
                min={0}
                onChange={(e) => setForm({ ...form, sortOrder: Number(e.target.value) })}
                className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">狀態</label>
              <select
                value={form.status}
                onChange={(e) => setForm({ ...form, status: e.target.value as ExhibitionStatus })}
                className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm bg-white"
              >
                <option value="planning">籌備中（前台不顯示）</option>
                <option value="ongoing">進行中（前台顯示）</option>
                <option value="finished">已結束（前台仍可看見）</option>
              </select>
            </div>
          </div>
          {submitError && (
            <div className="px-3 py-2 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
              {submitError}
            </div>
          )}
        </div>
        <div className="px-6 py-4 border-t border-gray-100 flex justify-end gap-3 sticky bottom-0 bg-white">
          <button
            onClick={onClose}
            disabled={submitting}
            className="px-4 py-2 text-sm text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50 cursor-pointer disabled:cursor-not-allowed"
          >
            取消
          </button>
          <button
            onClick={handleSubmit}
            disabled={submitting}
            className="px-6 py-2 text-sm text-white bg-primary rounded-lg hover:bg-primary-light cursor-pointer font-medium disabled:bg-primary/60 disabled:cursor-not-allowed flex items-center gap-2"
          >
            {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
            {isEdit ? "儲存變更" : "儲存"}
          </button>
        </div>
      </div>
    </div>
  );
}
