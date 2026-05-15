import { createFileRoute } from "@tanstack/react-router";
import {
  Search,
  Download,
  X,
  ChevronRight,
  Check,
  AlertTriangle,
  Eye,
  Building2,
  Phone,
  Mail,
  MapPin,
  Calendar,
  FileText,
  Zap,
  Loader2,
} from "lucide-react";
import { useState, useEffect, useCallback, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import { querySupabase } from "../../lib/api";

export const Route = createFileRoute("/applications/")({
  component: Applications,
});

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

type AppStatus = "pending" | "in_review" | "closure" | "approved" | "rejected";
type MaterialAttr = "none" | "logo" | "restricted" | "special";
type RoleType = "volunteer" | "staff";

interface ProgressDot {
  label: string;
  state: "completed" | "active" | "pending";
}

interface Application {
  id: string;
  date: string;
  applicant: string;
  role: RoleType;
  surname: string;
  avatarColor: string;
  avatarTextColor: string;
  venue: string;
  exhibitDateRange: string;
  material: MaterialAttr;
  posterCount: number;
  status: AppStatus;
  progress: ProgressDot[];
  // Detail panel fields
  org: string;
  phone: string;
  email: string;
  purpose: string;
  posters: { name: string; size: string; riskLabel: string; riskCls: string; thumbColor: string; thumbText: string }[];
  timeline: { label: string; state: "completed" | "active" | "pending"; desc?: string; actor?: string; time?: string }[];
  flowType: "short" | "long";
}

/** Raw row shape returned by Supabase query on the applications table */
interface ApplicationRow {
  id: string;
  created_at?: string;
  updated_at?: string;
  applicant_name?: string;
  applicant_role?: RoleType;
  venue?: string;
  exhibit_start_date?: string;
  exhibit_end_date?: string;
  material_attribute?: MaterialAttr;
  poster_count?: number;
  status?: AppStatus;
  org?: string;
  phone?: string;
  email?: string;
  purpose?: string;
  // TODO: These nested fields may not exist in the DB yet
  posters?: Application["posters"];
  timeline?: Application["timeline"];
  progress?: Application["progress"];
  flow_type?: "short" | "long";
}

/* ------------------------------------------------------------------ */
/*  Helpers: map raw DB row to Application                             */
/* ------------------------------------------------------------------ */

const avatarColors: { bg: string; text: string }[] = [
  { bg: "bg-blue-100", text: "text-blue-700" },
  { bg: "bg-purple-100", text: "text-purple-700" },
  { bg: "bg-green-100", text: "text-green-700" },
  { bg: "bg-amber-100", text: "text-amber-700" },
  { bg: "bg-teal-100", text: "text-teal-700" },
  { bg: "bg-rose-100", text: "text-rose-700" },
];

function pickAvatarColor(name: string) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  const idx = Math.abs(hash) % avatarColors.length;
  return avatarColors[idx];
}

function buildDefaultProgress(status: AppStatus, flowType: "short" | "long"): ProgressDot[] {
  if (flowType === "long") {
    const steps = ["承辦者接單", "承辦者審核", "單位主管核可", "宗教處審核", "結案"];
    return steps.map((label) => ({ label, state: "pending" as const }));
  }
  const steps = ["承辦者接單", "承辦者審核", "結案"];
  return steps.map((label) => ({ label, state: "pending" as const }));
}

function buildDefaultTimeline(status: AppStatus, flowType: "short" | "long"): Application["timeline"] {
  const progress = buildDefaultProgress(status, flowType);
  return progress.map((p) => ({ label: p.label, state: p.state }));
}

function determineFlowType(material: MaterialAttr): "short" | "long" {
  return material === "restricted" || material === "special" ? "long" : "short";
}

function formatExhibitRange(start?: string, end?: string): string {
  if (!start && !end) return "";
  const fmt = (d?: string) => {
    if (!d) return "";
    const parts = d.split("-");
    if (parts.length >= 3) return `${parts[1]}/${parts[2]}`;
    return d;
  };
  return `${fmt(start)}~${fmt(end)}`;
}

function mapRowToApplication(row: ApplicationRow): Application {
  const name = row.applicant_name || "未知";
  const surname = name.charAt(0);
  const avatar = pickAvatarColor(name);
  const material = row.material_attribute || "none";
  const status = row.status || "pending";
  const flowType = row.flow_type || determineFlowType(material);

  return {
    id: row.id,
    date: row.created_at ? row.created_at.substring(0, 10) : "",
    applicant: name,
    role: row.applicant_role || "volunteer",
    surname,
    avatarColor: avatar.bg,
    avatarTextColor: avatar.text,
    venue: row.venue || "",
    exhibitDateRange: formatExhibitRange(row.exhibit_start_date, row.exhibit_end_date),
    material,
    posterCount: row.poster_count ?? 0,
    status,
    progress: row.progress || buildDefaultProgress(status, flowType),
    org: row.org || "",
    phone: row.phone || "",
    email: row.email || "",
    purpose: row.purpose || "",
    // TODO: posters may need a separate join query once the DB schema supports them
    posters: row.posters || [],
    // TODO: timeline may need a separate join query once the DB schema supports it
    timeline: row.timeline || buildDefaultTimeline(status, flowType),
    flowType,
  };
}

/* ------------------------------------------------------------------ */
/*  Lookup maps                                                        */
/* ------------------------------------------------------------------ */

const statusBadge: Record<AppStatus, string> = {
  pending: "bg-gray-100 text-gray-600",
  in_review: "bg-yellow-50 text-yellow-700",
  closure: "bg-blue-50 text-blue-700",
  approved: "bg-green-50 text-green-700",
  rejected: "bg-red-50 text-red-700",
};

const statusLabel: Record<AppStatus, string> = {
  pending: "待審核",
  in_review: "審核中",
  closure: "待結案",
  approved: "已核可",
  rejected: "已駁回",
};

const materialBadge: Record<MaterialAttr, { cls: string; label: string }> = {
  none: { cls: "bg-green-50 text-green-700", label: "一般" },
  logo: { cls: "bg-gray-100 text-gray-600", label: "Logo" },
  restricted: { cls: "bg-red-50 text-red-700", label: "限用圖" },
  special: { cls: "bg-pink-50 text-pink-700", label: "特殊人物" },
};

const roleBadge: Record<RoleType, { cls: string; label: string }> = {
  volunteer: { cls: "bg-blue-50 text-blue-700", label: "志工" },
  staff: { cls: "bg-purple-50 text-purple-700", label: "同仁" },
};

const tabDefs: { key: AppStatus | "all"; label: string; badgeCls: string }[] = [
  { key: "pending", label: "待審核", badgeCls: "bg-red-500 text-white" },
  { key: "in_review", label: "審核中", badgeCls: "bg-gray-100 text-gray-600" },
  { key: "closure", label: "待結案", badgeCls: "bg-gray-100 text-gray-600" },
  { key: "approved", label: "已核可", badgeCls: "bg-green-100 text-green-700" },
  { key: "rejected", label: "已駁回", badgeCls: "bg-red-100 text-red-700" },
  { key: "all", label: "全部", badgeCls: "bg-gray-100 text-gray-600" },
];

/* ------------------------------------------------------------------ */
/*  Sub-components                                                     */
/* ------------------------------------------------------------------ */

function ProgressDots({ dots }: { dots: ProgressDot[] }) {
  return (
    <div className="flex items-center gap-0.5">
      {dots.map((dot, i) => {
        const isLast = i === dots.length - 1;
        let dotCls = "bg-gray-300";
        let lineCls = "bg-gray-200";

        if (dot.state === "completed") {
          dotCls = "bg-emerald-500";
          lineCls = "bg-emerald-400";
        } else if (dot.state === "active") {
          dotCls = "bg-blue-500 ring-2 ring-blue-200";
          lineCls = "bg-blue-400";
        }

        return (
          <div key={i} className="flex items-center gap-0.5">
            <div
              className={`w-2 h-2 rounded-full ${dotCls} cursor-help`}
              title={dot.label}
            />
            {!isLast && (
              <div
                className={`w-3 h-0.5 ${
                  dot.state === "completed"
                    ? lineCls
                    : dots[i + 1]?.state === "active"
                      ? "bg-blue-400"
                      : "bg-gray-200"
                }`}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

function DetailPanel({
  app,
  onClose,
  onAction,
  actionLoading,
}: {
  app: Application;
  onClose: () => void;
  onAction: (action: "accept" | "approve" | "reject" | "close", app: Application) => void;
  actionLoading: boolean;
}) {
  const isLong = app.flowType === "long";

  return (
    <>
      {/* Overlay */}
      <div
        className="fixed inset-0 bg-black/30 z-50 transition-opacity"
        onClick={onClose}
      />

      {/* Panel */}
      <div
        className="fixed top-0 right-0 h-full w-[900px] max-w-full bg-[#F8F9FA] z-50 overflow-y-auto shadow-2xl animate-slide-in"
        role="dialog"
        aria-modal="true"
        aria-label="申請單詳情"
      >
        {/* Panel Header */}
        <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between z-10">
          <div className="flex items-center gap-3">
            <h2 className="text-lg font-bold">
              申請單{" "}
              <span className="text-primary">{app.id}</span>
            </h2>
            <span
              className={`inline-block px-2.5 py-1 text-xs font-medium rounded-full ${statusBadge[app.status]}`}
            >
              {statusLabel[app.status]}
            </span>
          </div>
          <button
            className="p-2 rounded-lg hover:bg-gray-100 cursor-pointer transition-colors"
            onClick={onClose}
          >
            <X className="w-5 h-5 text-gray-400" />
          </button>
        </div>

        {/* Panel Body */}
        <div className="p-6">
          <div className="flex gap-6">
            {/* Left Column */}
            <div className="flex-1 min-w-0 space-y-5">
              {/* Applicant Info */}
              <div className="card-box">
                <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-4">
                  申請人資訊
                </h3>
                <div className="flex items-start gap-4">
                  <div
                    className={`w-12 h-12 ${app.avatarColor} ${app.avatarTextColor} rounded-full flex items-center justify-center text-lg font-bold shrink-0`}
                  >
                    {app.surname}
                  </div>
                  <div className="flex-1 space-y-2">
                    <div className="flex items-center gap-2">
                      <span className="text-lg font-semibold">
                        {app.applicant}
                      </span>
                      <span
                        className={`inline-block px-2 py-0.5 text-xs rounded ${roleBadge[app.role].cls}`}
                      >
                        {roleBadge[app.role].label}
                      </span>
                    </div>
                    <div className="grid grid-cols-2 gap-y-2 gap-x-4 text-sm">
                      <div className="flex items-center gap-2 text-gray-500">
                        <Building2 className="w-4 h-4 shrink-0" />
                        {app.org}
                      </div>
                      <div className="flex items-center gap-2 text-gray-500">
                        <Phone className="w-4 h-4 shrink-0" />
                        {app.phone}
                      </div>
                      <div className="flex items-center gap-2 text-gray-500 col-span-2">
                        <Mail className="w-4 h-4 shrink-0" />
                        {app.email}
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Exhibition Info */}
              <div className="card-box">
                <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-4">
                  展覽資訊
                </h3>
                <div className="space-y-3 text-sm">
                  <div className="flex items-start gap-3">
                    <Calendar className="w-4 h-4 text-gray-400 mt-0.5 shrink-0" />
                    <div>
                      <div className="text-gray-400 text-xs mb-0.5">
                        展覽日期
                      </div>
                      <div className="font-medium">
                        2026-{app.exhibitDateRange.replace("~", " ~ 2026-")}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <MapPin className="w-4 h-4 text-gray-400 mt-0.5 shrink-0" />
                    <div>
                      <div className="text-gray-400 text-xs mb-0.5">
                        展覽地點
                      </div>
                      <div className="font-medium">{app.venue}</div>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <FileText className="w-4 h-4 text-gray-400 mt-0.5 shrink-0" />
                    <div>
                      <div className="text-gray-400 text-xs mb-0.5">
                        使用目的
                      </div>
                      <div className="font-medium">{app.purpose}</div>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <AlertTriangle className="w-4 h-4 text-gray-400 mt-0.5 shrink-0" />
                    <div>
                      <div className="text-gray-400 text-xs mb-0.5">
                        素材屬性
                      </div>
                      <span
                        className={`inline-block px-2.5 py-1 text-xs font-medium rounded-full ${materialBadge[app.material].cls}`}
                      >
                        {materialBadge[app.material].label}
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Poster Thumbnails */}
              <div className="card-box">
                <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-4">
                  申請海報{" "}
                  <span className="text-gray-400 font-normal">
                    ({app.posters.length})
                  </span>
                </h3>
                {app.posters.length === 0 ? (
                  <p className="text-sm text-gray-400">暫無海報資料</p>
                ) : (
                  <div className="grid grid-cols-3 gap-3">
                    {app.posters.map((poster, i) => (
                      <div key={i} className="group cursor-pointer">
                        <div
                          className={`aspect-square bg-gradient-to-br ${poster.thumbColor} rounded-xl overflow-hidden flex items-center justify-center relative`}
                        >
                          <span className="text-gray-400 text-xs">
                            {poster.thumbText}
                          </span>
                          <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors flex items-center justify-center opacity-0 group-hover:opacity-100">
                            <Eye className="w-6 h-6 text-white drop-shadow" />
                          </div>
                        </div>
                        <p className="text-xs text-gray-600 mt-1.5 truncate">
                          {poster.name}
                        </p>
                        <div className="flex gap-1 mt-0.5">
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-500">
                            {poster.size}
                          </span>
                          <span
                            className={`text-[10px] px-1.5 py-0.5 rounded ${poster.riskCls}`}
                          >
                            {poster.riskLabel}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Right Column: Review Flow */}
            <div className="w-[340px] shrink-0 space-y-5">
              <div className="card-box">
                <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-5">
                  審核流程
                </h3>
                <div
                  className={`text-xs mb-4 flex items-center gap-1.5 ${
                    isLong ? "text-amber-600" : "text-gray-400"
                  }`}
                >
                  {isLong ? (
                    <AlertTriangle className="w-3.5 h-3.5" />
                  ) : (
                    <Zap className="w-3.5 h-3.5" />
                  )}
                  {isLong
                    ? "長流程（素材屬性：限用圖/特殊人物）"
                    : "短流程（素材屬性：一般/Logo）"}
                </div>

                {/* Timeline nodes */}
                <div className="relative">
                  {app.timeline.map((node, i) => {
                    const isLast = i === app.timeline.length - 1;

                    let dotContent: React.ReactNode;
                    let lineColorCls = "bg-gray-200";

                    if (node.state === "completed") {
                      dotContent = (
                        <div className="w-6 h-6 rounded-full bg-emerald-500 flex items-center justify-center">
                          <Check className="w-3.5 h-3.5 text-white" />
                        </div>
                      );
                      lineColorCls = "bg-emerald-500";
                    } else if (node.state === "active") {
                      dotContent = (
                        <div className="w-6 h-6 rounded-full bg-blue-500 ring-4 ring-blue-100 flex items-center justify-center">
                          <div className="w-2.5 h-2.5 bg-white rounded-full" />
                        </div>
                      );
                    } else {
                      dotContent = (
                        <div className="w-6 h-6 rounded-full bg-gray-200 flex items-center justify-center">
                          <div className="w-2.5 h-2.5 bg-gray-400 rounded-full" />
                        </div>
                      );
                    }

                    return (
                      <div
                        key={i}
                        className={`relative pl-9 ${isLast ? "pb-0" : "pb-7"}`}
                      >
                        {/* Connector line */}
                        {!isLast && (
                          <div
                            className={`absolute left-[11px] top-6 bottom-0 w-0.5 ${
                              node.state === "completed"
                                ? lineColorCls
                                : "bg-gray-200"
                            }`}
                          />
                        )}
                        {/* Dot */}
                        <div className="absolute left-0 top-0">
                          {dotContent}
                        </div>
                        {/* Label */}
                        <div>
                          <div
                            className={`text-sm font-medium ${
                              node.state === "pending"
                                ? "text-gray-400"
                                : node.state === "active"
                                  ? "font-semibold text-gray-900"
                                  : "text-gray-700"
                            }`}
                          >
                            {node.label}
                          </div>
                          {node.desc && (
                            <div className="text-xs text-gray-400 mt-0.5">
                              {node.desc}
                            </div>
                          )}
                          {node.actor && node.time && (
                            <div className="text-xs text-gray-400 mt-0.5">
                              {node.actor} - {node.time}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Action buttons for pending/in_review/closure */}
              {(app.status === "pending" ||
                app.status === "in_review" ||
                app.status === "closure") && (
                <div className="card-box space-y-3">
                  <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">
                    操作
                  </h3>
                  {app.status === "pending" && (
                    <button
                      disabled={actionLoading}
                      onClick={() => onAction("accept", app)}
                      className="w-full px-4 py-2.5 text-sm font-medium text-white bg-primary rounded-lg hover:bg-primary-light transition-colors cursor-pointer flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {actionLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <ChevronRight className="w-4 h-4" />}
                      接單處理
                    </button>
                  )}
                  {app.status === "in_review" && (
                    <>
                      <button
                        disabled={actionLoading}
                        onClick={() => onAction("approve", app)}
                        className="w-full px-4 py-2.5 text-sm font-medium text-white bg-emerald-600 rounded-lg hover:bg-emerald-700 transition-colors cursor-pointer flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {actionLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                        核可通過
                      </button>
                      <button
                        disabled={actionLoading}
                        onClick={() => onAction("reject", app)}
                        className="w-full px-4 py-2.5 text-sm font-medium text-red-600 bg-red-50 border border-red-200 rounded-lg hover:bg-red-100 transition-colors cursor-pointer flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {actionLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <X className="w-4 h-4" />}
                        駁回申請
                      </button>
                    </>
                  )}
                  {app.status === "closure" && (
                    <button
                      disabled={actionLoading}
                      onClick={() => onAction("close", app)}
                      className="w-full px-4 py-2.5 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors cursor-pointer flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {actionLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                      確認結案
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ */
/*  Main component                                                     */
/* ------------------------------------------------------------------ */

function Applications() {
  const [activeTab, setActiveTab] = useState<AppStatus | "all">("pending");
  const [selectedApp, setSelectedApp] = useState<Application | null>(null);
  const [searchText, setSearchText] = useState("");
  const [dateStart, setDateStart] = useState("");
  const [dateEnd, setDateEnd] = useState("");

  // Data fetching state
  const [applications, setApplications] = useState<Application[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);

  // Fetch applications from Supabase
  const fetchApplications = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const rows = await querySupabase<ApplicationRow>(
        "applications",
        "order=updated_at.desc&limit=50"
      );
      setApplications(rows.map(mapRowToApplication));
    } catch (err) {
      console.error("Failed to fetch applications:", err);
      setError(err instanceof Error ? err.message : "載入申請資料時發生錯誤");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchApplications();
  }, [fetchApplications]);

  // Computed tab counts from real data
  const tabCounts = useMemo(() => {
    const counts: Record<string, number> = { all: applications.length };
    for (const app of applications) {
      counts[app.status] = (counts[app.status] || 0) + 1;
    }
    return counts;
  }, [applications]);

  // Filtered list based on active tab, search text, and date range
  const filteredApplications = useMemo(() => {
    return applications.filter((app) => {
      // Tab filter
      if (activeTab !== "all" && app.status !== activeTab) return false;

      // Search filter
      if (searchText.trim()) {
        const q = searchText.trim().toLowerCase();
        const match =
          app.id.toLowerCase().includes(q) ||
          app.applicant.toLowerCase().includes(q) ||
          app.venue.toLowerCase().includes(q) ||
          app.org.toLowerCase().includes(q);
        if (!match) return false;
      }

      // Date range filter
      if (dateStart && app.date < dateStart) return false;
      if (dateEnd && app.date > dateEnd) return false;

      return true;
    });
  }, [applications, activeTab, searchText, dateStart, dateEnd]);

  const clearFilters = () => {
    setSearchText("");
    setDateStart("");
    setDateEnd("");
  };

  // Action handlers
  const handleAction = useCallback(
    async (action: "accept" | "approve" | "reject" | "close", app: Application) => {
      setActionLoading(true);
      try {
        // 對 applications 表做 PATCH（不是 posters / projects）。
        // 之前用 submit_review 是為了暫時兜，但它打的是 posters 表，application
        // UUID 永遠匹配 0 row → 靜默無效。改用專屬 update_application_status。
        switch (action) {
          case "accept": {
            await invoke("update_application_status", {
              payload: {
                application_id: app.id,
                status: "in_review",
                reviewer_notes: "接單處理 - 承辦者已接手",
              },
            });
            break;
          }
          case "approve": {
            const notes = window.prompt("審核備註（可選）：") ?? "";
            await invoke("update_application_status", {
              payload: {
                application_id: app.id,
                status: "approved",
                reviewer_notes: notes || undefined,
              },
            });
            break;
          }
          case "reject": {
            const reason = window.prompt("請輸入駁回原因：");
            if (!reason) {
              setActionLoading(false);
              return; // User cancelled
            }
            await invoke("update_application_status", {
              payload: {
                application_id: app.id,
                status: "rejected",
                rejection_reason: reason,
              },
            });
            break;
          }
          case "close": {
            await invoke("update_application_status", {
              payload: {
                application_id: app.id,
                status: "approved",
                reviewer_notes: "結案確認",
              },
            });
            break;
          }
        }
        // Refresh the list after action
        setSelectedApp(null);
        await fetchApplications();
      } catch (err) {
        console.error(`Action "${action}" failed:`, err);
        const msg = err instanceof Error ? err.message : String(err);
        window.alert(`操作失敗：${msg}`);
      } finally {
        setActionLoading(false);
      }
    },
    [fetchApplications]
  );

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-primary">申請單審核</h1>
          <p className="text-sm text-gray-500 mt-1">
            管理海報使用申請，審核並追蹤流程進度
          </p>
        </div>
        <button className="px-4 py-2 text-sm text-gray-600 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 cursor-pointer transition-colors flex items-center gap-2">
          <Download className="w-4 h-4" />
          匯出 Excel
        </button>
      </div>

      {/* Tabs + Filter + Table */}
      <div className="card-box !p-0">
        {/* Tabs */}
        <div
          className="flex items-center border-b border-gray-100 px-4 overflow-x-auto"
          role="tablist"
        >
          {tabDefs.map((t) => (
            <button
              key={t.key}
              role="tab"
              aria-selected={activeTab === t.key}
              onClick={() => setActiveTab(t.key)}
              className={`px-4 py-3 text-sm whitespace-nowrap border-b-2 transition-colors cursor-pointer ${
                activeTab === t.key
                  ? "text-primary border-primary font-semibold"
                  : "text-gray-500 border-transparent hover:text-primary"
              }`}
            >
              {t.label}
              <span
                className={`ml-1.5 px-1.5 py-0.5 text-[10px] font-bold rounded-full ${t.badgeCls}`}
              >
                {tabCounts[t.key] ?? 0}
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
              placeholder="搜尋申請人或編號..."
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
            />
          </div>
          <div className="flex items-center gap-1.5 text-sm text-gray-500">
            <input
              type="date"
              value={dateStart}
              onChange={(e) => setDateStart(e.target.value)}
              className="px-2.5 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 transition-colors"
            />
            <span>~</span>
            <input
              type="date"
              value={dateEnd}
              onChange={(e) => setDateEnd(e.target.value)}
              className="px-2.5 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 transition-colors"
            />
          </div>
          <button
            className="px-3 py-2 text-xs text-gray-400 hover:text-red-500 cursor-pointer transition-colors"
            onClick={clearFilters}
            title="清除篩選"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Table */}
        <div className="overflow-x-auto">
          {loading ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="w-6 h-6 text-primary animate-spin" />
              <span className="ml-2 text-sm text-gray-500">載入中...</span>
            </div>
          ) : error ? (
            <div className="flex flex-col items-center justify-center py-20 gap-3">
              <AlertTriangle className="w-8 h-8 text-red-400" />
              <p className="text-sm text-red-500">{error}</p>
              <button
                onClick={fetchApplications}
                className="px-4 py-2 text-sm text-primary border border-primary/30 rounded-lg hover:bg-primary/5 cursor-pointer transition-colors"
              >
                重新載入
              </button>
            </div>
          ) : filteredApplications.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 gap-2">
              <FileText className="w-8 h-8 text-gray-300" />
              <p className="text-sm text-gray-400">
                {searchText || dateStart || dateEnd
                  ? "沒有符合條件的申請單"
                  : "目前沒有申請資料"}
              </p>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs font-medium text-gray-500 uppercase tracking-wider border-b border-gray-100">
                  <th className="px-4 py-3">申請編號</th>
                  <th className="px-4 py-3">申請日期</th>
                  <th className="px-4 py-3">申請人</th>
                  <th className="px-4 py-3">展覽資訊</th>
                  <th className="px-4 py-3">素材屬性</th>
                  <th className="px-4 py-3 text-center">海報數</th>
                  <th className="px-4 py-3">審核進度</th>
                  <th className="px-4 py-3">狀態</th>
                  <th className="px-4 py-3 text-center">操作</th>
                </tr>
              </thead>
              <tbody>
                {filteredApplications.map((app) => (
                  <tr
                    key={app.id}
                    className="border-b border-gray-50 transition-colors hover:bg-gray-50/50"
                  >
                    <td className="px-4 py-3.5">
                      <button
                        className="text-primary font-medium hover:underline cursor-pointer bg-transparent border-none p-0"
                        onClick={() => setSelectedApp(app)}
                      >
                        {app.id}
                      </button>
                    </td>
                    <td className="px-4 py-3.5 text-gray-500">{app.date}</td>
                    <td className="px-4 py-3.5">
                      <div className="flex items-center gap-2">
                        <div
                          className={`w-7 h-7 ${app.avatarColor} ${app.avatarTextColor} rounded-full flex items-center justify-center text-xs font-semibold`}
                        >
                          {app.surname}
                        </div>
                        <div>
                          <div className="font-medium">{app.applicant}</div>
                          <span
                            className={`inline-block px-1.5 py-0.5 text-[10px] rounded ${roleBadge[app.role].cls}`}
                          >
                            {roleBadge[app.role].label}
                          </span>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3.5">
                      <div className="text-gray-900">{app.venue}</div>
                      <div className="text-xs text-gray-400">
                        {app.exhibitDateRange}
                      </div>
                    </td>
                    <td className="px-4 py-3.5">
                      <span
                        className={`inline-block px-2 py-0.5 text-xs rounded-full ${materialBadge[app.material].cls}`}
                      >
                        {materialBadge[app.material].label}
                      </span>
                    </td>
                    <td className="px-4 py-3.5 text-center">
                      {app.posterCount}
                    </td>
                    <td className="px-4 py-3.5">
                      <ProgressDots dots={app.progress} />
                    </td>
                    <td className="px-4 py-3.5">
                      <span
                        className={`inline-block px-2.5 py-1 text-xs font-medium rounded-full ${statusBadge[app.status]}`}
                      >
                        {statusLabel[app.status]}
                      </span>
                    </td>
                    <td className="px-4 py-3.5 text-center">
                      <button
                        className="px-3 py-1.5 text-xs font-medium text-primary border border-primary/30 rounded-lg hover:bg-primary/5 cursor-pointer transition-colors"
                        onClick={() => setSelectedApp(app)}
                      >
                        查看
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Pagination */}
        {!loading && !error && filteredApplications.length > 0 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100">
            <span className="text-sm text-gray-500">
              共 {filteredApplications.length} 筆
            </span>
            {/* TODO: Implement server-side pagination when data grows beyond 50 rows */}
          </div>
        )}
      </div>

      {/* Slide-in Detail Panel */}
      {selectedApp && (
        <DetailPanel
          app={selectedApp}
          onClose={() => setSelectedApp(null)}
          onAction={handleAction}
          actionLoading={actionLoading}
        />
      )}

      {/* Slide-in animation style */}
      <style>{`
        @keyframes slideIn {
          from { transform: translateX(100%); }
          to { transform: translateX(0); }
        }
        .animate-slide-in {
          animation: slideIn 0.3s cubic-bezier(0.4, 0, 0.2, 1);
        }
      `}</style>
    </div>
  );
}
