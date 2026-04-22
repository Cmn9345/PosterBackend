/**
 * opfsModelCache — OPFS 模型快取工具
 * ====================================
 * 使用 Origin Private File System (OPFS) 持久化儲存 AI 模型檔案。
 * 作為 Cache API 的可靠備援機制，避免瀏覽器自動清除快取。
 * - Key: URL 轉換為安全檔名
 * - Value: Response body (ArrayBuffer)
 * - 支援儲存持久化請求 (navigator.storage.persist)
 */

const OPFS_DIR = 'model-cache'

// ============================================================
// URL → 安全檔名轉換
// ============================================================

/** 將 URL 轉換為安全的 OPFS 檔名（host+pathname，特殊字元替換為 _，最長 200 字元） */
export function urlToKey(url: string): string {
  try {
    const parsed = new URL(url)
    const raw = parsed.host + parsed.pathname
    // 將非英數、非 - . 的字元替換為底線
    const safe = raw.replace(/[^a-zA-Z0-9\-_.]/g, '_')
    // 截斷至 200 字元（保留尾部以保存檔名如 model.onnx）
    return safe.length > 200 ? safe.slice(-200) : safe
  } catch {
    // 若 URL 解析失敗，直接替換特殊字元
    const safe = url.replace(/[^a-zA-Z0-9\-_.]/g, '_')
    return safe.length > 200 ? safe.slice(-200) : safe
  }
}

// ============================================================
// 瀏覽器支援偵測
// ============================================================

/** 檢查瀏覽器是否支援 OPFS */
export function isSupported(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    'storage' in navigator &&
    'getDirectory' in navigator.storage
  )
}

// ============================================================
// 內部工具函數
// ============================================================

/** 取得 OPFS 模型快取目錄（自動建立） */
async function getModelDir(): Promise<FileSystemDirectoryHandle> {
  const root = await navigator.storage.getDirectory()
  return root.getDirectoryHandle(OPFS_DIR, { create: true })
}

// ============================================================
// Public API
// ============================================================

/** 檢查指定 URL 是否已快取在 OPFS */
export async function has(url: string): Promise<boolean> {
  try {
    const dir = await getModelDir()
    const key = urlToKey(url)
    await dir.getFileHandle(key)
    return true
  } catch {
    return false
  }
}

/** 從 OPFS 讀取快取，回傳 Response（含 X-OPFS-Cache: hit 標頭）；未命中回傳 null */
export async function get(url: string): Promise<Response | null> {
  try {
    const dir = await getModelDir()
    const key = urlToKey(url)
    const fileHandle = await dir.getFileHandle(key)
    const file = await fileHandle.getFile()
    const buffer = await file.arrayBuffer()

    return new Response(buffer, {
      status: 200,
      headers: {
        'Content-Length': String(buffer.byteLength),
        'X-OPFS-Cache': 'hit',
      },
    })
  } catch {
    return null
  }
}

/** 將 Response body 寫入 OPFS 快取；寫入失敗時自動清除不完整檔案 */
export async function put(url: string, response: Response): Promise<void> {
  const key = urlToKey(url)
  let dir: FileSystemDirectoryHandle | null = null
  try {
    dir = await getModelDir()
    const buffer = await response.arrayBuffer()
    const fileHandle = await dir.getFileHandle(key, { create: true })
    // 使用 createWritable 寫入檔案
    const writable = await fileHandle.createWritable()
    try {
      await writable.write(buffer)
      await writable.close()
    } catch (writeErr) {
      // 寫入失敗，嘗試關閉 writable
      try { await writable.close() } catch { /* 忽略關閉錯誤 */ }
      throw writeErr
    }
  } catch (err) {
    // 寫入失敗時清除不完整檔案
    if (dir) {
      try {
        await dir.removeEntry(key)
      } catch {
        // 清除失敗可忽略
      }
    }
    console.warn('[opfsModelCache] put failed:', err)
    throw err
  }
}

/** 刪除指定 URL 的快取檔案 */
export async function remove(url: string): Promise<void> {
  try {
    const dir = await getModelDir()
    const key = urlToKey(url)
    await dir.removeEntry(key)
  } catch {
    // 檔案不存在或刪除失敗，靜默忽略
  }
}

/** 列出所有快取檔案的名稱與大小 */
export async function list(): Promise<{ name: string; size: number }[]> {
  try {
    const dir = await getModelDir()
    const entries: { name: string; size: number }[] = []

    // OPFS directory iteration 需要型別轉換
    for await (const [name, handle] of (dir as any).entries()) {
      if (handle.kind === 'file') {
        try {
          const file = await (handle as FileSystemFileHandle).getFile()
          entries.push({ name, size: file.size })
        } catch {
          entries.push({ name, size: 0 })
        }
      }
    }

    return entries
  } catch {
    return []
  }
}

/** 取得快取統計資訊（檔案數量與總大小） */
export async function stats(): Promise<{ count: number; totalBytes: number }> {
  try {
    const entries = await list()
    return {
      count: entries.length,
      totalBytes: entries.reduce((sum, e) => sum + e.size, 0),
    }
  } catch {
    return { count: 0, totalBytes: 0 }
  }
}

/** 刪除整個模型快取目錄 */
export async function clearAll(): Promise<void> {
  try {
    const root = await navigator.storage.getDirectory()
    await root.removeEntry(OPFS_DIR, { recursive: true })
  } catch {
    // 目錄不存在或刪除失敗，靜默忽略
  }
}

// ============================================================
// 儲存持久化 API
// ============================================================

/** 請求瀏覽器持久化儲存（避免空間不足時被清除） */
export async function requestPersistence(): Promise<boolean> {
  try {
    if (navigator.storage && navigator.storage.persist) {
      return await navigator.storage.persist()
    }
    return false
  } catch {
    return false
  }
}

/** 檢查儲存是否已持久化 */
export async function isPersisted(): Promise<boolean> {
  try {
    if (navigator.storage && navigator.storage.persisted) {
      return await navigator.storage.persisted()
    }
    return false
  } catch {
    return false
  }
}

/** 取得儲存空間使用量與配額 */
export async function getQuota(): Promise<{ usage: number; quota: number }> {
  try {
    if (navigator.storage && navigator.storage.estimate) {
      const estimate = await navigator.storage.estimate()
      return {
        usage: estimate.usage ?? 0,
        quota: estimate.quota ?? 0,
      }
    }
    return { usage: 0, quota: 0 }
  } catch {
    return { usage: 0, quota: 0 }
  }
}
