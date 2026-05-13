import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, X } from "lucide-react";
import type { AttachedPoster } from "../lib/api";

const statusPill: Record<string, { label: string; cls: string }> = {
  draft: { label: "草稿", cls: "bg-gray-100 text-gray-600" },
  pending_review: { label: "審核中", cls: "bg-amber-100 text-amber-700" },
  published: { label: "已發布", cls: "bg-green-100 text-green-700" },
  rejected: { label: "退件", cls: "bg-red-100 text-red-700" },
};

interface Props {
  attached: AttachedPoster;
  /** Pre-signed (or public) thumbnail URL. `null` shows placeholder. */
  thumbnailUrl: string | null;
  onRemove: () => void;
  removing?: boolean;
}

/**
 * Single attached poster row. The card itself is draggable (whole-card drag),
 * with an explicit grip icon on the left for affordance. Remove button has
 * `data-no-dnd` so clicking it doesn't start a drag (we wire that on the
 * useSortable activator below).
 */
export function SortablePosterCard({ attached, thumbnailUrl, onRemove, removing }: Props) {
  const id = attached.poster_id;
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const p = attached.posters;
  const st = p ? (statusPill[p.status] ?? { label: p.status, cls: "bg-gray-100 text-gray-600" }) : null;

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="flex items-center gap-3 p-3 bg-white border border-gray-200 rounded-lg hover:border-primary/40 transition-colors"
    >
      {/* Drag handle — listeners scoped to icon only */}
      <button
        type="button"
        {...attributes}
        {...listeners}
        className="text-gray-300 hover:text-gray-500 cursor-grab active:cursor-grabbing touch-none"
        aria-label="拖曳排序"
      >
        <GripVertical className="w-5 h-5" />
      </button>

      {/* Thumbnail */}
      <div className="w-12 h-12 rounded bg-gray-100 overflow-hidden flex-shrink-0">
        {thumbnailUrl ? (
          <img src={thumbnailUrl} alt="" className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-gray-300 text-xs">無預覽</div>
        )}
      </div>

      {/* Name + status */}
      <div className="flex-1 min-w-0">
        <h4 className="text-sm font-medium text-gray-800 truncate">
          {p?.project_name ?? "（未命名）"}
        </h4>
        {st && (
          <span className={`inline-block mt-0.5 px-1.5 py-0.5 text-[10px] rounded-full ${st.cls}`}>
            {st.label}
          </span>
        )}
      </div>

      {/* Remove button */}
      <button
        type="button"
        onClick={onRemove}
        disabled={removing}
        className="p-1.5 rounded text-gray-400 hover:text-red-500 hover:bg-red-50 cursor-pointer disabled:cursor-not-allowed"
        title="從此展覽移除"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}
