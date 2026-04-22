import { createFileRoute, Link } from "@tanstack/react-router";
import { Plus, Search, X, Loader2 } from "lucide-react";
import { useState, useEffect, useMemo, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";

export const Route = createFileRoute("/posters/")({
  component: PosterList,
});

type PosterStatus =
  | "draft"
  | "uploading"
  | "processing"
  | "pending_review"
  | "approved"
  | "rejected"
  | "published"
  | "archived";
type MaterialAttr = "none" | "logo" | "restricted" | "special";

interface Project {
  id: string;
  name: string;
  category: string;
  material: MaterialAttr;
  status: PosterStatus;
  uploader: string;
  date: string;
  thumbColor: string;
  thumbLabel: string;
  rejectReason?: string;
}

const statusBadge: Record<PosterStatus, string> = {
  draft: "bg-gray-100 text-gray-600",
  uploading: "bg-blue-50 text-blue-700",
  processing: "bg-indigo-50 text-indigo-700",
  pending_review: "bg-yellow-50 text-yellow-700",
  approved: "bg-emerald-50 text-emerald-700",
  published: "bg-green-50 text-green-700",
  rejected: "bg-red-50 text-red-700",
  archived: "bg-gray-100 text-gray-500",
};

const statusLabel: Record<PosterStatus, string> = {
  draft: "草稿",
  uploading: "上傳中",
  processing: "處理中",
  pending_review: "待審核",
  approved: "已核可",
  published: "已上架",
  rejected: "已退回",
  archived: "已下架",
};

const materialBadge: Record<MaterialAttr, { cls: string; label: string }> = {
  none: { cls: "bg-green-50 text-green-700", label: "一般" },
  logo: { cls: "bg-gray-100 text-gray-600", label: "Logo" },
  restricted: { cls: "bg-red-50 text-red-700", label: "限用圖" },
  special: { cls: "bg-pink-50 text-pink-700", label: "特殊人物" },
};

const defaultThumbColors = [
  "from-emerald-50 to-emerald-100",
  "from-amber-50 to-amber-100",
  "from-blue-50 to-blue-100",
  "from-gray-100 to-gray-200",
  "from-rose-50 to-rose-100",
  "from-slate-100 to-slate-200",
  "from-indigo-50 to-indigo-100",
  "from-purple-50 to-purple-100",
];

function PosterList() {
  const [activeTab, setActiveTab] = useState("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [posters, setPosters] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [materialFilter, setMaterialFilter] = useState("");
  const [batchLoading, setBatchLoading] = useState(false);

  const fetchProjects = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data: any[] = await invoke<any[]>("list_projects");
      const mapped: Project[] = data.map((item, idx) => ({
        id: item.id ?? `P-${idx}`,
        name: item.name ?? "",
        category: item.category ?? "海報",
        material: item.material ?? "none",
        status: item.status ?? "draft",
        uploader: item.uploader ?? "",
        date: item.date ?? item.created_at?.substring(0, 10) ?? "",
        thumbColor: item.thumbColor ?? defaultThumbColors[idx % defaultThumbColors.length],
        thumbLabel: item.thumbLabel ?? (item.name ? item.name.substring(0, 4) : ""),
        rejectReason: item.rejectReason ?? item.reject_reason ?? undefined,
      }));
      setPosters(mapped);
    } catch (err) {
      console.error("Failed to load projects:", err);
      setError(typeof err === "string" ? err : "載入專案失敗，請稍後再試");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchProjects();
  }, [fetchProjects]);

  // Computed counts per status
  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = { all: posters.length };
    for (const p of posters) {
      counts[p.status] = (counts[p.status] ?? 0) + 1;
    }
    return counts;
  }, [posters]);

  const tabs = useMemo(() => [
    { key: "all", label: "全部", badge: "bg-gray-100 text-gray-600" },
    { key: "draft", label: "草稿", badge: "bg-gray-100 text-gray-600" },
    { key: "processing", label: "處理中", badge: "bg-indigo-100 text-indigo-700" },
    { key: "pending_review", label: "待審核", badge: "bg-yellow-100 text-yellow-700" },
    { key: "approved", label: "已核可", badge: "bg-emerald-100 text-emerald-700" },
    { key: "published", label: "已上架", badge: "bg-green-100 text-green-700" },
    { key: "rejected", label: "已退回", badge: "bg-red-100 text-red-700" },
    { key: "archived", label: "已下架", badge: "bg-gray-100 text-gray-500" },
  ], []);

  // Filtered list based on active tab, search, category, material
  const filteredPosters = useMemo(() => {
    let list = posters;

    // Tab filter
    if (activeTab !== "all") {
      list = list.filter((p) => p.status === activeTab);
    }

    // Search filter
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      list = list.filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          p.id.toLowerCase().includes(q)
      );
    }

    // Category filter
    if (categoryFilter) {
      list = list.filter((p) => p.category === categoryFilter);
    }

    // Material filter
    if (materialFilter) {
      const matMap: Record<string, MaterialAttr> = {
        "一般": "none",
        "限用圖": "restricted",
        "Logo": "logo",
        "特殊人物": "special",
      };
      const matKey = matMap[materialFilter];
      if (matKey) {
        list = list.filter((p) => p.material === matKey);
      }
    }

    return list;
  }, [posters, activeTab, searchQuery, categoryFilter, materialFilter]);

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (selected.size === filteredPosters.length) setSelected(new Set());
    else setSelected(new Set(filteredPosters.map((p) => p.id)));
  };

  const handleBatchArchive = async () => {
    if (selected.size === 0) return;
    setBatchLoading(true);
    try {
      for (const projectId of selected) {
        await invoke("update_project_status", { projectId, status: "archived" });
      }
      setSelected(new Set());
      await fetchProjects();
    } catch (err) {
      console.error("Batch archive failed:", err);
      alert("批次下架失敗: " + (typeof err === "string" ? err : "請稍後再試"));
    } finally {
      setBatchLoading(false);
    }
  };

  const handleBatchDelete = async () => {
    if (selected.size === 0) return;
    const confirmed = window.confirm(
      `確定要永久刪除所選的 ${selected.size} 項海報嗎？\n\n會一併移除 Supabase Storage 的原檔與縮圖，此操作無法復原。`,
    );
    if (!confirmed) return;
    setBatchLoading(true);
    const failed: string[] = [];
    for (const projectId of selected) {
      try {
        await invoke("delete_project", { projectId });
      } catch (err) {
        console.error(`delete ${projectId} failed:`, err);
        failed.push(projectId);
      }
    }
    setSelected(new Set());
    await fetchProjects();
    setBatchLoading(false);
    if (failed.length > 0) {
      alert(
        `${selected.size - failed.length}/${selected.size} 已刪除，${failed.length} 筆失敗：\n` +
          failed.slice(0, 5).join("\n"),
      );
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-primary">海報管理</h1>
          <div className="mt-2 bg-[#F0F5FF] border-l-[3px] border-primary px-4 py-2 rounded-r-lg">
            <p className="text-sm text-primary">您的身份：建檔者 — 可上傳、編輯自己的海報</p>
          </div>
        </div>
        <Link
          to="/posters/upload"
          className="px-5 py-2.5 bg-primary text-white text-sm font-medium rounded-lg hover:bg-primary-light transition-colors flex items-center gap-2"
        >
          <Plus className="w-4 h-4" />
          新增海報
        </Link>
      </div>

      {/* Tabs + Filter + Table */}
      <div className="card-box !p-0">
        {/* Tabs */}
        <div className="flex items-center border-b border-gray-100 px-4 overflow-x-auto" role="tablist">
          {tabs.map((t) => (
            <button
              key={t.key}
              role="tab"
              aria-selected={activeTab === t.key}
              onClick={() => {
                setActiveTab(t.key);
                setSelected(new Set());
              }}
              className={`px-4 py-3 text-sm whitespace-nowrap border-b-2 transition-colors cursor-pointer ${
                activeTab === t.key
                  ? "text-primary border-primary font-semibold"
                  : "text-gray-500 border-transparent hover:text-primary"
              }`}
            >
              {t.label}
              <span className={`ml-1.5 px-1.5 py-0.5 text-[10px] font-bold rounded-full ${t.badge}`}>
                {statusCounts[t.key] ?? 0}
              </span>
            </button>
          ))}
        </div>

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-3 px-4 py-3 border-b border-gray-100">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="搜尋名稱或編號..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
            />
          </div>
          <select
            className="px-3 py-2 text-sm border border-gray-200 rounded-lg bg-white"
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
          >
            <option value="">品項分類</option>
            <option>海報</option>
            <option>展板</option>
            <option>布條</option>
            <option>旗幟</option>
          </select>
          <select
            className="px-3 py-2 text-sm border border-gray-200 rounded-lg bg-white"
            value={materialFilter}
            onChange={(e) => setMaterialFilter(e.target.value)}
          >
            <option value="">素材屬性</option>
            <option>一般</option>
            <option>限用圖</option>
            <option>Logo</option>
            <option>特殊人物</option>
          </select>
        </div>

        {/* Loading State */}
        {loading && (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="w-8 h-8 text-primary animate-spin" />
            <span className="ml-3 text-sm text-gray-500">載入中...</span>
          </div>
        )}

        {/* Error State */}
        {error && !loading && (
          <div className="flex flex-col items-center justify-center py-16">
            <p className="text-sm text-red-500 mb-3">{error}</p>
            <button
              onClick={fetchProjects}
              className="px-4 py-2 text-sm text-primary border border-primary rounded-lg hover:bg-primary/5 cursor-pointer"
            >
              重新載入
            </button>
          </div>
        )}

        {/* Empty State */}
        {!loading && !error && filteredPosters.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16">
            <p className="text-sm text-gray-500">沒有符合條件的海報</p>
          </div>
        )}

        {/* Table */}
        {!loading && !error && filteredPosters.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs font-medium text-gray-500 uppercase tracking-wider border-b border-gray-100">
                  <th className="px-4 py-3 w-10">
                    <input
                      type="checkbox"
                      checked={selected.size > 0 && selected.size === filteredPosters.length}
                      onChange={toggleAll}
                      className="accent-primary"
                    />
                  </th>
                  <th className="px-4 py-3">縮圖</th>
                  <th className="px-4 py-3">上架編號</th>
                  <th className="px-4 py-3">名稱</th>
                  <th className="px-4 py-3">品項分類</th>
                  <th className="px-4 py-3">素材屬性</th>
                  <th className="px-4 py-3">狀態</th>
                  <th className="px-4 py-3">上傳者</th>
                  <th className="px-4 py-3">上傳日期</th>
                  <th className="px-4 py-3 text-center">操作</th>
                </tr>
              </thead>
              <tbody>
                {filteredPosters.map((p) => (
                  <tr
                    key={p.id}
                    className={`border-b border-gray-50 transition-colors hover:bg-gray-50/50 ${
                      p.status === "rejected" ? "border-l-4 border-l-red-500 bg-red-50/30" : ""
                    }`}
                  >
                    <td className="px-4 py-3">
                      <input
                        type="checkbox"
                        checked={selected.has(p.id)}
                        onChange={() => toggleSelect(p.id)}
                        className="accent-primary"
                      />
                    </td>
                    <td className="px-4 py-3">
                      <div className={`w-12 h-12 bg-gradient-to-br ${p.thumbColor} rounded-lg flex items-center justify-center`}>
                        <span className="text-[10px] text-gray-400">{p.thumbLabel}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-primary font-medium">{p.id}</td>
                    <td className="px-4 py-3">
                      <div>{p.name}</div>
                      {p.rejectReason && <div className="text-xs text-red-500 mt-0.5">{p.rejectReason}</div>}
                    </td>
                    <td className="px-4 py-3 text-gray-500">{p.category}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-block px-2 py-0.5 text-xs rounded-full ${materialBadge[p.material]?.cls ?? "bg-gray-100 text-gray-600"}`}>
                        {materialBadge[p.material]?.label ?? p.material}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-block px-2.5 py-1 text-xs font-medium rounded-full ${statusBadge[p.status] ?? "bg-gray-100 text-gray-600"}`}>
                        {statusLabel[p.status] ?? p.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-500">{p.uploader}</td>
                    <td className="px-4 py-3 text-gray-500">{p.date}</td>
                    <td className="px-4 py-3 text-center">
                      <Link to="/posters/$projectId/edit" params={{ projectId: p.id }} className="text-xs font-medium text-primary hover:underline cursor-pointer">編輯</Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination */}
        {!loading && !error && filteredPosters.length > 0 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100">
            <span className="text-sm text-gray-500">
              共 {statusCounts[activeTab] ?? 0} 筆，顯示 1 - {filteredPosters.length} 筆
            </span>
            <div className="flex items-center gap-1">
              <button className="px-3 py-1.5 text-sm text-white bg-primary rounded-lg">1</button>
            </div>
          </div>
        )}
      </div>

      {/* Batch Bar */}
      {selected.size > 0 && (
        <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 px-6 py-3 flex items-center justify-between z-30 shadow-lg">
          <span className="text-sm text-gray-600">
            已選取 <strong>{selected.size}</strong> 項
          </span>
          <div className="flex items-center gap-3">
            <button
              onClick={handleBatchArchive}
              disabled={batchLoading}
              className="px-4 py-2 text-sm text-gray-600 bg-gray-100 rounded-lg hover:bg-gray-200 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {batchLoading ? "處理中..." : "批次下架"}
            </button>
            <button
              onClick={handleBatchDelete}
              disabled={batchLoading}
              className="px-4 py-2 text-sm text-red-600 bg-red-50 rounded-lg hover:bg-red-100 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {batchLoading ? "處理中..." : "批次刪除"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
