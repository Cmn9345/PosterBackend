// src/components/ThemeEditModal.tsx
import { Loader2, X } from "lucide-react";
import { useState } from "react";
import {
  createVocabularyTheme,
  updateVocabularyTheme,
  type VocabularyTheme,
} from "../lib/api";

interface Props {
  /** Existing theme to edit, or null for create mode. */
  initial: VocabularyTheme | null;
  onClose: () => void;
  onSaved: () => void;
}

/**
 * Add/edit a vocabulary_theme. The rename-warning surfaces when initial.name
 * differs from the new value, because that triggers a cascade UPDATE across
 * poster_files.themes arrays (server-side, transactional).
 */
export function ThemeEditModal({ initial, onClose, onSaved }: Props) {
  const isEdit = !!initial;
  const [name, setName] = useState(initial?.name ?? "");
  const [code, setCode] = useState(initial?.code ?? "");
  const [icon, setIcon] = useState(initial?.icon ?? "");
  const [color, setColor] = useState(initial?.color ?? "");
  const [bgColor, setBgColor] = useState(initial?.bg_color ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [coverImage, setCoverImage] = useState(initial?.cover_image ?? "");
  const [sortOrder, setSortOrder] = useState(initial?.sort_order ?? 0);
  const [isActive, setIsActive] = useState(initial?.is_active ?? true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const nameChanged = isEdit && name.trim() !== (initial?.name ?? "");

  const handleSubmit = async () => {
    if (!name.trim()) {
      setError("主題名稱不可為空");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      if (isEdit && initial) {
        await updateVocabularyTheme(initial.id, name.trim(), {
          code: code || undefined,
          icon: icon || undefined,
          color: color || undefined,
          bgColor: bgColor || undefined,
          description: description || undefined,
          coverImage: coverImage || undefined,
          sortOrder,
          isActive,
        });
      } else {
        await createVocabularyTheme({
          name: name.trim(),
          code: code || undefined,
          icon: icon || undefined,
          color: color || undefined,
          bgColor: bgColor || undefined,
          description: description || undefined,
          coverImage: coverImage || undefined,
          sortOrder,
          isActive,
        });
      }
      onSaved();
      onClose();
    } catch (e) {
      setError(String(e));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" onClick={onClose}>
      <div className="fixed inset-0 bg-black/40" />
      <div
        className="relative bg-white rounded-2xl shadow-2xl w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
          <h3 className="text-lg font-semibold">
            {isEdit ? "編輯主題" : "新增主題"}
          </h3>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 cursor-pointer">
            <X className="w-5 h-5 text-gray-500" />
          </button>
        </div>

        <div className="px-6 py-4 space-y-3">
          <Field label="名稱 *">
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:ring-2 focus:ring-primary/20 focus:border-primary"
            />
            {nameChanged && (
              <p className="text-xs text-amber-600 mt-1">
                ⚠️ 改名會同步更新所有已歸入此主題的海報（後端交易內處理）
              </p>
            )}
          </Field>

          <Field label="代號 (slug)">
            <input
              type="text"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="例如：charity"
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg"
            />
          </Field>

          <div className="grid grid-cols-3 gap-3">
            <Field label="Icon (emoji)">
              <input
                type="text"
                value={icon}
                onChange={(e) => setIcon(e.target.value)}
                maxLength={4}
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg"
              />
            </Field>
            <Field label="主色">
              <input
                type="text"
                value={color}
                onChange={(e) => setColor(e.target.value)}
                placeholder="#dc2626"
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg"
              />
            </Field>
            <Field label="底色">
              <input
                type="text"
                value={bgColor}
                onChange={(e) => setBgColor(e.target.value)}
                placeholder="#fee2e2"
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg"
              />
            </Field>
          </div>

          <Field label="描述">
            <textarea
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg"
            />
          </Field>

          <Field label="封面圖路徑">
            <input
              type="text"
              value={coverImage}
              onChange={(e) => setCoverImage(e.target.value)}
              placeholder="/charity-helping-hands.jpg"
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg"
            />
          </Field>

          <div className="flex items-center gap-4">
            <Field label="排序">
              <input
                type="number"
                value={sortOrder}
                onChange={(e) => setSortOrder(Number(e.target.value) || 0)}
                className="w-24 px-3 py-2 text-sm border border-gray-200 rounded-lg"
              />
            </Field>
            <label className="inline-flex items-center gap-2 mt-5">
              <input
                type="checkbox"
                checked={isActive}
                onChange={(e) => setIsActive(e.target.checked)}
                className="rounded"
              />
              <span className="text-sm">啟用</span>
            </label>
          </div>

          {error && <p className="text-sm text-red-500">{error}</p>}
        </div>

        <div className="px-6 py-3 border-t border-gray-100 flex items-center justify-end gap-2">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm rounded-lg border border-gray-200 hover:bg-gray-50 cursor-pointer"
          >
            取消
          </button>
          <button
            onClick={handleSubmit}
            disabled={submitting}
            className="px-4 py-2 text-sm rounded-lg bg-primary text-white font-medium hover:bg-primary/90 cursor-pointer disabled:opacity-50 inline-flex items-center gap-2"
          >
            {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
            儲存
          </button>
        </div>
      </div>
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
