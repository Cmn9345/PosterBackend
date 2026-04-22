import { createFileRoute } from "@tanstack/react-router";
import { useState, useEffect, useMemo, useCallback } from "react";
import {
  Download,
  BarChart3,
  PieChart,
  Trophy,
  MapPin,
  TrendingUp,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import { querySupabase } from "../lib/api";

export const Route = createFileRoute("/statistics")({
  component: Statistics,
});

/* ───────────────── types ───────────────── */

interface PosterRow {
  id: string;
  status?: string;
  location_org?: string | null;
  location_general?: string | null;
  location_other?: string | null;
  item_type_id?: string | null;
  created_at?: string | null;
}

interface VocabRow {
  id: string;
  name: string;
}

interface PosterFileThemeRow {
  poster_id: string;
  themes: string[] | null;
}

/* ───────────────── time range ───────────────── */

type RangeKey = "month" | "quarter" | "year" | "all";

const RANGE_LABEL: Record<RangeKey, string> = {
  month: "本月",
  quarter: "本季",
  year: "今年",
  all: "全部",
};

function resolveRange(key: RangeKey): { from: Date | null; to: Date | null } {
  const now = new Date();
  const to = new Date(now);
  to.setHours(23, 59, 59, 999);
  if (key === "month") {
    const from = new Date(now.getFullYear(), now.getMonth(), 1);
    return { from, to };
  }
  if (key === "quarter") {
    const q = Math.floor(now.getMonth() / 3);
    const from = new Date(now.getFullYear(), q * 3, 1);
    return { from, to };
  }
  if (key === "year") {
    const from = new Date(now.getFullYear(), 0, 1);
    return { from, to };
  }
  return { from: null, to: null };
}

function prevRange(key: RangeKey): { from: Date | null; to: Date | null } {
  const now = new Date();
  if (key === "month") {
    const from = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const to = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);
    return { from, to };
  }
  if (key === "quarter") {
    const q = Math.floor(now.getMonth() / 3);
    const from = new Date(now.getFullYear(), (q - 1) * 3, 1);
    const to = new Date(now.getFullYear(), q * 3, 0, 23, 59, 59, 999);
    return { from, to };
  }
  if (key === "year") {
    const from = new Date(now.getFullYear() - 1, 0, 1);
    const to = new Date(now.getFullYear() - 1, 11, 31, 23, 59, 59, 999);
    return { from, to };
  }
  return { from: null, to: null };
}

/** 國內地點關鍵字 — 其餘視為海外 */
const DOMESTIC_KEYWORDS = [
  "台灣", "臺灣", "花蓮", "台北", "臺北", "新北", "桃園", "新竹", "苗栗",
  "台中", "臺中", "彰化", "南投", "雲林", "嘉義", "台南", "臺南", "高雄",
  "屏東", "宜蘭", "基隆", "澎湖", "金門", "馬祖", "TW", "Taiwan",
];

function classifyLocation(p: PosterRow): { bucket: "domestic" | "oversea"; label: string } {
  const loc =
    [p.location_org, p.location_general, p.location_other]
      .filter((v): v is string => !!v && v.trim().length > 0)
      .join(" ") || "未標註";
  const domestic = DOMESTIC_KEYWORDS.some((kw) => loc.includes(kw));
  return { bucket: domestic ? "domestic" : "oversea", label: loc };
}

function toDateParam(d: Date): string {
  return d.toISOString();
}

function bucketKey(d: Date, granularity: "day" | "week" | "month"): string {
  if (granularity === "day") {
    return d.toISOString().slice(0, 10);
  }
  if (granularity === "month") {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  }
  // week (ISO-ish, sunday-start)
  const first = new Date(d);
  first.setDate(first.getDate() - first.getDay());
  return `W${first.toISOString().slice(0, 10)}`;
}

function pickGranularity(key: RangeKey): "day" | "week" | "month" {
  if (key === "month") return "day";
  if (key === "quarter") return "week";
  return "month";
}

/* ───────────────── small widgets ───────────────── */

const cardShell =
  "card-box p-5 flex flex-col gap-4";

function SectionHeader({ icon, title, right }: { icon: React.ReactNode; title: string; right?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <div className="flex items-center gap-2">
        <div className="text-primary">{icon}</div>
        <h2 className="text-sm font-semibold text-primary">{title}</h2>
      </div>
      {right}
    </div>
  );
}

/* ───────────────── main component ───────────────── */

function Statistics() {
  const [range, setRange] = useState<RangeKey>("year");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [posters, setPosters] = useState<PosterRow[]>([]);
  const [prevPosters, setPrevPosters] = useState<PosterRow[]>([]);
  const [vocab, setVocab] = useState<Record<string, string>>({});
  const [themes, setThemes] = useState<string[]>([]);

  const { from, to } = useMemo(() => resolveRange(range), [range]);
  const { from: pFrom, to: pTo } = useMemo(() => prevRange(range), [range]);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const filters = (from: Date | null, to: Date | null) => {
        const parts: string[] = [];
        if (from) parts.push(`created_at=gte.${toDateParam(from)}`);
        if (to) parts.push(`created_at=lte.${toDateParam(to)}`);
        parts.push(
          "select=id,status,location_org,location_general,location_other,item_type_id,created_at",
        );
        parts.push("order=created_at.desc");
        return parts.join("&");
      };

      const [main, prev, vocabRows] = await Promise.all([
        querySupabase<PosterRow>("posters", filters(from, to)),
        pFrom && pTo
          ? querySupabase<PosterRow>("posters", filters(pFrom, pTo))
          : Promise.resolve<PosterRow[]>([]),
        querySupabase<VocabRow>("vocabulary_items", "select=id,name"),
      ]);

      const vocabMap: Record<string, string> = {};
      for (const v of vocabRows) vocabMap[v.id] = v.name;
      setVocab(vocabMap);
      setPosters(main);
      setPrevPosters(prev);

      // Pull themes from poster_files for every poster in-range, flatten the
      // arrays, and hand them to `topThemes` below. Separate query so it
      // doesn't widen the initial posters payload (themes = dashboard-only).
      if (main.length > 0) {
        const ids = main.map((p) => p.id).slice(0, 500).join(",");
        try {
          const files = await querySupabase<PosterFileThemeRow>(
            "poster_files",
            `select=poster_id,themes&poster_id=in.(${ids})`,
          );
          const flat: string[] = [];
          for (const f of files) {
            if (Array.isArray(f.themes)) {
              for (const t of f.themes) {
                if (typeof t === "string" && t.trim().length > 0) {
                  flat.push(t.trim());
                }
              }
            }
          }
          setThemes(flat);
        } catch {
          setThemes([]);
        }
      } else {
        setThemes([]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "載入統計資料失敗");
    } finally {
      setLoading(false);
    }
  }, [from, to, pFrom, pTo]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  /* ──── derived metrics ──── */

  const totals = useMemo(() => {
    const total = posters.length;
    const published = posters.filter((p) => p.status === "published").length;
    const rejected = posters.filter((p) => p.status === "rejected").length;
    const pending = posters.filter((p) => p.status === "pending_review").length;
    const decided = published + rejected;
    const approvalRate = decided > 0 ? Math.round((published / decided) * 100) : 0;
    const prevTotal = prevPosters.length;
    const growth =
      prevTotal === 0
        ? total > 0
          ? 100
          : 0
        : Math.round(((total - prevTotal) / prevTotal) * 100);
    return { total, published, rejected, pending, approvalRate, prevTotal, growth };
  }, [posters, prevPosters]);

  const locationStats = useMemo(() => {
    const domestic: Record<string, number> = {};
    const oversea: Record<string, number> = {};
    for (const p of posters) {
      const { bucket, label } = classifyLocation(p);
      const target = bucket === "domestic" ? domestic : oversea;
      target[label] = (target[label] ?? 0) + 1;
    }
    const sum = (map: Record<string, number>) =>
      Object.values(map).reduce((a, b) => a + b, 0);
    const toEntries = (map: Record<string, number>) =>
      Object.entries(map).sort((a, b) => b[1] - a[1]);
    return {
      domestic: { count: sum(domestic), entries: toEntries(domestic) },
      oversea: { count: sum(oversea), entries: toEntries(oversea) },
    };
  }, [posters]);

  const categoryDist = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const p of posters) {
      if (!p.item_type_id) continue;
      const name = vocab[p.item_type_id] ?? "（未知類別）";
      counts[name] = (counts[name] ?? 0) + 1;
    }
    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .map(([name, count]) => ({ name, count }));
  }, [posters, vocab]);

  const topThemes = useMemo(() => {
    if (themes.length === 0) {
      // Fallback: before any file has themes written to Supabase, show the
      // class-type distribution so the card doesn't look broken.
      return categoryDist.slice(0, 10);
    }
    const counts: Record<string, number> = {};
    for (const t of themes) counts[t] = (counts[t] ?? 0) + 1;
    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([name, count]) => ({ name, count }));
  }, [themes, categoryDist]);

  const uploadTrend = useMemo(() => {
    const gran = pickGranularity(range);
    const buckets: Record<string, number> = {};
    for (const p of posters) {
      if (!p.created_at) continue;
      const k = bucketKey(new Date(p.created_at), gran);
      buckets[k] = (buckets[k] ?? 0) + 1;
    }
    const entries = Object.entries(buckets).sort(
      ([a], [b]) => (a < b ? -1 : a > b ? 1 : 0),
    );
    return { gran, entries };
  }, [posters, range]);

  const maxTrend = Math.max(1, ...uploadTrend.entries.map(([, v]) => v));

  const exportCsv = useCallback(() => {
    const lines: string[] = [];
    lines.push(`統計報表,時間範圍=${RANGE_LABEL[range]}`);
    lines.push("");
    lines.push("摘要");
    lines.push(`海報總數,${totals.total}`);
    lines.push(`已上架,${totals.published}`);
    lines.push(`待審核,${totals.pending}`);
    lines.push(`已駁回,${totals.rejected}`);
    lines.push(`核可率,${totals.approvalRate}%`);
    lines.push(`上期比較,${totals.prevTotal}`);
    lines.push(`成長率,${totals.growth}%`);
    lines.push("");
    lines.push("地點,國內/海外,數量");
    for (const [name, n] of locationStats.domestic.entries) lines.push(`${name},國內,${n}`);
    for (const [name, n] of locationStats.oversea.entries) lines.push(`${name},海外,${n}`);
    lines.push("");
    lines.push("類別,數量");
    for (const { name, count } of categoryDist) lines.push(`${name},${count}`);
    lines.push("");
    lines.push("時間,上架數");
    for (const [k, n] of uploadTrend.entries) lines.push(`${k},${n}`);

    // `﻿` BOM — Excel 正確辨識 UTF-8 + 中文。
    const blob = new Blob(["﻿" + lines.join("\n")], {
      type: "text/csv;charset=utf-8;",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const stamp = new Date().toISOString().slice(0, 10);
    a.download = `poster-stats-${RANGE_LABEL[range]}-${stamp}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [range, totals, locationStats, categoryDist, uploadTrend]);

  /* ───────────────── render ───────────────── */

  if (loading) {
    return (
      <div className="max-w-[1440px] mx-auto px-4 sm:px-6 lg:px-10 py-8 flex items-center justify-center min-h-[400px]">
        <p className="text-gray-500 text-lg">載入中...</p>
      </div>
    );
  }

  return (
    <div className="max-w-[1440px] mx-auto px-4 sm:px-6 lg:px-10 py-8 flex flex-col gap-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-primary">統計報表</h1>
          <p className="text-xs text-gray-500 mt-1">
            {from ? from.toISOString().slice(0, 10) : "起始"} ~{" "}
            {to ? to.toISOString().slice(0, 10) : "至今"}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {(Object.keys(RANGE_LABEL) as RangeKey[]).map((k) => (
            <button
              key={k}
              onClick={() => setRange(k)}
              className={`px-3 py-1.5 text-sm rounded-lg border transition-colors ${
                range === k
                  ? "bg-primary text-white border-primary"
                  : "bg-white text-gray-700 border-gray-300 hover:bg-gray-50"
              }`}
            >
              {RANGE_LABEL[k]}
            </button>
          ))}
          <button
            onClick={exportCsv}
            className="flex items-center gap-2 border border-primary text-primary rounded-lg px-4 py-1.5 text-sm font-medium hover:bg-primary/5 transition-colors"
          >
            <Download className="w-4 h-4" />
            匯出報表
          </button>
        </div>
      </div>

      {error && (
        <div className="p-3 rounded-lg bg-red-50 text-red-700 text-sm">{error}</div>
      )}

      {/* Summary cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
        <StatCard
          label="海報總數"
          value={totals.total.toLocaleString()}
          hint={`${RANGE_LABEL[range]}內建檔數`}
          color="blue"
        />
        <StatCard
          label="本期新增"
          value={totals.total.toLocaleString()}
          hint={`成長率 ${totals.growth >= 0 ? "+" : ""}${totals.growth}%（對比上期 ${totals.prevTotal}）`}
          hintTone={totals.growth >= 0 ? "up" : "down"}
          color="green"
        />
        <StatCard
          label="核可率"
          value={`${totals.approvalRate}%`}
          hint={`${totals.published} 上架 / ${totals.rejected} 駁回`}
          color="violet"
        />
        <StatCard
          label="總下載次數"
          value="—"
          hint="下載追蹤待接入"
          color="orange"
        />
      </div>

      {/* Charts 2x2 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* 上傳趨勢 */}
        <div className={cardShell}>
          <SectionHeader
            icon={<BarChart3 className="w-4 h-4" />}
            title={`上傳趨勢（以${uploadTrend.gran === "day" ? "日" : uploadTrend.gran === "week" ? "週" : "月"}為單位）`}
          />
          {uploadTrend.entries.length === 0 ? (
            <div className="py-10 text-center text-sm text-gray-400">此時段無資料</div>
          ) : (
            <div className="flex items-end gap-1 min-h-[200px] border-l border-b border-gray-100 pl-1 pb-1 pt-4">
              {uploadTrend.entries.map(([key, n]) => (
                <div key={key} className="flex-1 flex flex-col items-center gap-1 group min-w-0">
                  <div className="w-full flex justify-center relative">
                    <div
                      className="w-full max-w-[28px] bg-primary rounded-t transition-colors group-hover:bg-[#004080]"
                      style={{ height: `${Math.max(2, (n / maxTrend) * 170)}px` }}
                    />
                    <div className="absolute -top-5 left-1/2 -translate-x-1/2 bg-gray-800 text-white text-[10px] px-1.5 py-0.5 rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none">
                      {key} · {n}
                    </div>
                  </div>
                  <span className="text-[9px] text-gray-400 mt-1 truncate w-full text-center">
                    {key.replace(/^W/, "")}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 核可率 donut */}
        <div className={cardShell}>
          <SectionHeader
            icon={<PieChart className="w-4 h-4" />}
            title="申請核可率"
          />
          <div className="flex-1 flex flex-col items-center justify-center gap-5 min-h-[220px]">
            <div className="relative w-40 h-40">
              <div
                className="w-40 h-40 rounded-full"
                style={{
                  background: `conic-gradient(#003366 0% ${totals.approvalRate}%, #e5e7eb ${totals.approvalRate}% 100%)`,
                }}
              />
              <div className="w-32 h-32 bg-white rounded-full flex items-center justify-center absolute top-4 left-4">
                <div className="text-center">
                  <div className="text-3xl font-bold text-primary">{totals.approvalRate}%</div>
                  <div className="text-xs text-gray-400">核可率</div>
                </div>
              </div>
            </div>
            <div className="flex items-center gap-6">
              <LegendDot color="bg-primary" label={`已上架 ${totals.published}`} />
              <LegendDot color="bg-gray-200" label={`已駁回 ${totals.rejected}`} />
            </div>
          </div>
        </div>

        {/* 熱門主題 Top 10（類別聚合） */}
        <div className={cardShell}>
          <SectionHeader
            icon={<Trophy className="w-4 h-4" />}
            title="熱門主題 Top 10"
          />
          {topThemes.length === 0 ? (
            <div className="py-10 text-center text-sm text-gray-400">此時段無類別資料</div>
          ) : (
            <div className="flex flex-col gap-2">
              {topThemes.map((t) => (
                <div key={t.name} className="flex items-center gap-3">
                  <span className="text-[13px] text-gray-700 w-24 shrink-0 text-right truncate" title={t.name}>
                    {t.name}
                  </span>
                  <div className="flex-1 h-6 bg-gray-100 rounded overflow-hidden">
                    <div
                      className="h-full bg-primary rounded transition-all"
                      style={{ width: `${(t.count / topThemes[0].count) * 100}%` }}
                    />
                  </div>
                  <span className="text-[13px] font-medium text-gray-500 w-10 text-right shrink-0">
                    {t.count}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 海報類別分佈（完整） */}
        <div className={cardShell}>
          <SectionHeader
            icon={<TrendingUp className="w-4 h-4" />}
            title="海報類別分佈"
          />
          {categoryDist.length === 0 ? (
            <div className="py-10 text-center text-sm text-gray-400">此時段無類別資料</div>
          ) : (
            <div className="flex flex-col gap-2">
              {categoryDist.map((t) => (
                <div key={t.name} className="flex items-center gap-3">
                  <span className="text-[13px] text-gray-700 w-24 shrink-0 text-right truncate" title={t.name}>
                    {t.name}
                  </span>
                  <div className="flex-1 h-6 bg-gray-100 rounded overflow-hidden">
                    <div
                      className="h-full bg-emerald-500 rounded transition-all"
                      style={{ width: `${(t.count / categoryDist[0].count) * 100}%` }}
                    />
                  </div>
                  <span className="text-[13px] font-medium text-gray-500 w-10 text-right shrink-0">
                    {t.count}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* 展覽地點統計 */}
      <LocationPanel stats={locationStats} />
    </div>
  );
}

/* ───────────────── sub components ───────────────── */

const COLOR_ACCENT: Record<string, string> = {
  blue: "bg-blue-500",
  green: "bg-green-500",
  violet: "bg-violet-500",
  orange: "bg-orange-500",
};

function StatCard({
  label,
  value,
  hint,
  hintTone,
  color,
}: {
  label: string;
  value: string;
  hint?: string;
  hintTone?: "up" | "down" | "neutral";
  color: string;
}) {
  const toneClass =
    hintTone === "up"
      ? "text-emerald-600"
      : hintTone === "down"
        ? "text-red-500"
        : "text-gray-500";
  return (
    <div className="card-box flex overflow-hidden h-[110px]">
      <div className={`w-[5px] ${COLOR_ACCENT[color] ?? "bg-gray-300"} shrink-0`} />
      <div className="flex flex-col justify-center gap-1.5 px-5 py-4 flex-1 min-w-0">
        <span className="text-[13px] font-medium text-gray-500">{label}</span>
        <div className="flex items-end gap-2.5">
          <span className="text-4xl font-bold text-gray-900">{value}</span>
        </div>
        {hint && (
          <span className={`text-[11px] font-medium ${toneClass} truncate`} title={hint}>
            {hint}
          </span>
        )}
      </div>
    </div>
  );
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <div className="flex items-center gap-2">
      <div className={`w-3 h-3 rounded-sm ${color}`} />
      <span className="text-xs text-gray-600">{label}</span>
    </div>
  );
}

function LocationPanel({
  stats,
}: {
  stats: {
    domestic: { count: number; entries: [string, number][] };
    oversea: { count: number; entries: [string, number][] };
  };
}) {
  const [openDomestic, setOpenDomestic] = useState(true);
  const [openOversea, setOpenOversea] = useState(false);

  return (
    <div className={cardShell}>
      <SectionHeader
        icon={<MapPin className="w-4 h-4" />}
        title="展覽地點統計"
      />
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <LocationGroup
          title="國內"
          count={stats.domestic.count}
          entries={stats.domestic.entries}
          open={openDomestic}
          onToggle={() => setOpenDomestic((v) => !v)}
          tone="emerald"
        />
        <LocationGroup
          title="海外"
          count={stats.oversea.count}
          entries={stats.oversea.entries}
          open={openOversea}
          onToggle={() => setOpenOversea((v) => !v)}
          tone="indigo"
        />
      </div>
    </div>
  );
}

function LocationGroup({
  title,
  count,
  entries,
  open,
  onToggle,
  tone,
}: {
  title: string;
  count: number;
  entries: [string, number][];
  open: boolean;
  onToggle: () => void;
  tone: "emerald" | "indigo";
}) {
  const toneBar = tone === "emerald" ? "bg-emerald-500" : "bg-indigo-500";
  return (
    <div className="border border-gray-200 rounded-lg overflow-hidden">
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-50 transition-colors"
      >
        <div className="flex items-center gap-2">
          {open ? (
            <ChevronDown className="w-4 h-4 text-gray-500" />
          ) : (
            <ChevronRight className="w-4 h-4 text-gray-500" />
          )}
          <span className="text-sm font-semibold text-gray-800">{title}</span>
        </div>
        <span className="text-sm text-gray-500">{count}</span>
      </button>
      {open && entries.length > 0 && (
        <div className="px-4 py-3 border-t border-gray-100 flex flex-col gap-1.5">
          {entries.map(([name, n]) => (
            <div key={name} className="flex items-center gap-3 text-xs">
              <span className="text-gray-700 w-40 truncate shrink-0" title={name}>
                {name}
              </span>
              <div className="flex-1 h-3 bg-gray-100 rounded overflow-hidden">
                <div
                  className={`h-full ${toneBar} rounded`}
                  style={{ width: `${(n / Math.max(1, entries[0][1])) * 100}%` }}
                />
              </div>
              <span className="text-gray-500 w-8 text-right shrink-0">{n}</span>
            </div>
          ))}
        </div>
      )}
      {open && entries.length === 0 && (
        <div className="px-4 py-3 border-t border-gray-100 text-xs text-gray-400">
          無資料
        </div>
      )}
    </div>
  );
}
