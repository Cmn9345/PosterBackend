import { createFileRoute } from "@tanstack/react-router";
import { ChevronRight, Folder, FileText, Plus, Loader2 } from "lucide-react";
import { useState, useCallback, useEffect } from "react";
import { querySupabase } from "../lib/api";

export const Route = createFileRoute("/exhibition-structure")({
  component: ExhibitionStructure,
});

// ---------------------------------------------------------------------------
// Types & Data
// ---------------------------------------------------------------------------

interface TreeNode {
  id: string;
  name: string;
  posterCount: number;
  children?: TreeNode[];
}

// TODO: The exhibition_structure table likely returns flat rows with parent_id.
// The query needed is: select=id,name,parent_id,description,sort_order,poster_count,enabled
// Once the actual schema is confirmed, replace the mock tree-building logic below.

interface ExhibitionStructureRow {
  id: string;
  name: string;
  parent_id: string | null;
  description?: string;
  sort_order: number;
  poster_count?: number;
  enabled?: boolean;
}

/** Build a tree from flat rows with parent_id */
function buildTree(rows: ExhibitionStructureRow[]): TreeNode[] {
  const nodeMap = new Map<string, TreeNode>();
  const roots: TreeNode[] = [];

  for (const row of rows) {
    nodeMap.set(row.id, {
      id: row.id,
      name: row.name,
      posterCount: row.poster_count ?? 0,
      children: [],
    });
  }

  for (const row of rows) {
    const node = nodeMap.get(row.id)!;
    if (row.parent_id && nodeMap.has(row.parent_id)) {
      nodeMap.get(row.parent_id)!.children!.push(node);
    } else {
      roots.push(node);
    }
  }

  // Remove empty children arrays for leaf nodes
  for (const node of nodeMap.values()) {
    if (node.children && node.children.length === 0) {
      delete node.children;
    }
  }

  return roots;
}

/** Fallback mock data used when no real data is available */
const fallbackTreeData: TreeNode[] = [
  {
    id: "1",
    name: "歲末祝福 2026",
    posterCount: 12,
    children: [
      {
        id: "1-1",
        name: "主展區 - 靜思堂大廳",
        posterCount: 5,
        children: [
          { id: "1-1-1", name: "入口意象", posterCount: 2 },
          { id: "1-1-2", name: "歷史回顧", posterCount: 3 },
        ],
      },
      { id: "1-2", name: "展區 - 感恩廳", posterCount: 4 },
      { id: "1-3", name: "展區 - 戶外廣場", posterCount: 3 },
    ],
  },
  {
    id: "2",
    name: "浴佛節 2026",
    posterCount: 8,
    children: [
      { id: "2-1", name: "主舞台背板", posterCount: 3 },
      { id: "2-2", name: "會場動線", posterCount: 5 },
    ],
  },
  {
    id: "3",
    name: "國際賑災攝影展",
    posterCount: 6,
    children: [
      { id: "3-1", name: "土耳其專區", posterCount: 3 },
      { id: "3-2", name: "敘利亞專區", posterCount: 3 },
    ],
  },
  { id: "4", name: "環保推廣常設展", posterCount: 4 },
];

/** Sample poster data per selected node */
interface PosterThumb {
  label: string;
  name: string;
  gradient: string;
  textColor: string;
}

const postersByNode: Record<string, PosterThumb[]> = {
  "1-1": [
    { label: "環保海報", name: "慈濟環保海報 A0", gradient: "from-emerald-50 to-emerald-100", textColor: "text-emerald-400" },
    { label: "歲末祝福", name: "歲末祝福主視覺", gradient: "from-amber-50 to-amber-100", textColor: "text-amber-400" },
    { label: "年度回顧", name: "2025年度回顧展板", gradient: "from-blue-50 to-blue-100", textColor: "text-blue-400" },
    { label: "感恩海報", name: "感恩節海報設計", gradient: "from-violet-50 to-violet-100", textColor: "text-violet-400" },
    { label: "靜思語", name: "靜思語海報", gradient: "from-rose-50 to-rose-100", textColor: "text-rose-400" },
  ],
};

// Store description/row data for detail panel
let descriptionMap: Record<string, string> = {};
let rowDataMap: Record<string, ExhibitionStructureRow> = {};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Find a node by id and return [node, path] where path is ancestor names. */
function findNodeWithPath(
  nodes: TreeNode[],
  targetId: string,
  ancestors: string[] = [],
): { node: TreeNode; path: string[] } | null {
  for (const n of nodes) {
    if (n.id === targetId) return { node: n, path: ancestors };
    if (n.children) {
      const found = findNodeWithPath(n.children, targetId, [...ancestors, n.name]);
      if (found) return found;
    }
  }
  return null;
}

/** Compute the depth (0-based) of a node in the tree. */
function getNodeDepth(nodes: TreeNode[], targetId: string, depth = 0): number {
  for (const n of nodes) {
    if (n.id === targetId) return depth;
    if (n.children) {
      const d = getNodeDepth(n.children, targetId, depth + 1);
      if (d >= 0) return d;
    }
  }
  return -1;
}

const levelLabels = ["展覽", "展區", "子區"];

function getLevelBadge(depth: number): string {
  const label = levelLabels[depth] ?? "項目";
  return `第${depth === 0 ? "一" : depth === 1 ? "二" : "三"}層 · ${label}`;
}

// ---------------------------------------------------------------------------
// Tree Node Component
// ---------------------------------------------------------------------------

function TreeNodeComponent({
  node,
  level,
  expandedNodes,
  selectedId,
  onToggle,
  onSelect,
}: {
  node: TreeNode;
  level: number;
  expandedNodes: Set<string>;
  selectedId: string | null;
  onToggle: (id: string) => void;
  onSelect: (id: string) => void;
}) {
  const hasChildren = node.children && node.children.length > 0;
  const isExpanded = expandedNodes.has(node.id);
  const isSelected = selectedId === node.id;
  const isTopLevel = level === 0;

  return (
    <div>
      {/* Row */}
      <div
        onClick={() => onSelect(node.id)}
        className={`group flex items-center gap-2 py-2 px-3 rounded-lg cursor-pointer transition-colors ${
          isSelected
            ? "bg-[#F0F5FF] border-l-[3px] border-primary"
            : "hover:bg-gray-50"
        }`}
        style={{ paddingLeft: `${12 + level * 24}px` }}
      >
        {/* Expand/collapse chevron */}
        {hasChildren ? (
          <button
            className="w-5 h-5 flex items-center justify-center text-gray-400 hover:text-gray-600 shrink-0"
            onClick={(e) => {
              e.stopPropagation();
              onToggle(node.id);
            }}
          >
            <ChevronRight
              className={`w-4 h-4 transition-transform duration-150 ${
                isExpanded ? "rotate-90" : ""
              }`}
            />
          </button>
        ) : (
          <span className="w-5 shrink-0" />
        )}

        {/* Icon */}
        {hasChildren ? (
          <Folder className="w-4 h-4 text-gray-400 shrink-0" />
        ) : (
          <FileText className="w-4 h-4 text-gray-400 shrink-0" />
        )}

        {/* Name */}
        <span
          className={`text-sm flex-1 truncate ${
            isTopLevel ? "font-medium text-gray-700" : "text-gray-600"
          }`}
        >
          {node.name}
        </span>

        {/* Count badge */}
        <span className="text-xs text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded">
          {node.posterCount}
        </span>

        {/* Add child button (hover) */}
        {hasChildren && (
          <button
            className="w-5 h-5 items-center justify-center text-gray-300 hover:text-primary hidden group-hover:flex shrink-0"
            onClick={(e) => {
              e.stopPropagation();
              // TODO: Implement add child node via create_exhibition_structure invoke command
            }}
            title="新增子項目"
            disabled
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {/* Children */}
      {hasChildren && isExpanded && (
        <div>
          {node.children!.map((child) => (
            <TreeNodeComponent
              key={child.id}
              node={child}
              level={level + 1}
              expandedNodes={expandedNodes}
              selectedId={selectedId}
              onToggle={onToggle}
              onSelect={onSelect}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Detail Panel
// ---------------------------------------------------------------------------

function DetailPanel({ nodeId, treeData }: { nodeId: string; treeData: TreeNode[] }) {
  const result = findNodeWithPath(treeData, nodeId);
  if (!result) return null;

  const { node, path } = result;
  const depth = getNodeDepth(treeData, nodeId);

  const [name, setName] = useState(node.name);
  const [description, setDescription] = useState(
    descriptionMap[nodeId] ?? "",
  );
  const rowData = rowDataMap[nodeId];
  const [sortOrder, setSortOrder] = useState(rowData?.sort_order ?? 1);
  const [enabled, setEnabled] = useState(rowData?.enabled ?? true);

  const posters = postersByNode[nodeId] ?? [];

  return (
    <div className="card-box p-6">
      {/* Section 1: Header */}
      <div className="mb-6">
        <div className="flex items-center gap-3 mb-2">
          <h2 className="text-xl font-bold text-gray-800">{node.name}</h2>
          <span className="text-xs font-medium text-white bg-primary px-2.5 py-1 rounded-full whitespace-nowrap">
            {getLevelBadge(depth)}
          </span>
        </div>
        {/* Breadcrumb */}
        <div className="flex items-center gap-1.5 text-sm text-gray-400 flex-wrap">
          {path.map((seg, i) => (
            <span key={i} className="flex items-center gap-1.5">
              <span>{seg}</span>
              <ChevronRight className="w-3.5 h-3.5" />
            </span>
          ))}
          <span className="text-gray-600">{node.name}</span>
        </div>
      </div>

      <hr className="border-gray-100 mb-6" />

      {/* Section 2: Edit Form */}
      <div className="space-y-4 mb-6">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">
            名稱
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-colors"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">
            說明
          </label>
          <textarea
            rows={3}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-colors resize-none"
          />
        </div>
        <div className="flex gap-4">
          <div className="w-32">
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              排序
            </label>
            <input
              type="number"
              value={sortOrder}
              min={0}
              onChange={(e) => setSortOrder(Number(e.target.value))}
              className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-colors"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              狀態
            </label>
            <div className="flex items-center gap-3 py-2.5">
              <button
                type="button"
                onClick={() => setEnabled((v) => !v)}
                className={`relative w-11 h-6 rounded-full transition-colors cursor-pointer ${
                  enabled ? "bg-primary" : "bg-gray-300"
                }`}
              >
                <span
                  className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-all ${
                    enabled ? "left-[22px]" : "left-[2px]"
                  }`}
                />
              </button>
              <span className="text-sm text-gray-600">
                {enabled ? "啟用" : "停用"}
              </span>
            </div>
          </div>
        </div>
      </div>

      <hr className="border-gray-100 mb-6" />

      {/* Section 3: Included Posters */}
      <div className="mb-6">
        <h3 className="text-sm font-semibold text-gray-700 mb-3">
          包含海報 ({node.posterCount})
        </h3>
        {posters.length > 0 ? (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {posters.map((p, i) => (
              <div key={i} className="group">
                <div
                  className={`aspect-[3/4] bg-gradient-to-br ${p.gradient} rounded-lg flex items-center justify-center`}
                >
                  <span className={`${p.textColor} text-xs`}>{p.label}</span>
                </div>
                <p className="text-xs text-gray-600 mt-1 truncate">{p.name}</p>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-gray-400">尚無海報</p>
        )}
      </div>

      <hr className="border-gray-100 mb-6" />

      {/* Action Buttons */}
      <div className="flex items-center gap-3">
        <button
          type="button"
          className="px-5 py-2.5 bg-primary text-white text-sm font-medium rounded-xl hover:bg-primary-dark transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
          // TODO: Wire to update_exhibition_structure invoke command once available
          disabled
        >
          儲存
        </button>
        <button
          type="button"
          className="px-5 py-2.5 border border-gray-200 text-red-500 text-sm font-medium rounded-xl hover:bg-red-50 hover:border-red-200 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
          // TODO: Wire to delete_exhibition_structure invoke command once available
          disabled
        >
          刪除
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Empty State
// ---------------------------------------------------------------------------

function EmptyState() {
  return (
    <div className="card-box p-6">
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <Folder className="w-16 h-16 text-gray-200 mb-4" strokeWidth={1.5} />
        <p className="text-gray-400 text-sm">請從左側選擇展覽項目</p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Page
// ---------------------------------------------------------------------------

function ExhibitionStructure() {
  const [treeData, setTreeData] = useState<TreeNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(
    () => new Set<string>(),
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function fetchStructure() {
      setLoading(true);
      setError(null);
      try {
        const rows = await querySupabase<ExhibitionStructureRow>(
          "exhibition_structure",
          "order=sort_order",
        );
        if (cancelled) return;

        if (rows.length > 0) {
          // Build description and row data maps
          descriptionMap = {};
          rowDataMap = {};
          for (const row of rows) {
            if (row.description) descriptionMap[row.id] = row.description;
            rowDataMap[row.id] = row;
          }

          const tree = buildTree(rows);
          setTreeData(tree);

          // Auto-expand top-level nodes
          const topIds = new Set(tree.map((n) => n.id));
          setExpandedNodes(topIds);
        } else {
          // No data from API -- use fallback mock data
          // TODO: Remove fallback once exhibition_structure table is populated
          setTreeData(fallbackTreeData);
          setExpandedNodes(new Set(["1", "1-1", "2"]));
          setSelectedId("1-1");
        }
      } catch (e) {
        if (!cancelled) {
          setError(String(e));
          // Fall back to mock data on error so the UI remains usable
          setTreeData(fallbackTreeData);
          setExpandedNodes(new Set(["1", "1-1", "2"]));
          setSelectedId("1-1");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    fetchStructure();
    return () => { cancelled = true; };
  }, []);

  const handleToggle = useCallback((id: string) => {
    setExpandedNodes((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const handleSelect = useCallback((id: string) => {
    setSelectedId(id);
  }, []);

  return (
    <div className="max-w-[1400px] mx-auto px-4 sm:px-6 py-8">
      {/* Page Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-primary">展覽結構</h1>
        <p className="text-sm text-gray-500 mt-1">
          管理展覽的層級架構，組織展區與子區的海報配置
        </p>
      </div>

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-8 h-8 text-primary animate-spin" />
        </div>
      )}

      {/* Error banner (non-blocking since we fall back to mock data) */}
      {error && (
        <div className="mb-4 px-4 py-2 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-700">
          無法載入展覽結構資料，目前顯示範例資料。({error})
        </div>
      )}

      {/* Two-column layout */}
      {!loading && (
        <div className="flex flex-col lg:flex-row gap-6">
          {/* Left Column: Tree */}
          <div className="w-full lg:w-[320px] lg:shrink-0">
            <div className="card-box p-4">
              {/* Tree header */}
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-semibold text-gray-700">展覽結構</h2>
                <button
                  className="text-xs text-primary font-medium hover:text-primary-light px-2 py-1 rounded hover:bg-primary/5 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                  // TODO: Implement create_exhibition invoke command
                  disabled
                >
                  + 新增
                </button>
              </div>

              {/* Tree */}
              <div className="space-y-0.5">
                {treeData.map((node) => (
                  <TreeNodeComponent
                    key={node.id}
                    node={node}
                    level={0}
                    expandedNodes={expandedNodes}
                    selectedId={selectedId}
                    onToggle={handleToggle}
                    onSelect={handleSelect}
                  />
                ))}
              </div>
            </div>
          </div>

          {/* Right Column: Detail */}
          <div className="flex-1 min-w-0">
            {selectedId ? (
              <DetailPanel key={selectedId} nodeId={selectedId} treeData={treeData} />
            ) : (
              <EmptyState />
            )}
          </div>
        </div>
      )}
    </div>
  );
}
