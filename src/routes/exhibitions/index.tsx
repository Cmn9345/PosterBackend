import { createFileRoute } from "@tanstack/react-router";
import { Plus, Search, ImageIcon, Loader2 } from "lucide-react";
import { useState, useEffect, useMemo } from "react";
import { querySupabase } from "../../lib/api";

export const Route = createFileRoute("/exhibitions/")({
  component: ThemeCuration,
});

interface Exhibition {
  id: string;
  name: string;
  description: string;
  poster_count: number;
  created_at: string;
  status: "published" | "draft";
  cover_gradient?: string;
  cover_text?: string;
}

/** Fallback gradient based on index */
const fallbackGradients = [
  "from-blue-50 to-blue-100",
  "from-amber-50 to-amber-100",
  "from-emerald-50 to-emerald-100",
  "from-green-50 to-green-100",
  "from-violet-50 to-violet-100",
  "from-rose-50 to-rose-100",
];

function ThemeCuration() {
  const [showModal, setShowModal] = useState(false);
  const [exhibitions, setExhibitions] = useState<Exhibition[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "published" | "draft">("all");

  useEffect(() => {
    let cancelled = false;
    async function fetchExhibitions() {
      setLoading(true);
      setError(null);
      try {
        const data = await querySupabase<Exhibition>("exhibitions", "order=created_at.desc");
        if (!cancelled) setExhibitions(data);
      } catch (e) {
        if (!cancelled) setError(String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    fetchExhibitions();
    return () => { cancelled = true; };
  }, []);

  const filteredExhibitions = useMemo(() => {
    return exhibitions.filter((t) => {
      if (statusFilter !== "all" && t.status !== statusFilter) return false;
      if (searchQuery && !t.name.includes(searchQuery) && !t.description?.includes(searchQuery)) return false;
      return true;
    });
  }, [exhibitions, searchQuery, statusFilter]);

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-primary">主題展覽管理</h1>
          <p className="text-sm text-gray-500 mt-1">管理主題展覽，策劃海報合集供前台展示</p>
        </div>
        <button
          onClick={() => setShowModal(true)}
          className="px-5 py-2.5 bg-primary text-white text-sm font-medium rounded-lg hover:bg-primary-light transition-colors flex items-center gap-2"
        >
          <Plus className="w-4 h-4" />
          新增主題
        </button>
      </div>

      {/* Filter */}
      <div className="flex flex-wrap items-center gap-3 mb-6">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="搜尋主題名稱..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
          />
        </div>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as "all" | "published" | "draft")}
          className="px-3 py-2 text-sm border border-gray-200 rounded-lg bg-white"
        >
          <option value="all">全部</option>
          <option value="published">已發布</option>
          <option value="draft">草稿</option>
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
        </div>
      )}

      {/* Card Grid */}
      {!loading && !error && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredExhibitions.length === 0 ? (
            <div className="col-span-full text-center py-12">
              <p className="text-gray-400 text-sm">無符合條件的展覽</p>
            </div>
          ) : (
            filteredExhibitions.map((t, idx) => {
              const gradient = t.cover_gradient || fallbackGradients[idx % fallbackGradients.length];
              const coverText = t.cover_text ?? (t.status === "draft" ? "" : t.name.slice(0, 4));
              const dateStr = t.created_at ? t.created_at.slice(0, 10) : "";
              const posterCount = t.poster_count ?? 0;

              return (
                <div
                  key={t.id}
                  className="card-box !p-0 overflow-hidden transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg cursor-pointer"
                >
                  <div className={`h-[180px] bg-gradient-to-br ${gradient} flex items-center justify-center relative`}>
                    {t.status === "draft" && !coverText ? (
                      <div className="border-2 border-dashed border-gray-300 rounded-xl w-3/4 h-3/4 flex items-center justify-center">
                        <ImageIcon className="w-10 h-10 text-gray-300" />
                      </div>
                    ) : (
                      <span className="text-2xl font-bold text-gray-300/60">{coverText}</span>
                    )}
                    <span
                      className={`absolute top-3 right-3 px-2 py-0.5 text-xs font-medium rounded-full ${
                        t.status === "published" ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-600"
                      }`}
                    >
                      {t.status === "published" ? "已發布" : "草稿"}
                    </span>
                  </div>
                  <div className="p-5">
                    <h3 className="text-base font-bold text-primary mb-1">{t.name}</h3>
                    <p className="text-sm text-gray-500 line-clamp-2 mb-3">{t.description}</p>
                    <div className="flex items-center justify-between text-xs text-gray-400">
                      <span className={posterCount === 0 ? "text-amber-500 font-medium" : ""}>
                        收錄 {posterCount} 張海報
                      </span>
                      <span>{dateStr}</span>
                    </div>
                    <div className="flex items-center gap-3 mt-4 pt-3 border-t border-gray-100">
                      <button className="text-sm font-medium text-primary hover:underline">編輯</button>
                      <button className="text-sm font-medium text-primary hover:underline">管理海報</button>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}

      {/* Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/30 z-50 flex items-center justify-center" onClick={() => setShowModal(false)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg mx-4" onClick={(e) => e.stopPropagation()}>
            <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
              <h3 className="text-lg font-bold text-gray-900">新增主題</h3>
              <button onClick={() => setShowModal(false)} className="p-1 rounded-lg hover:bg-gray-100 cursor-pointer">✕</button>
            </div>
            <div className="p-6 space-y-5">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">主題名稱 <span className="text-red-500">*</span></label>
                <input type="text" placeholder="請輸入主題名稱" className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">描述</label>
                <textarea rows={3} placeholder="請輸入主題描述" className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary resize-none" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">狀態</label>
                <select className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm bg-white">
                  <option>草稿</option>
                  <option>已發布</option>
                </select>
              </div>
            </div>
            <div className="px-6 py-4 border-t border-gray-100 flex justify-end gap-3">
              <button onClick={() => setShowModal(false)} className="px-4 py-2 text-sm text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50 cursor-pointer">取消</button>
              {/* TODO: Wire to create_exhibition invoke command once available */}
              <button className="px-6 py-2 text-sm text-white bg-primary rounded-lg hover:bg-primary-light cursor-pointer font-medium">儲存</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
