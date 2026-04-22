import { createFileRoute, Link } from "@tanstack/react-router";
import { useState, useEffect, useMemo } from "react";
import { querySupabase } from "../lib/api";
import { useAuthStore } from "../stores/authStore";

export const Route = createFileRoute("/")({
  component: Dashboard,
});

interface Application {
  id: string;
  status?: string;
  title?: string;
  applicant_name?: string;
  updated_at?: string;
}

interface Poster {
  id: string;
  status?: string;
  created_at?: string;
}

const colorMap: Record<string, string> = {
  orange: "bg-orange-500",
  green: "bg-green-500",
  blue: "bg-blue-500",
  red: "bg-red-500",
};

function formatTimeAgo(dateStr: string): string {
  const now = new Date();
  const date = new Date(dateStr);
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return "剛剛";
  if (diffMin < 60) return `${diffMin} 分鐘前`;
  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) return `${diffHours} 小時前`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays === 1) return "昨天";
  return `${diffDays} 天前`;
}

function statusDotColor(status?: string): string {
  switch (status) {
    case "approved": return "bg-green-600";
    case "pending": return "bg-orange-500";
    case "rejected": return "bg-red-600";
    default: return "bg-blue-500";
  }
}

function statusLabel(status?: string): string {
  switch (status) {
    case "approved": return "已核可";
    case "pending": return "待審核";
    case "rejected": return "已駁回";
    default: return status ?? "";
  }
}

function Dashboard() {
  const user = useAuthStore((s) => s.user);

  const [loading, setLoading] = useState(true);
  const [pendingCount, setPendingCount] = useState(0);
  const [pendingReviewCount, setPendingReviewCount] = useState(0);
  const [publishedCount, setPublishedCount] = useState(0);
  const [allPosters, setAllPosters] = useState<Poster[]>([]);
  const [activities, setActivities] = useState<Application[]>([]);
  const [todos, setTodos] = useState<Application[]>([]);

  useEffect(() => {
    let cancelled = false;

    async function fetchData() {
      try {
        const [pending, pendingReview, published, posters, recentApps, pendingApps] = await Promise.all([
          querySupabase<Application>("applications", "status=eq.pending&select=id"),
          querySupabase<Poster>("posters", "status=eq.pending_review&select=id"),
          querySupabase<Poster>("posters", "status=eq.published&select=id"),
          // 拉過去 12 個月的 posters 給月度趨勢用
          querySupabase<Poster>(
            "posters",
            `select=id,status,created_at&created_at=gte.${new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString()}&order=created_at.asc`,
          ),
          querySupabase<Application>(
            "applications",
            "select=id,title,applicant_name,status,updated_at&order=updated_at.desc&limit=6"
          ),
          querySupabase<Application>(
            "applications",
            "status=eq.pending&select=id,title,applicant_name,updated_at&order=updated_at.desc"
          ),
        ]);

        if (cancelled) return;

        setPendingCount(pending.length);
        setPendingReviewCount(pendingReview.length);
        setPublishedCount(published.length);
        setAllPosters(posters);
        setActivities(recentApps);
        setTodos(pendingApps);
      } catch (err) {
        console.error("Failed to fetch dashboard data:", err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetchData();
    return () => { cancelled = true; };
  }, []);

  // 過去 6 個月的海報建檔量（group by month，用 created_at）。
  const monthlyTrend = useMemo(() => {
    const now = new Date();
    const months: { label: string; key: string; uploads: number; published: number; pending: number }[] = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      months.push({ label: `${d.getMonth() + 1}月`, key, uploads: 0, published: 0, pending: 0 });
    }
    const idx: Record<string, number> = {};
    months.forEach((m, i) => (idx[m.key] = i));
    for (const p of allPosters) {
      if (!p.created_at) continue;
      const d = new Date(p.created_at);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      const at = idx[key];
      if (at == null) continue;
      months[at].uploads += 1;
      if (p.status === "published") months[at].published += 1;
      if (p.status === "pending_review") months[at].pending += 1;
    }
    return months;
  }, [allPosters]);

  const maxTrend = Math.max(1, ...monthlyTrend.map((m) => m.uploads));

  // 本月新增 = 最後一個 bucket
  const thisMonth = monthlyTrend[monthlyTrend.length - 1]?.uploads ?? 0;
  const lastMonth = monthlyTrend[monthlyTrend.length - 2]?.uploads ?? 0;
  const growth =
    lastMonth === 0
      ? thisMonth > 0
        ? 100
        : 0
      : Math.round(((thisMonth - lastMonth) / lastMonth) * 100);

  const stats = [
    { label: "待審核海報", value: pendingReviewCount.toLocaleString(), change: "等待審核中", color: "orange", changeColor: "text-orange-500" },
    { label: "已上架海報", value: publishedCount.toLocaleString(), change: "已公開於前台", color: "green", changeColor: "text-green-600" },
    { label: "本月新增", value: thisMonth.toLocaleString(), change: `${growth >= 0 ? "+" : ""}${growth}%（對比上月）`, color: "blue", changeColor: growth >= 0 ? "text-emerald-600" : "text-red-500" },
    { label: "待處理申請", value: pendingCount.toLocaleString(), change: "申請單待回覆", color: "red", changeColor: "text-red-500" },
  ];

  if (loading) {
    return (
      <div className="max-w-[1440px] mx-auto px-4 sm:px-6 lg:px-10 py-8 flex items-center justify-center min-h-[400px]">
        <p className="text-gray-500 text-lg">載入中...</p>
      </div>
    );
  }

  return (
    <div className="max-w-[1440px] mx-auto px-4 sm:px-6 lg:px-10 py-8 flex flex-col gap-6">
      <h1 className="text-[26px] font-bold text-primary">
        {user ? `${user.name}，歡迎回來` : "儀表盤"}
      </h1>

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
        {stats.map((s) => (
          <div key={s.label} className="card-box flex overflow-hidden h-[110px]">
            <div className={`w-[5px] ${colorMap[s.color]} shrink-0`} />
            <div className="flex flex-col justify-center gap-1.5 px-5 py-4 flex-1">
              <span className="text-[13px] font-medium text-gray-500">{s.label}</span>
              <div className="flex items-end gap-2.5">
                <span className="text-4xl font-bold text-gray-900">{s.value}</span>
                {s.change && (
                  <span className={`text-xs font-medium ${s.changeColor} pb-1`}>{s.change}</span>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Activity + Chart */}
      <div className="flex flex-col lg:flex-row gap-5 flex-1 min-h-0">
        <div className="card-box flex-1 flex flex-col p-5 gap-4 overflow-hidden">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-gray-800">最近動態</h2>
            <a href="#" className="text-[13px] font-medium text-primary hover:underline">查看全部 →</a>
          </div>
          <div className="flex flex-col flex-1 overflow-y-auto">
            {activities.length === 0 ? (
              <p className="text-sm text-gray-400 py-4">尚無動態紀錄</p>
            ) : (
              activities.map((a) => (
                <div key={a.id} className="flex items-start gap-3 py-2">
                  <div className={`w-2 h-2 rounded-full ${statusDotColor(a.status)} mt-1.5 shrink-0`} />
                  <div className="flex flex-col gap-0.5 flex-1 min-w-0">
                    <p className="text-[13px] text-gray-700">
                      {a.applicant_name ?? "使用者"} 的申請「{a.title ?? a.id}」{statusLabel(a.status)}
                    </p>
                    <span className="text-[11px] text-gray-400">
                      {a.updated_at ? formatTimeAgo(a.updated_at) : ""}
                    </span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="w-full lg:w-[480px] lg:shrink-0 card-box flex flex-col p-5 gap-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-gray-800">近 6 個月趨勢</h2>
            <Link to="/statistics" className="text-[13px] font-medium text-primary hover:underline">
              完整統計 →
            </Link>
          </div>
          {monthlyTrend.every((m) => m.uploads === 0) ? (
            <div className="flex-1 flex items-center justify-center text-sm text-gray-400 py-8">
              尚無建檔紀錄
            </div>
          ) : (
            <div className="flex items-end gap-3 flex-1 pb-6 pt-4">
              {monthlyTrend.map((m) => {
                const h = (v: number) => Math.max(2, (v / maxTrend) * 130);
                return (
                  <div key={m.key} className="flex-1 flex flex-col items-center gap-1 group">
                    <div className="flex items-end gap-0.5 relative">
                      <div className="w-3 bg-blue-500 rounded-t" style={{ height: h(m.uploads) }} title={`建檔 ${m.uploads}`} />
                      <div className="w-3 bg-orange-500 rounded-t" style={{ height: h(m.pending) }} title={`待審 ${m.pending}`} />
                      <div className="w-3 bg-green-500 rounded-t" style={{ height: h(m.published) }} title={`上架 ${m.published}`} />
                      <div className="absolute -top-5 left-1/2 -translate-x-1/2 bg-gray-800 text-white text-[10px] px-1.5 py-0.5 rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none">
                        建檔 {m.uploads} · 待審 {m.pending} · 上架 {m.published}
                      </div>
                    </div>
                    <span className="text-[10px] text-gray-400 mt-2">{m.label}</span>
                  </div>
                );
              })}
            </div>
          )}
          <div className="flex items-center justify-center gap-5">
            {[
              { color: "bg-blue-500", label: "建檔數" },
              { color: "bg-orange-500", label: "待審核" },
              { color: "bg-green-500", label: "已上架" },
            ].map((l) => (
              <div key={l.label} className="flex items-center gap-1.5">
                <div className={`w-2.5 h-2.5 rounded-sm ${l.color}`} />
                <span className="text-[11px] text-gray-500">{l.label}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Todos */}
      <div className="card-box p-5 flex flex-col gap-3">
        <h2 className="text-lg font-semibold text-gray-800">我的待辦</h2>
        {todos.length === 0 ? (
          <p className="text-sm text-gray-400 py-2">目前沒有待處理的申請</p>
        ) : (
          todos.map((t, i) => (
            <div
              key={t.id}
              className={`flex items-center gap-3 ${i === 0 ? "bg-red-50" : "bg-amber-50"} rounded-xl px-3 py-2.5`}
            >
              <div className={`w-2 h-2 rounded-full ${i === 0 ? "bg-red-600" : "bg-amber-500"} shrink-0`} />
              <p className="text-[13px] text-gray-900 flex-1">
                申請「{t.title ?? t.id}」等待您的審核
              </p>
              <span className="text-[11px] text-gray-400 shrink-0">
                {t.updated_at ? formatTimeAgo(t.updated_at) : ""}
              </span>
              <a href="#" className="text-xs font-medium text-primary hover:underline shrink-0">前往處理</a>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
