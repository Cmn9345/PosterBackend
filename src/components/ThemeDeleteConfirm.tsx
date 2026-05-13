// src/components/ThemeDeleteConfirm.tsx
import { Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { deleteVocabularyTheme, querySupabase, type VocabularyTheme } from "../lib/api";

interface Props {
  theme: VocabularyTheme;
  onClose: () => void;
  onConfirmed: () => void;
}

/**
 * Delete confirmation that previews how many poster_files contain this theme
 * in their text[] (these get array_remove'd by the admin_delete_theme RPC).
 */
export function ThemeDeleteConfirm({ theme, onClose, onConfirmed }: Props) {
  const [affected, setAffected] = useState<number | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // PostgREST `cs` on text[] — `themes=cs.{name}` with curly braces encoded.
        const encoded = encodeURIComponent(`{${theme.name}}`);
        const rows = await querySupabase<{ id: string }>(
          "poster_files",
          `themes=cs.${encoded}&select=id&limit=10000`,
        );
        if (!cancelled) setAffected(rows.length);
      } catch (e) {
        if (!cancelled) setError(String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [theme.name]);

  const handleDelete = async () => {
    setDeleting(true);
    setError(null);
    try {
      await deleteVocabularyTheme(theme.id);
      onConfirmed();
    } catch (e) {
      setError(String(e));
      setDeleting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" onClick={onClose}>
      <div className="fixed inset-0 bg-black/40" />
      <div
        className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 py-5 space-y-3">
          <h3 className="text-lg font-semibold">即將刪除「{theme.name}」</h3>
          <p className="text-sm text-gray-600">
            {affected === null && "計算影響海報數中…"}
            {affected !== null && (
              <>
                此主題目前歸類了 <strong>{affected}</strong> 張海報，刪除後將從這些海報移除此歸類
                （海報本身不會被刪，其他主題保留）。
              </>
            )}
          </p>
          <p className="text-xs text-amber-600">
            ⚠️ VLM prompt 會在下次分析時自動排除此主題。
          </p>
          {error && <p className="text-sm text-red-500">{error}</p>}
        </div>
        <div className="px-6 py-3 border-t border-gray-100 flex items-center justify-end gap-2">
          <button
            onClick={onClose}
            disabled={deleting}
            className="px-4 py-2 text-sm rounded-lg border border-gray-200 hover:bg-gray-50 cursor-pointer disabled:opacity-50"
          >
            取消
          </button>
          <button
            onClick={handleDelete}
            disabled={deleting || affected === null}
            className="px-4 py-2 text-sm rounded-lg bg-red-600 text-white font-medium hover:bg-red-700 cursor-pointer disabled:opacity-50 inline-flex items-center gap-2"
          >
            {deleting && <Loader2 className="w-4 h-4 animate-spin" />}
            確認刪除
          </button>
        </div>
      </div>
    </div>
  );
}
