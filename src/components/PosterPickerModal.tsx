// src/components/PosterPickerModal.tsx
import { Loader2, Search, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { listPostersForPicker, type PickerPoster } from "../lib/api";

interface Props {
  /** poster ids already attached — disabled in the picker. */
  alreadyAttached: Set<string>;
  /** Resolve a picker poster to its pre-signed thumbnail URL, or null if unavailable.
   *  Caller reconstructs `{poster_id}/{file_id}_m.webp` since production schema
   *  has no `thumbnail_path` column. */
  resolveThumbnail: (poster: PickerPoster) => string | null;
  onClose: () => void;
  onConfirm: (posterIds: string[]) => void | Promise<void>;
}

const statusOptions: Array<{ value: string; label: string }> = [
  { value: "published", label: "已發布" },
  { value: "approved", label: "已通過" },
  { value: "pending_review", label: "審核中" },
  { value: "draft", label: "草稿" },
];

/**
 * Modal that lists candidate posters with search + status filter and lets
 * the user multi-select to attach. Defaults to status `published+approved`
 * per the spec (workers.dev only renders those anyway).
 */
export function PosterPickerModal({
  alreadyAttached,
  resolveThumbnail,
  onClose,
  onConfirm,
}: Props) {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string[]>(["published", "approved"]);
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [rows, setRows] = useState<PickerPoster[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [submitting, setSubmitting] = useState(false);

  // Debounce search 300ms.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  // Fetch on filter change.
  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const data = await listPostersForPicker(statusFilter, debouncedSearch || undefined);
        if (!cancelled) setRows(data);
      } catch (e) {
        if (!cancelled) setError(String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [statusFilter, debouncedSearch]);

  const toggleStatus = (v: string) => {
    setStatusFilter((prev) => (prev.includes(v) ? prev.filter((x) => x !== v) : [...prev, v]));
  };

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectedCount = selected.size;

  const sortedRows = useMemo(() => rows, [rows]);

  const handleConfirm = async () => {
    if (selectedCount === 0) return;
    setSubmitting(true);
    try {
      await onConfirm(Array.from(selected));
      onClose();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" onClick={onClose}>
      <div className="fixed inset-0 bg-black/40" />
      <div
        className="relative bg-white rounded-2xl shadow-2xl w-full max-w-4xl mx-4 max-h-[85vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
          <h3 className="text-lg font-semibold">從海報庫新增</h3>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-gray-100 cursor-pointer"
            aria-label="關閉"
          >
            <X className="w-5 h-5 text-gray-500" />
          </button>
        </div>

        {/* Search + filters */}
        <div className="px-6 py-3 border-b border-gray-100 space-y-2">
          <div className="relative">
            <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="搜尋海報名稱..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
            />
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {statusOptions.map((opt) => {
              const active = statusFilter.includes(opt.value);
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => toggleStatus(opt.value)}
                  className={`px-3 py-1 text-xs rounded-full border cursor-pointer transition ${
                    active
                      ? "bg-primary text-white border-primary"
                      : "bg-white text-gray-600 border-gray-200 hover:border-primary/40"
                  }`}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {loading && (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-6 h-6 text-primary animate-spin" />
            </div>
          )}
          {error && <p className="text-sm text-red-500">載入失敗：{error}</p>}
          {!loading && !error && sortedRows.length === 0 && (
            <p className="text-sm text-gray-400 text-center py-12">無符合的海報</p>
          )}
          {!loading && !error && sortedRows.length > 0 && (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
              {sortedRows.map((p) => {
                const attached = alreadyAttached.has(p.id);
                const isSelected = selected.has(p.id);
                const thumb = resolveThumbnail(p);
                return (
                  <label
                    key={p.id}
                    className={`block rounded-lg border overflow-hidden cursor-pointer transition ${
                      attached
                        ? "border-gray-100 bg-gray-50 opacity-60 cursor-not-allowed"
                        : isSelected
                          ? "border-primary ring-2 ring-primary/30"
                          : "border-gray-200 hover:border-primary/40"
                    }`}
                  >
                    <input
                      type="checkbox"
                      className="sr-only"
                      checked={isSelected}
                      disabled={attached}
                      onChange={() => toggleSelect(p.id)}
                    />
                    <div className="aspect-square bg-gray-100">
                      {thumb ? (
                        <img src={thumb} alt="" className="w-full h-full object-cover" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-gray-300 text-xs">
                          無預覽
                        </div>
                      )}
                    </div>
                    <div className="px-2 py-2">
                      <p className="text-xs font-medium text-gray-800 truncate">{p.project_name}</p>
                      <p className="text-[10px] text-gray-500 mt-0.5">
                        {attached ? "已掛" : p.status}
                      </p>
                    </div>
                  </label>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-gray-100 flex items-center justify-between">
          <p className="text-sm text-gray-500">已選 {selectedCount} 張</p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm rounded-lg border border-gray-200 hover:bg-gray-50 cursor-pointer"
            >
              取消
            </button>
            <button
              type="button"
              onClick={handleConfirm}
              disabled={selectedCount === 0 || submitting}
              className="px-4 py-2 text-sm rounded-lg bg-primary text-white font-medium hover:bg-primary/90 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            >
              {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
              新增 {selectedCount} 張
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
