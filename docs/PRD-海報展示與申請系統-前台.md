# 海報展示與申請系統 - 前台 PRD

**版本**：v0.8
**日期**：2026-01-16
**狀態**：草稿
**資料庫版本**：對齊 Supabase ↔ Immich 同步架構設計 v1.0

---

## 1. 產品概述

### 1.1 產品目標

提供慈濟志工與同仁一個直覺、易用的海報素材瀏覽與申請平台，讓使用者能夠：
- 快速找到所需的海報素材
- 一次申請多張海報
- 追蹤申請進度
- 核可後直接下載素材

### 1.2 目標使用者

| 使用者 | 說明 |
|--------|------|
| 志工 | 慈濟志工，申請海報用於社區活動、展覽等 |
| 同仁 | 慈濟內部同仁，申請海報用於各單位業務需求 |

### 1.3 核心價值

- **簡單直覺**：非技術背景使用者也能輕鬆操作
- **視覺優先**：海報以大圖呈現，方便預覽挑選
- **流程透明**：申請進度清晰可追蹤

---

## 2. 功能需求

### 2.1 首頁

#### 功能說明
系統入口頁面，提供快速搜尋、熱門推薦、主題策展入口。

#### 頁面元素

| 區塊 | 說明 |
|------|------|
| 搜尋區 | 全站搜尋框，支援關鍵字搜尋 |
| 主題策展 | 橫向捲動卡片，顯示精選主題 |
| 最新上架 | 最近上架的海報，Grid 排列 |
| 熱門海報 | 下載次數最多的海報 |
| 展覽導覽入口 | 連結至展覽結構瀏覽頁 |

#### 操作說明

| 操作 | 說明 |
|------|------|
| 點擊搜尋 | 跳轉至海報列表頁並顯示搜尋結果 |
| 點擊主題卡片 | 進入該主題策展頁 |
| 點擊海報縮圖 | 進入海報詳情頁 |

---

### 2.2 海報瀏覽（列表頁）

#### 功能說明
顯示所有已上架海報，支援多條件篩選與排序。

#### 篩選條件

| 欄位 | 類型 | 說明 |
|------|------|------|
| 關鍵字搜尋 | 文字輸入 | 搜尋專案名稱、主題、描述 |
| 專案名稱 | 下拉選單 | 從現有專案中選擇 |
| 主題 | 下拉選單（多選） | 從權威表載入 |
| 展覽時間 | 日期範圍 | 起迄日期篩選 |
| 地點 | 下拉選單 | 志業體/一般地點 |
| 品項 | 下拉選單 | 原始檔/中圖/導覽手冊/文宣品/會所佈置/素材 |
| 建檔者 | 下拉選單 | 篩選特定建檔者 |
| 上架日期 | 日期範圍 | 篩選上架時間 |

#### 排序選項

| 選項 | 說明 |
|------|------|
| 最新上架 | 依上架時間降序（預設） |
| 最舊上架 | 依上架時間升序 |
| 最多下載 | 依下載次數降序 |
| 展覽時間 | 依展覽時間排序 |

#### 列表顯示

| 欄位 | 說明 |
|------|------|
| 縮圖 | 海報預覽圖，比例 3:4 |
| 專案名稱 | 顯示於縮圖下方 |
| 主題標籤 | 顯示主題類別標籤 |
| 展覽時間 | 簡化顯示（如：2026/01） |
| 加入清單按鈕 | 點擊加入申請清單 |

#### 操作說明

| 操作 | 說明 |
|------|------|
| 點擊縮圖 | 進入海報詳情頁 |
| 點擊「加入清單」 | 加入申請清單，按鈕變為「已加入」 |
| 切換顯示模式 | Grid / List 切換（選配） |

---

### 2.3 海報詳情頁

#### 功能說明
顯示單一海報的完整資訊，包含大圖預覽、後設資料、相關海報推薦。

#### 頁面元素

| 區塊 | 欄位 | 說明 |
|------|------|------|
| 圖片預覽區 | 大圖 | 可放大檢視 |
| | 縮圖列表 | 該上架單包含的所有檔案縮圖 |
| 基本資訊 | 專案/展覽名稱 | - |
| | 主題類別 | 標籤顯示 |
| | 品項 | 原始檔/中圖/等 |
| | 海報尺寸 | 如有 |
| 展覽資訊 | 展覽時間 | 單一/起迄 |
| | 展覽地點 | 志業體/一般地點 |
| 說明區 | 公開說明 | 給申請者的注意事項 |
| | 描述 | 海報內容描述 |
| | 關鍵字 | 標籤顯示 |
| 操作區 | 加入清單按鈕 | 加入申請清單 |
| | 立即申請按鈕 | 直接進入申請表單 |
| 相關推薦 | 相關海報 | 同主題/同展覽的其他海報 |

#### 操作說明

| 操作 | 說明 |
|------|------|
| 點擊縮圖 | 切換主圖顯示 |
| 點擊主圖 | 開啟 Lightbox 放大檢視 |
| 點擊「加入清單」 | 加入申請清單 |
| 點擊「立即申請」 | 跳轉至申請表單，預填此海報 |
| 點擊相關海報 | 進入該海報詳情頁 |

---

### 2.4 主題策展頁

#### 功能說明
依主題分類展示海報，呈現策展內容與相關海報。

#### 頁面元素

| 區塊 | 說明 |
|------|------|
| 主題封面 | 大圖 Banner |
| 主題名稱 | 標題 |
| 主題說明 | 描述文字 |
| 海報列表 | 該主題下的所有海報，Grid 排列 |

#### 操作說明

| 操作 | 說明 |
|------|------|
| 點擊海報 | 進入海報詳情頁 |
| 點擊「加入清單」 | 加入申請清單 |

---

### 2.5 展覽導覽頁

#### 功能說明
依展覽結構（展覽 → 展區 → 子區）瀏覽海報。

#### 頁面元素

| 區塊 | 說明 |
|------|------|
| 展覽列表 | 顯示所有「進行中」的展覽卡片 |
| 展覽詳情 | 展覽封面、名稱、說明 |
| 展區導覽 | 展區列表，可展開顯示子區 |
| 海報列表 | 該區域下的海報 |

#### 階層結構

```
展覽列表
└── 展覽詳情頁
    └── 展區
        └── 子區
            └── 海報列表
```

#### 操作說明

| 操作 | 說明 |
|------|------|
| 點擊展覽卡片 | 進入展覽詳情頁 |
| 點擊展區 | 展開/收合子區 |
| 點擊子區 | 顯示該子區海報 |
| 點擊海報 | 進入海報詳情頁 |

---

### 2.6 申請清單（購物車）

#### 功能說明
暫存使用者選取的海報，統一提交申請。

#### 頁面元素

| 區塊 | 說明 |
|------|------|
| 清單標題 | 顯示「申請清單」與海報數量 |
| 海報列表 | 已加入的海報，含縮圖、名稱、移除按鈕 |
| 全選/取消 | 批次操作 |
| 清空清單 | 清除所有項目 |
| 提交申請按鈕 | 進入申請表單 |

#### 顯示方式

- **側邊欄抽屜**：點擊右上角購物車 icon 展開
- **或獨立頁面**：`/cart` 路由

#### 操作說明

| 操作 | 說明 |
|------|------|
| 點擊移除 | 從清單移除該海報 |
| 點擊清空 | 清除所有海報（需確認） |
| 點擊提交申請 | 跳轉至申請表單 |

---

### 2.7 申請表單

#### 功能說明
填寫申請資訊並提交申請。

#### 表單欄位

**展覽資訊區塊**

| 欄位 | 類型 | 必填 | 說明 |
|------|------|------|------|
| 展覽日期 | 日期選擇 | 是 | 預計展覽/使用日期 |
| 展覽地點 | 文字輸入 | 是 | 展覽或使用地點 |

**申請用途區塊**

| 欄位 | 類型 | 必填 | 說明 |
|------|------|------|------|
| 申請用途 | 多行文字 | 是 | 描述使用目的 |

**系統自動判斷**

| 欄位 | 說明 |
|------|------|
| 素材屬性 | 系統依據所選海報檔案的素材屬性自動判斷（none/logo/restricted_image/special_person），決定審核流程 |

**已選海報區塊**

| 欄位 | 說明 |
|------|------|
| 海報清單 | 顯示已選海報縮圖與名稱，可移除 |

#### 操作說明

| 操作 | 說明 |
|------|------|
| 填寫表單 | 即時驗證必填欄位 |
| 移除海報 | 從申請中移除 |
| 取消 | 返回上一頁 |
| 提交申請 | 驗證通過後送出，跳轉至「我的申請」 |

#### 驗證規則

- 必填欄位未填：紅框提示
- 至少選擇一張海報

---

### 2.8 我的申請（進度追蹤）

#### 功能說明
查看所有申請紀錄與審核進度。

#### 頁面元素

| 區塊 | 說明 |
|------|------|
| 狀態篩選 Tab | 全部/待處理/審核中/待結案/已核可/已駁回 |
| 申請列表 | 申請紀錄卡片或表格 |

#### 列表欄位

| 欄位 | 說明 |
|------|------|
| 申請單編號 | 系統產生的編號 |
| 展覽日期 | 申請的展覽日期 |
| 展覽地點 | 申請的展覽地點 |
| 申請日期 | YYYY/MM/DD |
| 海報數量 | 申請的海報張數 |
| 狀態 | 待處理/審核中/待結案/已核可/已駁回 |
| 操作 | 查看詳情/下載（已核可） |

#### 狀態說明

| 狀態 | 顯示樣式 | 說明 |
|------|----------|------|
| 待處理 | 灰色 | 新申請，等待承辦者接單 |
| 審核中 | 黃色 | 審核流程進行中 |
| 待結案 | 藍色 | 審核通過，等待承辦者結案 |
| 已核可 | 綠色 | 結案完成，可下載 |
| 已駁回 | 紅色 | 審核不通過 |

#### 操作說明

| 操作 | 說明 |
|------|------|
| 點擊 Tab | 切換顯示不同狀態 |
| 點擊「查看詳情」 | 開啟申請詳情 Modal |
| 點擊「下載」 | 進入下載頁面（僅已核可） |

---

### 2.9 申請詳情 Modal

#### 功能說明
查看單一申請的完整資訊與審核歷程。

#### 頁面元素

| 區塊 | 欄位 | 說明 |
|------|------|------|
| 基本資訊 | 申請單編號 | - |
| | 申請日期 | - |
| | 狀態 | 標籤顯示 |
| 申請內容 | 展覽日期 | - |
| | 展覽地點 | - |
| | 申請用途 | - |
| 海報清單 | 縮圖列表 | 點擊可查看大圖 |
| 審核歷程 | 時間軸 | 顯示各階段審核狀態與時間 |
| 結案資訊 | 回覆內容 | 承辦者的回覆（已結案時顯示） |

#### 審核歷程顯示

```
✓ 承辦者接單 - 2026/01/14 10:30 - 王小明
⏳ 宗教處審核中
○ 主管審核
○ 結案
```

---

### 2.10 下載中心

#### 功能說明
已核可申請的海報下載頁面。

#### 頁面元素

| 區塊 | 說明 |
|------|------|
| 申請資訊 | 申請單編號、核可日期 |
| 下載列表 | 可下載的海報檔案清單 |
| 全部下載 | 一鍵打包下載（ZIP） |

#### 下載列表欄位

| 欄位 | 說明 |
|------|------|
| 縮圖 | 海報預覽 |
| 檔案名稱 | 原始檔名或系統檔名 |
| 檔案類型 | PSD/AI/PDF/PNG/JPG |
| 檔案大小 | 如：25.3 MB |
| 下載按鈕 | 單檔下載 |

#### 操作說明

| 操作 | 說明 |
|------|------|
| 點擊單檔下載 | 下載該檔案 |
| 點擊全部下載 | 打包 ZIP 下載所有檔案 |

---

## 3. 頁面流程圖

### 3.1 主要瀏覽流程

```
首頁
├── 搜尋 → 海報列表 → 海報詳情 → 加入清單
├── 主題策展 → 主題頁 → 海報詳情 → 加入清單
└── 展覽導覽 → 展覽詳情 → 展區 → 海報詳情 → 加入清單
```

### 3.2 申請流程

```
加入清單 → 申請清單（購物車） → 申請表單 → 提交
                                              ↓
                                         我的申請
                                              ↓
                                    審核中 → 已核可 → 下載中心
                                              ↓
                                           已駁回
```

---

## 4. 狀態定義

### 4.1 申請單狀態

| 狀態 | 代碼 | 前台顯示 | 可執行操作 |
|------|------|----------|------------|
| 待處理 | pending | 待處理 | 查看詳情 |
| 審核中 | in_review | 審核中 | 查看詳情 |
| 待結案 | awaiting_closure | 待結案 | 查看詳情 |
| 已核可 | approved | 已核可 | 查看詳情、下載 |
| 已駁回 | rejected | 已駁回 | 查看詳情 |

### 4.2 審核流程階段

依據後台定義，審核流程依申請人身份（applicant_identity）與素材屬性（material_attribute）決定：

**素材屬性說明**

| 代碼 | 說明 |
|------|------|
| none | 以上皆無（一般素材） |
| logo | 含 Logo |
| restricted_image | 含管制圖 |
| special_person | 含特殊人物 |

**短流程（承辦者有決定權）**
- 同仁（staff）+ none/logo → 承辦者(handler)直接結案
- 志工（volunteer）+ none/logo → 承辦者(handler)→宗教處(religious)→結案

**長流程（需上級審核）**
- 任何身份 + restricted_image/special_person → 承辦者(handler)→宗教處(religious)→主管(supervisor)→師父(master)→結案

---

## 5. 介面設計原則

### 5.1 設計方向

- **淺色溫暖**：淺色背景搭配白底卡片，清爽易讀
- **視覺優先**：海報大圖為主角，標準 Grid 佈局
- **簡潔互動**：輕微的 hover 效果，不分散注意力
- **行動友善**：響應式設計，支援手機/平板
- **無障礙友善**：高對比度，適合各年齡層使用

### 5.2 色彩系統

#### 基礎色

| 用途 | 色碼 | 說明 |
|------|------|------|
| 頁面背景 | `#f8fafc` | 淺灰白 |
| 卡片背景 | `#ffffff` | 純白 |
| 次要背景 | `#f1f5f9` | 淺灰 |
| 邊框 | `#e2e8f0` | 灰線 |
| 主要文字 | `#1e293b` | 深灰 |
| 次要文字 | `#64748b` | 中灰 |

#### 主色調

| 用途 | 色碼 | 說明 |
|------|------|------|
| 主要藍 | `#3b82f6` | 按鈕、連結、強調 |
| 深藍 | `#1e40af` | Hover、標題 |
| 淺藍背景 | `#eff6ff` | 選中狀態背景 |

#### 輔助暖色（慈濟特色）

| 用途 | 色碼 | 說明 |
|------|------|------|
| 溫暖橘 | `#f97316` | 重點提示、CTA |
| 淺橘背景 | `#fff7ed` | 提示區塊背景 |
| 蓮花粉 | `#fce7f3` | 品牌裝飾 |

#### 狀態色

| 狀態 | 背景色 | 文字色 | 用途 |
|------|--------|--------|------|
| 成功/進行中 | `#dcfce7` | `#166534` | 已核可、進行中展覽 |
| 警告/籌備中 | `#fef9c3` | `#854d0e` | 審核中、籌備中 |
| 錯誤/駁回 | `#fee2e2` | `#991b1b` | 已駁回 |
| 中性/已結束 | `#f1f5f9` | `#475569` | 待處理、已結束 |

### 5.3 元件規範

#### 卡片設計

| 屬性 | 規範 |
|------|------|
| 背景 | `#ffffff` 白色 |
| 圓角 | `12px` |
| 陰影 | `0 1px 3px rgba(0, 0, 0, 0.1)` |
| Hover 陰影 | `0 4px 12px rgba(0, 0, 0, 0.15)` |
| Hover 位移 | `translateY(-4px)` |
| 過渡動畫 | `transition: all 0.2s ease` |

#### 按鈕設計

| 類型 | 樣式 |
|------|------|
| 主要按鈕 | 藍底 `#3b82f6`，白字，圓角 `8px` |
| 次要按鈕 | 白底，藍框 `#3b82f6`，藍字 |
| 強調按鈕 | 橘底 `#f97316`，白字（重要 CTA） |
| 文字按鈕 | 無框，藍字 + 箭頭（如：查看全部 →） |
| Hover | 背景加深，位移 `translateY(-1px)` |

#### 標籤設計

| 類型 | 樣式 |
|------|------|
| 狀態標籤 | 圓角膠囊 `border-radius: 9999px`，小字 `12px` |
| 進行中 | 背景 `#dcfce7`，文字 `#166534` |
| 籌備中 | 背景 `#fef9c3`，文字 `#854d0e` |
| 已結束 | 背景 `#f1f5f9`，文字 `#475569` |
| 常設展 | 背景 `#eff6ff`，文字 `#1e40af` |

#### 海報縮圖

| 屬性 | 規範 |
|------|------|
| 比例 | 3:4（直式海報）|
| 圓角 | `8px` |
| Hover | 陰影增強，位移 `translateY(-4px)` |

---

## 5A. 設計規範詳細文件

### 5A.1 佈局系統

#### 標準 Grid

採用標準等寬 Grid 佈局，清晰整齊。

```css
.poster-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 24px;
}

/* 響應式 */
@media (max-width: 1279px) {
  .poster-grid {
    grid-template-columns: repeat(3, 1fr);
  }
}

@media (max-width: 1023px) {
  .poster-grid {
    grid-template-columns: repeat(2, 1fr);
  }
}

@media (max-width: 639px) {
  .poster-grid {
    grid-template-columns: 1fr;
  }
}
```

#### 響應式斷點

| 斷點 | 寬度 | Grid 欄數 |
|------|------|----------|
| Desktop | ≥1280px | 4 欄 |
| Laptop | ≥1024px | 3 欄 |
| Tablet | ≥640px | 2 欄 |
| Mobile | <640px | 1 欄 |

#### 容器寬度

| 尺寸 | 最大寬度 | 用途 |
|------|----------|------|
| sm | 640px | 表單、Modal |
| md | 768px | 內容區 |
| lg | 1024px | 主要內容 |
| xl | 1280px | 全寬內容 |

### 5A.2 動畫系統

#### 標準過渡（簡化版）

```css
/* 基礎過渡 - 用於大部分互動 */
.transition-base {
  transition: all 0.2s ease;
}

/* 快速過渡 - 用於小元素 */
.transition-fast {
  transition: all 0.15s ease;
}
```

#### 入場動畫（簡單 fade）

```css
/* 簡單淡入 */
@keyframes fadeIn {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}

.animate-fade-in {
  animation: fadeIn 0.3s ease forwards;
}
```

#### Hover 效果

```css
/* 卡片 hover */
.card:hover {
  transform: translateY(-4px);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
}

/* 按鈕 hover */
.btn:hover {
  transform: translateY(-1px);
}
```

### 5A.3 導覽列規範

```
┌──────────────────────────────────────────────────────┐
│  🪷 慈濟海報資料庫    展覽  主題  關於      🔍  🛒   │
└──────────────────────────────────────────────────────┘
```

| 屬性 | 規範 |
|------|------|
| 高度 | `64px` |
| 背景 | `#ffffff` 白色 |
| 陰影 | 滾動後顯示 `0 1px 3px rgba(0, 0, 0, 0.1)` |
| Logo | 蓮花符號 + 品牌名稱 |
| 選單項 | 間距 `32px`，hover 文字變藍 `#3b82f6` |
| 搜尋 | icon 按鈕 |
| 購物車 | icon + 數量 badge |

### 5A.4 Hero 區塊規範

首頁頂部的主視覺區塊，採用淺色漸層背景。

```
┌─────────────────────────────────────────────────────┐
│                                                     │
│            慈濟海報資料庫                            │
│       探索豐富的海報素材，申請使用於展覽活動          │
│                                                     │
│         [🔍 搜尋海報...]                            │
│                                                     │
│     📊 2,847 張海報  |  🏛️ 156 個展覽  |  🎨 12 主題  │
│                                                     │
└─────────────────────────────────────────────────────┘
```

| 屬性 | 規範 |
|------|------|
| 高度 | `40vh` - `50vh`（比 Demo 矮，更快看到內容） |
| 背景 | 淺漸層 `#eff6ff` → `#f8fafc` |
| 裝飾 | 可選：淺色幾何圖形或蓮花圖案 |
| 標題 | 深色 `#1e293b`，字重 700，`48px` |
| 副標題 | 中灰 `#64748b`，`18px` |
| 搜尋框 | 白底，陰影，圓角 `8px`，寬度 `480px` |
| 統計數字 | 小字，icon + 數字 |

### 5A.5 統計卡片規範

```
┌─────────────────┐
│  📊             │
│  2,847          │  ← 大數字，藍色，字重 700
│  海報總數        │  ← 說明文字，灰色
└─────────────────┘
```

| 屬性 | 規範 |
|------|------|
| 背景 | 白色或淺藍 `#eff6ff` |
| 圓角 | `12px` |
| 數字 | `32px`，粗體，主要藍 `#3b82f6` |
| 說明 | `14px`，次要灰 `#64748b` |
| Hover | 陰影增強 |

### 5A.6 展覽狀態標籤

| 狀態 | 背景色 | 文字色 | 說明 |
|------|--------|--------|------|
| 進行中 | `#dcfce7` | `#166534` | 前台可見 |
| 籌備中 | `#fef9c3` | `#854d0e` | 前台不可見 |
| 已結束 | `#f1f5f9` | `#475569` | 前台不可見 |
| 常設展 | `#eff6ff` | `#1e40af` | 無期限展覽 |

### 5A.7 申請單狀態標籤

| 狀態 | 代碼 | 背景色 | 文字色 |
|------|------|--------|--------|
| 待處理 | pending | `#f1f5f9` | `#475569` |
| 審核中 | in_review | `#fef9c3` | `#854d0e` |
| 待結案 | awaiting_closure | `#dbeafe` | `#1e40af` |
| 已核可 | approved | `#dcfce7` | `#166534` |
| 已駁回 | rejected | `#fee2e2` | `#991b1b` |

### 5A.8 主題分類（共 12 個）

| 主題 | 圖示 | 主題色 | 淺色背景 |
|------|------|--------|----------|
| 朔源 | 🏛️ | `#78716c` | `#f5f5f4` |
| 慈善 | ❤️ | `#dc2626` | `#fee2e2` |
| 醫療 | 🏥 | `#2563eb` | `#dbeafe` |
| 教育 | 📚 | `#ca8a04` | `#fef9c3` |
| 人文 | 🎭 | `#9333ea` | `#f3e8ff` |
| 環保 | 🌱 | `#16a34a` | `#dcfce7` |
| 茹素護生 | 🥬 | `#65a30d` | `#ecfccb` |
| 國際賑災 | 🌍 | `#0284c7` | `#e0f2fe` |
| 靜思語 | 🪷 | `#0891b2` | `#cffafe` |
| 大事記 | 📅 | `#ea580c` | `#ffedd5` |
| 法華坡道 | ☸️ | `#7c3aed` | `#ede9fe` |
| 年度主題 | 🎯 | `#be185d` | `#fce7f3` |

### 5A.9 間距系統

基於 4px 基準的間距系統：

| 名稱 | 數值 | 用途 |
|------|------|------|
| xs | 4px | 緊湊間距 |
| sm | 8px | 小間距 |
| md | 16px | 標準間距 |
| lg | 24px | 大間距 |
| xl | 32px | 區塊間距 |
| 2xl | 48px | 章節間距 |
| 3xl | 64px | 大區塊間距 |

### 5A.10 字型規範

| 用途 | 大小 | 字重 | 行高 | 顏色 |
|------|------|------|------|------|
| H1 標題 | 48px | 700 | 1.2 | `#1e293b` |
| H2 標題 | 36px | 700 | 1.3 | `#1e293b` |
| H3 標題 | 24px | 600 | 1.4 | `#1e293b` |
| H4 標題 | 20px | 600 | 1.4 | `#1e293b` |
| 內文 | 16px | 400 | 1.6 | `#1e293b` |
| 小字 | 14px | 400 | 1.5 | `#64748b` |
| 極小字 | 12px | 400 | 1.5 | `#64748b` |

### 5A.11 表單元件

| 元件 | 規範 |
|------|------|
| 輸入框高度 | `40px` |
| 輸入框圓角 | `8px` |
| 輸入框邊框 | `1px solid #e2e8f0` |
| Focus 邊框 | `2px solid #3b82f6` |
| 標籤字體 | `14px`，字重 500 |
| 錯誤提示 | 紅色 `#991b1b`，`12px` |

### 5A.12 首頁區塊結構

```
┌─────────────────────────────────────────┐
│  Header（白底，滾動有陰影）              │
├─────────────────────────────────────────┤
│  Hero（淺漸層背景，標題 + 搜尋框）        │
├─────────────────────────────────────────┤
│  快速入口（3 個大按鈕：展覽/主題/我的申請）│
├─────────────────────────────────────────┤
│  最新上架（標準 Grid 4 欄）              │
├─────────────────────────────────────────┤
│  主題策展（橫向捲動卡片）                │
├─────────────────────────────────────────┤
│  熱門海報（Grid 4 欄）                   │
├─────────────────────────────────────────┤
│  Footer                                 │
└─────────────────────────────────────────┘
```

---

## 6. 技術選型

### 6.1 技術棧總覽

| 類別 | 選擇 | 版本 | 說明 |
|------|------|------|------|
| 建構工具 | **Vite** | 5.x | 快速開發、HMR、Cloudflare 友善 |
| 前端框架 | **React** | 18.x | 與後台共用元件 |
| 語言 | **TypeScript** | 5.x | 型別安全 |
| 路由 | **TanStack Router** | 1.x | 型別安全路由 |
| 資料獲取 | **TanStack Query** | 5.x | 快取、重試、loading 狀態 |
| 狀態管理 | **Zustand** | 4.x | 輕量、TypeScript 友善 |
| UI 元件 | **shadcn/ui** | - | 可客製、與後台共用 |
| 樣式 | **Tailwind CSS** | 3.x | Utility-first |
| 表單 | **React Hook Form** | 7.x | 效能好、易用 |
| 驗證 | **Zod** | 3.x | Schema 驗證、型別推斷 |
| HTTP | **ky** | 1.x | 輕量、Promise-based |
| 後端整合 | **Supabase** | 2.x | 與後台共用 |
| 圖片儲存 | **Immich** | - | 自建圖片管理服務 |
| 圖片代理 | **Cloudflare Workers** | - | 隱藏 Immich API Key |
| 部署 | **Cloudflare Pages** | - | 與後台一致 |

### 6.2 圖片存取架構

#### 架構決策

| 項目 | 決策 |
|------|------|
| 圖片來源 | Immich（自建圖片管理服務） |
| 主題策展 | 使用 Immich Album |
| 縮圖認證 | **Image Proxy**（Cloudflare Workers + TypeScript） |
| 語意搜尋 | 暫不使用 |

#### Image Proxy 架構

```
┌──────────────┐     ┌─────────────────────┐     ┌──────────────┐
│  海報前台     │────▶│   Image Proxy       │────▶│   Immich     │
│  (React)     │     │ (Cloudflare Workers)│     │   Server     │
└──────────────┘     └─────────────────────┘     └──────────────┘
                             │
                             │ • 隱藏 Immich API Key
                             │ • 加入快取 Header
                             │ • 轉發縮圖/預覽圖請求
```

#### 選擇 Cloudflare Workers + TypeScript 原因

| 考量 | 說明 |
|------|------|
| **快速上線** | 1-2 天完成，與前端技術棧一致 |
| **零維護** | Serverless，無需管理伺服器 |
| **全球 CDN** | Cloudflare 邊緣網路，低延遲 |
| **成本** | 免費方案每日 10 萬請求，足夠使用 |

> **參考文件**：詳細方案分析請見 `Rust技術架構分析報告.md`

#### Image Proxy API

| 端點 | 說明 |
|------|------|
| `GET /api/image/{assetId}` | 取得縮圖（250x250） |
| `GET /api/image/{assetId}?size=preview` | 取得預覽圖（1440px） |

#### 前端使用方式

```tsx
// 圖片 URL 透過 Image Proxy 載入
const thumbnailUrl = `/api/image/${immichAssetId}`;
const previewUrl = `/api/image/${immichAssetId}?size=preview`;
```

### 6.3 與後台技術對齊

| 項目 | 後台（夥伴） | 前台（你） |
|------|-------------|-----------|
| 後端框架 | NestJS | - |
| 前端框架 | React/Next.js | **Vite + React** |
| 資料庫 | Supabase | **共用** |
| 圖片存儲 | Immich | **共用** |
| 圖片代理 | - | **Cloudflare Workers** |
| 部署 | Cloudflare | **Cloudflare Pages** |
| 型別定義 | TypeScript | **共用 @shared/types** |

### 6.4 專案結構

```
poster-frontend/
├── public/
│   └── favicon.ico
├── src/
│   ├── main.tsx                 # 應用入口
│   ├── App.tsx                  # 根元件
│   ├── routes/                  # 路由定義 (TanStack Router)
│   │   ├── __root.tsx
│   │   ├── index.tsx            # 首頁
│   │   ├── posters/
│   │   │   ├── index.tsx        # 海報列表
│   │   │   └── $id.tsx          # 海報詳情
│   │   ├── themes/
│   │   │   ├── index.tsx        # 主題列表
│   │   │   └── $id.tsx          # 主題詳情
│   │   ├── exhibitions/
│   │   │   ├── index.tsx        # 展覽列表
│   │   │   └── $id.tsx          # 展覽詳情
│   │   ├── cart.tsx             # 申請清單
│   │   ├── apply.tsx            # 申請表單
│   │   ├── my-applications/
│   │   │   ├── index.tsx        # 我的申請
│   │   │   └── $id.tsx          # 申請詳情
│   │   └── download/
│   │       └── $applicationId.tsx  # 下載中心
│   ├── components/              # 共用元件
│   │   ├── ui/                  # shadcn/ui 元件
│   │   ├── layout/
│   │   │   ├── Header.tsx
│   │   │   ├── Footer.tsx
│   │   │   └── Layout.tsx
│   │   ├── poster/
│   │   │   ├── PosterCard.tsx
│   │   │   ├── PosterGrid.tsx
│   │   │   └── PosterDetail.tsx
│   │   ├── cart/
│   │   │   ├── CartDrawer.tsx
│   │   │   └── CartItem.tsx
│   │   └── common/
│   │       ├── SearchBar.tsx
│   │       ├── FilterPanel.tsx
│   │       └── StatusBadge.tsx
│   ├── hooks/                   # 自訂 Hooks
│   │   ├── usePosters.ts
│   │   ├── useThemes.ts
│   │   ├── useExhibitions.ts
│   │   ├── useApplications.ts
│   │   └── useCart.ts
│   ├── stores/                  # Zustand stores
│   │   ├── cartStore.ts
│   │   └── filterStore.ts
│   ├── services/                # API 服務
│   │   ├── api.ts               # API client (ky)
│   │   ├── supabase.ts          # Supabase client
│   │   ├── posterService.ts
│   │   ├── themeService.ts
│   │   ├── exhibitionService.ts
│   │   └── applicationService.ts
│   ├── types/                   # 型別定義
│   │   ├── index.ts
│   │   ├── poster.ts
│   │   ├── application.ts
│   │   ├── theme.ts
│   │   └── exhibition.ts
│   ├── utils/                   # 工具函式
│   │   ├── format.ts
│   │   └── validation.ts
│   ├── styles/
│   │   └── globals.css          # Tailwind + 自訂樣式
│   └── config/
│       └── constants.ts
├── .env                         # 環境變數
├── .env.example
├── package.json
├── tsconfig.json
├── vite.config.ts
├── tailwind.config.js
└── README.md
```

### 6.5 核心套件版本

```json
{
  "dependencies": {
    "react": "^18.2.0",
    "react-dom": "^18.2.0",
    "@tanstack/react-router": "^1.0.0",
    "@tanstack/react-query": "^5.0.0",
    "zustand": "^4.4.0",
    "@supabase/supabase-js": "^2.39.0",
    "ky": "^1.2.0",
    "react-hook-form": "^7.49.0",
    "@hookform/resolvers": "^3.3.0",
    "zod": "^3.22.0",
    "clsx": "^2.1.0",
    "tailwind-merge": "^2.2.0",
    "lucide-react": "^0.300.0",
    "date-fns": "^3.0.0"
  },
  "devDependencies": {
    "typescript": "^5.3.0",
    "vite": "^5.0.0",
    "@vitejs/plugin-react": "^4.2.0",
    "tailwindcss": "^3.4.0",
    "autoprefixer": "^10.4.0",
    "postcss": "^8.4.0",
    "eslint": "^8.56.0",
    "@typescript-eslint/eslint-plugin": "^6.0.0",
    "@typescript-eslint/parser": "^6.0.0",
    "prettier": "^3.2.0"
  }
}
```

### 6.6 TypeScript 配置

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "useDefineForClassFields": true,
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "skipLibCheck": true,

    /* Bundler mode */
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "jsx": "react-jsx",

    /* Linting */
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "noUncheckedIndexedAccess": true,

    /* Path mapping */
    "baseUrl": ".",
    "paths": {
      "@/*": ["./src/*"],
      "@/components/*": ["./src/components/*"],
      "@/hooks/*": ["./src/hooks/*"],
      "@/services/*": ["./src/services/*"],
      "@/stores/*": ["./src/stores/*"],
      "@/types/*": ["./src/types/*"],
      "@/utils/*": ["./src/utils/*"]
    }
  },
  "include": ["src"],
  "references": [{ "path": "./tsconfig.node.json" }]
}
```

### 6.7 Vite 配置

```typescript
// vite.config.ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3000', // NestJS 後端
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
});
```

### 6.8 型別定義規劃

> **注意**：完整且正確的型別定義請參考 `src/types/index.ts`（v1.1），該檔案已對齊「Supabase ↔ Immich 同步架構設計 v1.0」。
> 以下為主要型別摘要，實際開發以 `types/index.ts` 為準。

**ENUM 類型（共 19 個）**

```typescript
/** 檔案類型 */
export type FileType = 'psd' | 'ai' | 'pdf' | 'png' | 'jpg';

/** 展覽時間模式 */
export type ExhibitionDateMode = 'single' | 'start' | 'range' | 'permanent';

/** 公開等級 */
export type AccessLevel = 'unrestricted' | 'low' | 'medium_low' | 'medium' | 'high';

/** 下載檔名類型 */
export type DownloadFilenameType = 'original' | 'system';

/** 檔案處理狀態 */
export type ProcessingStatus = 'pending' | 'processing' | 'completed' | 'failed';

/** Immich 同步狀態 */
export type ImmichSyncStatus = 'pending' | 'syncing' | 'synced' | 'failed' | 'removed';

/** 素材屬性 */
export type MaterialAttribute = 'none' | 'logo' | 'restricted_image' | 'special_person';

/** 申請人身份 */
export type ApplicantIdentity = 'volunteer' | 'staff';

/** 申請單狀態 */
export type ApplicationStatus = 'pending' | 'in_review' | 'awaiting_closure' | 'approved' | 'rejected';
```

**海報檔案（對齊 DB Schema）**

```typescript
/** 海報檔案 - 對齊 poster_files 表 */
export interface PosterFile {
  id: string;
  posterId: string;
  // 檔案基本資訊
  systemFilename: string;
  originalFilename: string;
  fileType: FileType;
  fileSize: number;
  // 海報規格
  dimensions?: string;           // 海報尺寸 (如 A0, A1)
  posterArea?: number;           // 才數 (印刷計價用)
  // 存取控制
  accessLevel: AccessLevel;
  downloadFilenameType: DownloadFilenameType;
  // 描述資訊
  description?: string;          // 檔案描述
  personSummary?: string;        // 人物摘要
  // 儲存路徑 (Supabase Storage)
  storagePath: string;
  // 前端顯示用 URL (由後端組合)
  thumbnailUrl?: string;
  previewUrl?: string;
  downloadUrl?: string;
  // 關聯
  attributes: PosterFileAttribute[];
  keywords: PosterFileKeyword[];
  // 處理狀態 (後端使用)
  processingStatus?: ProcessingStatus;
  processingError?: string;
  // Immich 同步 (後端使用)
  immichAssetId?: string;
  immichSyncStatus?: ImmichSyncStatus;
  immichSyncedAt?: string;
  immichSyncError?: string;
  // 時間戳
  createdAt: string;
  updatedAt: string;
}
```

**海報上架單**

```typescript
/** 海報上架單 - 對齊 posters 表 */
export interface Poster {
  id: string;
  posterId: string;              // 系統編號
  projectName: string;
  exhibitionDateStart: string;   // ISO date
  exhibitionDateEnd?: string;    // ISO date
  exhibitionDateMode: ExhibitionDateMode;
  locationOrg?: string;          // 志業體地點
  locationGeneral?: string;      // 一般地點
  locationOther?: string;        // 其他地點
  producer?: string;             // 製作單位
  itemTypeId: string;            // FK → vocabulary_items
  publicNote?: string;           // 公開備註（給申請者看）
  internalNote?: string;         // 內部備註
  status: PosterStatus;
  files: PosterFile[];
  themes: PosterTheme[];
  createdAt: string;
  updatedAt: string;
}
```

**申請單相關型別**

```typescript
/** 申請單 - 對齊 applications 表 */
export interface Application {
  id: string;
  applicationNumber: string;     // 格式：依系統產生
  applicantId: string;           // FK → users.id
  applicant?: User;
  // 申請人快照欄位
  applicantName: string;
  applicantAccount: string;
  applicantIdentity: ApplicantIdentity;
  applicantUnit: string;
  applicantPhone: string;
  applicantEmail: string;
  // 展覽資訊
  exhibitionDate: string;        // ISO date
  exhibitionLocation: string;
  usagePurpose: string;
  materialAttribute: MaterialAttribute;  // 素材屬性（系統自動判斷）
  // 狀態與處理
  status: ApplicationStatus;
  handlerNote?: string;
  handlerId?: string;
  handler?: User;
  legalResponse?: string;
  legalScreenshotPath?: string;
  finalResponse?: string;
  closedAt?: string;
  // 關聯
  posters: ApplicationPoster[];
  reviewHistory: ApplicationReviewHistory[];
  createdAt: string;
  updatedAt: string;
}

/** 申請單列表項目（前台「我的申請」用） */
export interface ApplicationListItem {
  id: string;
  applicationNumber: string;
  exhibitionDate: string;
  exhibitionLocation: string;
  posterCount: number;
  status: ApplicationStatus;
  createdAt: string;
  closedAt?: string;
}

/** 審核者角色 */
export type ReviewerRole = 'handler' | 'religious' | 'supervisor' | 'master';

/** 審核動作 */
export type ReviewAction = 'accepted' | 'rejected' | 'pending' | 'closed';

/** 申請單審核歷程 */
export interface ApplicationReviewHistory {
  id: string;
  applicationId: string;
  reviewerRole: ReviewerRole;
  reviewerId?: string;
  reviewer?: User;
  action: ReviewAction;
  comment?: string;
  createdAt: string;
}

/** 申請表單提交資料 */
export interface ApplicationSubmitPayload {
  exhibitionDate: string;        // ISO date
  exhibitionLocation: string;
  usagePurpose: string;
  posterIds: string[];
  // materialAttribute 由後端根據所選海報自動判斷
}
```

**主題策展與展覽型別**

```typescript
/** 主題狀態 */
export type ThemeStatus = 'published' | 'archived';

/** 展覽狀態 */
export type ExhibitionStatus = 'planning' | 'ongoing' | 'finished';

/** 主題策展 - 對齊 themes 表 */
export interface Theme {
  id: string;
  name: string;
  description?: string;
  coverImageUrl?: string;
  status: ThemeStatus;
  sortOrder: number;
  posters: ThemePoster[];
  // Immich 同步 (後端使用)
  immichAlbumId?: string;
  immichSyncStatus?: ImmichSyncStatus;
  createdAt: string;
  updatedAt: string;
}

/** 主題列表項目 */
export interface ThemeListItem {
  id: string;
  name: string;
  coverImageUrl?: string;
  posterCount: number;
}

/** 展覽 - 對齊 exhibitions 表 */
export interface Exhibition {
  id: string;
  name: string;
  description?: string;
  coverImageUrl?: string;
  status: ExhibitionStatus;
  zones: ExhibitionZone[];
  createdAt: string;
  updatedAt: string;
}

/** 展覽列表項目 */
export interface ExhibitionListItem {
  id: string;
  name: string;
  coverImageUrl?: string;
  status: ExhibitionStatus;
  zoneCount: number;
  posterCount: number;
}

/** 展區（支援子區，自參考） */
export interface ExhibitionZone {
  id: string;
  exhibitionId: string;
  parentZoneId?: string;       // 自參考：父展區
  name: string;
  description?: string;
  sortOrder: number;
  managers: ExhibitionZoneManager[];
  subZones: ExhibitionZone[];  // 子展區
  posters: ExhibitionZonePoster[];
  createdAt: string;
  updatedAt: string;
}
```

**購物車/申請清單型別（前端狀態）**

```typescript
/** 購物車項目 */
export interface CartItem {
  posterId: string;
  poster: PosterListItem;
  addedAt: string;  // ISO date
}

/** 購物車狀態 */
export interface CartState {
  items: CartItem[];
  totalCount: number;
}
```

### 6.9 API 介面定義

```typescript
/** API 回應格式 */
export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: ApiError;
  pagination?: Pagination;
}

/** API 錯誤 */
export interface ApiError {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

/** 分頁資訊 */
export interface Pagination {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

/** 海報查詢參數 */
export interface PosterQueryParams {
  keyword?: string;
  projectName?: string;
  themeIds?: string[];
  exhibitionDateStart?: string;
  exhibitionDateEnd?: string;
  locationOrg?: string;
  locationGeneral?: string;
  itemTypeId?: string;
  creatorId?: string;
  sortBy?: 'createdAt' | 'exhibitionDateStart';
  sortOrder?: 'asc' | 'desc';
  page?: number;
  pageSize?: number;
}

/** 申請單查詢參數 */
export interface ApplicationQueryParams {
  status?: ApplicationStatus;
  startDate?: string;
  endDate?: string;
  page?: number;
  pageSize?: number;
}
```

### 6.10 開發規範

| 規範項目 | 說明 |
|----------|------|
| 命名規則 | 變數/函式：camelCase，型別/介面：PascalCase |
| 檔案命名 | 元件：PascalCase.tsx，工具：kebab-case.ts |
| 型別優先 | 盡量避免使用 `any`，善用泛型 |
| 嚴格模式 | 啟用 strict 模式 |
| ESLint | 使用 @typescript-eslint 規則 |

---

## 7. 附錄

### 7.1 頁面路由規劃

| 頁面 | 路由 |
|------|------|
| 首頁 | `/` |
| 海報列表 | `/posters` |
| 海報詳情 | `/posters/[id]` |
| 主題列表 | `/themes` |
| 主題詳情 | `/themes/[id]` |
| 展覽列表 | `/exhibitions` |
| 展覽詳情 | `/exhibitions/[id]` |
| 申請清單 | `/cart` |
| 申請表單 | `/apply` |
| 我的申請 | `/my-applications` |
| 申請詳情 | `/my-applications/[id]` |
| 下載中心 | `/download/[applicationId]` |

### 7.2 與後台資料對應

| 前台功能 | 後台資料來源 |
|----------|--------------|
| 海報列表 | 海報管理（已上架） |
| 主題策展 | 主題策展（已上架） |
| 展覽導覽 | 展覽結構（進行中） |
| 篩選選項 | 權威表 |
| 申請表單 | 申請單列表 |

### 7.3 待確認事項

- [ ] 是否需要收藏功能（我的收藏）？
- [ ] 是否需要瀏覽紀錄？
- [ ] 下載是否有期限限制？
- [ ] 是否需要重新申請功能？
- [ ] 首頁推薦邏輯（人工/演算法）？

---

## 變更紀錄

| 版本 | 日期 | 變更內容 | 作者 |
|------|------|----------|------|
| v0.1 | 2026-01-14 | 初版草稿 | - |
| v0.2 | 2026-01-14 | 新增技術選型章節（TypeScript） | - |
| v0.3 | 2026-01-14 | 更新設計規範，新增 5A 章節（基於 Demo 設計） | - |
| v0.4 | 2026-01-14 | 改為方案 A 淺色溫暖風格，保留 Hero 區塊 | - |
| v0.5 | 2026-01-14 | 更新技術選型為 Vite + React，對齊夥伴後台技術棧 | - |
| v0.6 | 2026-01-14 | 對齊資料庫 Schema v1.2：申請單狀態新增 awaiting_closure、簡化申請表單欄位、新增素材屬性說明、型別定義指向 types/index.ts | - |
| v0.7 | 2026-01-15 | 新增圖片存取架構章節（6.2）：確定使用 Cloudflare Workers + TypeScript 實作 Image Proxy，整合 Immich 圖片服務 | - |
| v0.8 | 2026-01-16 | 6.8/6.9 型別定義全面對齊「Supabase ↔ Immich 同步架構設計 v1.0」：新增 ProcessingStatus、ImmichSyncStatus ENUM，PosterFile 新增 posterArea、description、personSummary、storagePath、處理狀態、Immich 同步欄位，Theme 新增 immichAlbumId、immichSyncStatus | - |
