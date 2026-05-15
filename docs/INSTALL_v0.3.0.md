# 慈濟海報資料庫 — 安裝教學

> 釋出日期：2026-05-15　|　版本：後台 v0.3.0

---

## 🌐 前端展示、申請海報連結

https://tzuchi-poster-platform.tzuchi-webit.workers.dev/

> 一般民眾在這裡瀏覽海報、提出申請。

---

## 💻 後台 APP 下載連結

https://tinyurl.com/22fzdc5z

> 約 80 MB。僅支援 Apple Silicon Mac（M1 / M2 / M3 / M4）。

---

## 📦 後台 APP 安裝教學

### 1. 點兩下下載好的 `.dmg`，會跳出視窗

### 2. 把「海報資料庫後台」圖示拖到右邊「Applications」資料夾

### 3. 拖完關掉視窗，到 Launchpad 或 Applications 找「海報資料庫後台」

### 4. ⚠️ 第一次開啟（重要）

雙擊會看到「**無法打開，因為它來自未識別的開發者**」── 這是正常的（測試版沒做公證）。

**正確開法：**

- 在 Applications 裡的「海報資料庫後台」**按住 Control 鍵 + 點一下**（或右鍵）
- 選「**打開**」
- 跳出警告再點「**打開**」一次

之後就可以正常雙擊。

> 💡 如果你的 macOS 是 **15 Sequoia / 26 Tahoe** 或更新版本，對話框文字會是「Apple 無法驗證...是否為惡意軟體」，並且右鍵打開可能沒有「打開」按鈕。請看下面 [FAQ Q1](#q1-沒有打開按鈕怎麼辦macos-sequoiatahoe)。

### 5. 首次啟動 AI 模型下載

App 開起來會走 onboarding：

1. **同意條款**
2. **下載模型**（約 2.2 GB，看網速 5–15 分鐘）
   - `qwen2-vl-2b-instruct-q4_k_m.gguf`（940 MB）
   - `mmproj-Qwen2-VL-2B-Instruct-f16.gguf`（1.27 GB）
   - ⚠️ 中途斷線要從頭來（resumable 還沒做）
3. 完成 → 用 **`tzuchi.org.tw`** 信箱登入

---

## ❓ FAQ

### Q1: 沒有「打開」按鈕怎麼辦？（macOS Sequoia / Tahoe）

新版 macOS 把右鍵打開的捷徑拔掉了。任選一條：

**🅰️ Terminal 一行解（30 秒，最快）**

打開「Terminal」（聚光燈搜 `terminal`），貼這行 → Enter：

```bash
xattr -dr com.apple.quarantine "/Applications/海報資料庫後台.app"
```

跑完直接雙擊 app 即可。

**🅱️ 系統設定 GUI**

1. 系統設定 → **隱私權與安全性**
2. **往下捲到最底**（要過所有權限類別）
3. 找到「**`海報資料庫後台` 已被阻擋使用**」
4. 點旁邊「**仍要打開**」→ Touch ID / 密碼確認
5. 回 Applications 雙擊

> ⚠️ 「已被阻擋」訊息只在剛剛雙擊失敗後幾分鐘內出現。沒看到的話，回 Applications **再雙擊一次** app 觸發。

### Q2: 跳出「已損毀，丟到垃圾桶」

不要點丟到垃圾桶，點取消後跑 Q1 路線 A 的指令。

### Q3: 模型下載到一半失敗

砍掉模型資料夾重新開 app：

```bash
rm -rf "$HOME/Library/Application Support/org.tzuchi.poster-admin/models/"
```

### Q4: Intel Mac 能用嗎

不行，v0.3.0 只有 Apple Silicon（aarch64）版。要等之後做 Universal binary。

### Q5: 登入失敗

信箱必須是 `@tzuchi.org.tw`，且已在白名單。

---

## 📝 v0.3.0 修了什麼

- ✅ 申請單審核 4 個 action（接單 / 核可 / 駁回 / 結案）按了真的有反應（v0.2.0 是靜默無效的 bug）
- ✅ Tauri v2 plugin-dialog 型別修正
- ✅ Build pipeline 修正（tsconfig）
- ✅ 新增 ad-hoc 簽名，避免跳「已損毀」的死警告
