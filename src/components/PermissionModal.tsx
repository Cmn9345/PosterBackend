import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, Key, X, Loader2, RefreshCw } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { querySupabase } from "../lib/api";

// ---------- Types & data ----------

export type RoleName = "建檔者" | "審核者" | "承辦者" | "系統管理員";
export type PermKey = "新增" | "審核" | "下架" | "下載";

export interface Member {
  name: string;
  email: string;
  role: RoleName;
}

const ROLES: RoleName[] = ["建檔者", "審核者", "承辦者", "系統管理員"];

// 截圖「成員權限表@海報資料庫」10 位同仁。角色用「最高角色權限計」規則：
// 建檔者 < 審核者 < 承辦者 < 系統管理員。
// Email 目前是 seed 時用的中文拼音 placeholder — 10 人各自 Google 登入後，
// Rust 端 `ensure_public_user_row` 會把 placeholder row 的 id + email 改成
// 真實 auth.users 值。未來這份 DEFAULT 清單會被 Supabase 實際查詢覆蓋（見
// fetchMembers TODO）。
const DEFAULT_MEMBERS: Member[] = [
  { name: "羅政忠", email: "luo.chengchung@tzuchi.org.tw", role: "承辦者" },
  { name: "莊茹貽", email: "chuang.ruyi@tzuchi.org.tw",     role: "系統管理員" },
  { name: "陳美蓉", email: "chen.meirong@tzuchi.org.tw",    role: "系統管理員" },
  { name: "張寶文", email: "chang.paowen@tzuchi.org.tw",    role: "系統管理員" },
  { name: "李立仁", email: "li.liren@tzuchi.org.tw",        role: "系統管理員" },
  { name: "鍾楚妍", email: "chung.chuyen@tzuchi.org.tw",    role: "承辦者" },
  { name: "鄭琇方", email: "cheng.hsiufang@tzuchi.org.tw",  role: "建檔者" },
  { name: "許茜婷", email: "hsu.chienting@tzuchi.org.tw",   role: "建檔者" },
  { name: "周翰林", email: "chou.hanlin@tzuchi.org.tw",     role: "建檔者" },
  { name: "張家寧", email: "chang.chianing@tzuchi.org.tw",  role: "建檔者" },
];

const MATRIX: Record<RoleName, Record<PermKey, boolean>> = {
  建檔者: { 新增: true, 審核: false, 下架: false, 下載: true },
  審核者: { 新增: false, 審核: true, 下架: true, 下載: true },
  承辦者: { 新增: false, 審核: true, 下架: true, 下載: true },
  系統管理員: { 新增: true, 審核: true, 下架: true, 下載: true },
};

interface PermDef {
  key: PermKey;
  icon: "upload" | "review" | "unpublish" | "download";
  hint: string;
}

const PERMS: PermDef[] = [
  { key: "新增", icon: "upload", hint: "上傳新海報" },
  { key: "審核", icon: "review", hint: "審核申請單" },
  { key: "下架", icon: "unpublish", hint: "下架已發布海報" },
  { key: "下載", icon: "download", hint: "下載海報原檔" },
];

// ---------- PermIcon ----------

function PermIcon({
  name,
  enabled,
  size = 30,
}: {
  name: PermDef["icon"];
  enabled: boolean;
  size?: number;
}) {
  const accent = enabled ? "#3b7db8" : "#9aa6b6";
  const accentDeep = enabled ? "#2c5f8f" : "#7b8798";
  const accentSoft = enabled ? "rgba(59,125,184,0.16)" : "rgba(120,140,170,0.12)";
  const paper = enabled ? "#ffffff" : "#f2f5f9";
  const common = {
    width: size,
    height: size,
    viewBox: "0 0 64 64",
    fill: "none" as const,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
  const ink = { stroke: accentDeep, strokeWidth: 1.6 };

  if (name === "upload") {
    return (
      <svg {...common}>
        <path d="M18 13 h18 l10 10 v22 a4 4 0 0 1 -4 4 H18 a4 4 0 0 1 -4 -4 V17 a4 4 0 0 1 4 -4 z" fill={paper} {...ink} />
        <path d="M36 13 v6 a4 4 0 0 0 4 4 h6" fill={accentSoft} {...ink} />
        <path d="M22 34 h10 M22 40 h16 M22 46 h12" stroke={accent} strokeWidth="1.4" opacity="0.55" />
        <circle cx="44" cy="46" r="9" fill={accent} stroke={accentDeep} strokeWidth="1.4" />
        <path d="M44 50 V42 M40.5 45.5 L44 42 L47.5 45.5" stroke="#ffffff" strokeWidth="1.8" />
      </svg>
    );
  }
  if (name === "review") {
    return (
      <svg {...common}>
        <rect x="26" y="9" width="14" height="6" rx="2" fill={accentSoft} {...ink} />
        <circle cx="33" cy="12" r="1.4" fill={accentDeep} />
        <path d="M18 14 h8 M40 14 h8 a4 4 0 0 1 4 4 v32 a4 4 0 0 1 -4 4 H18 a4 4 0 0 1 -4 -4 V18 a4 4 0 0 1 4 -4 z" fill={paper} {...ink} />
        <path d="M22 28 h12 M22 34 h20 M22 40 h14" stroke={accent} strokeWidth="1.4" opacity="0.55" />
        <circle cx="44" cy="46" r="10" fill={accent} stroke={accentDeep} strokeWidth="1.4" />
        <circle cx="44" cy="46" r="7" stroke="#ffffff" strokeWidth="1.3" opacity="0.75" />
        <path d="M40 46.5 L43 49.5 L48.5 43.5" stroke="#ffffff" strokeWidth="2" />
      </svg>
    );
  }
  if (name === "unpublish") {
    return (
      <svg {...common}>
        <path d="M10 18 H54" stroke={accentDeep} strokeWidth="2.4" strokeLinecap="round" />
        <path d="M24 18 V14 a2 2 0 0 1 2 -2 H38 a2 2 0 0 1 2 2 V18" fill={accentSoft} stroke={accentDeep} strokeWidth="1.6" />
        <path d="M14 18 L16 52 a3 3 0 0 0 3 3 H45 a3 3 0 0 0 3 -3 L50 18 z" fill={paper} stroke={accentDeep} strokeWidth="1.6" strokeLinejoin="round" />
        <path d="M18 22 L20 50" stroke={accent} strokeWidth="1.4" opacity="0.5" />
        <path d="M26 26 V48 M32 26 V48 M38 26 V48" stroke={accent} strokeWidth="1.6" opacity="0.7" />
      </svg>
    );
  }
  // download
  return (
    <svg {...common}>
      <rect x="18" y="10" width="28" height="24" rx="3" fill={paper} {...ink} />
      <circle cx="26" cy="19" r="2.2" fill={accent} />
      <path d="M18 30 L26 24 L32 28 L40 22 L46 26 V34 H18 z" fill={accentSoft} stroke={accentDeep} strokeWidth="1.2" />
      <path d="M32 30 V46" stroke={accentDeep} strokeWidth="2.4" />
      <path d="M24 42 L32 50 L40 42" stroke={accentDeep} strokeWidth="2.4" fill="none" />
      <path d="M32 30 V46 M24 42 L32 50 L40 42" stroke={accent} strokeWidth="1.2" fill="none" />
      <path d="M14 52 H50 a2 2 0 0 1 2 2 v1 a2 2 0 0 1 -2 2 H14 a2 2 0 0 1 -2 -2 v-1 a2 2 0 0 1 2 -2 z" fill={accentSoft} stroke={accentDeep} strokeWidth="1.4" />
    </svg>
  );
}

// ---------- Small building blocks ----------

function PermChip({ perm, enabled, animKey }: { perm: PermDef; enabled: boolean; animKey: string }) {
  return (
    <div className="flex flex-col items-center gap-1" title={`${perm.key} · ${perm.hint}`}>
      <div
        key={animKey}
        className={`pm-perm-anim relative w-12 h-12 rounded-xl flex items-center justify-center ${
          enabled ? "pm-perm-on" : "pm-perm-off pm-slash"
        }`}
        style={{ color: enabled ? "#3b7db8" : "#9aa6b6" }}
      >
        <div style={{ opacity: enabled ? 1 : 0.5, filter: enabled ? "none" : "grayscale(0.7)" }}>
          <PermIcon name={perm.icon} enabled={enabled} size={30} />
        </div>
      </div>
      <div
        className={`text-[10px] font-medium tracking-wide ${
          enabled ? "text-slate-700" : "text-slate-400"
        }`}
      >
        {perm.key}
      </div>
    </div>
  );
}

function RoleSelectInline({ value, onChange }: { value: RoleName; onChange: (role: RoleName) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  return (
    <div ref={ref} className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="pm-ring h-7 pl-2.5 pr-1.5 rounded-lg flex items-center gap-1.5 text-[12px] font-medium transition bg-white/80 border border-slate-200 text-slate-700 hover:bg-white"
      >
        <span className="w-1.5 h-1.5 rounded-full bg-[#3b7db8]" />
        <span>{value}</span>
        <ChevronDown className={`w-3 h-3 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div
          className="absolute left-0 mt-1.5 min-w-[132px] rounded-xl overflow-hidden z-20 bg-white border border-slate-200"
          style={{ boxShadow: "0 20px 40px -12px rgba(20,40,70,0.35)" }}
        >
          {ROLES.map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => {
                onChange(r);
                setOpen(false);
              }}
              className={`w-full text-left px-3 py-2 text-[13px] flex items-center justify-between gap-3 hover:bg-slate-50 text-slate-700 ${
                r === value ? "bg-[#e8f1f9]" : ""
              }`}
            >
              <span>{r}</span>
              {r === value && <Check className="w-3.5 h-3.5 text-[#3b7db8]" strokeWidth={2.5} />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function Avatar({ name }: { name: string }) {
  const ch = (name || "?")[0];
  return (
    <div
      className="w-9 h-9 rounded-full flex items-center justify-center text-white text-[13px] font-semibold shrink-0"
      style={{
        background: "linear-gradient(135deg,#5aa0d8,#3b7db8)",
        boxShadow: "0 4px 10px -4px rgba(59,125,184,0.4), inset 0 1px 0 rgba(255,255,255,0.25)",
      }}
    >
      {ch}
    </div>
  );
}

function MemberRow({ member, onRoleChange }: { member: Member; onRoleChange: (r: RoleName) => void }) {
  const perms = MATRIX[member.role];
  return (
    <div className="flex items-center gap-4 px-4 py-3 rounded-xl transition bg-white/60 hover:bg-white/90 border border-slate-900/5">
      <Avatar name={member.name} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <div className="text-[14px] font-semibold truncate text-slate-800">{member.name}</div>
          <RoleSelectInline value={member.role} onChange={onRoleChange} />
        </div>
        <div className="text-[11.5px] font-mono tracking-tight truncate mt-0.5 text-slate-500">
          {member.email}
        </div>
      </div>
      <div className="flex items-start gap-1.5 shrink-0">
        {PERMS.map((p) => (
          <PermChip
            key={p.key}
            perm={p}
            enabled={perms[p.key]}
            animKey={`${member.email}-${member.role}-${p.key}`}
          />
        ))}
      </div>
    </div>
  );
}

// ---------- Modal ----------

interface UserRow {
  id: string;
  name: string | null;
  email: string | null;
  app_role: string | null;
}

function normalizeRole(raw: string | null | undefined): RoleName {
  if (raw && ROLES.includes(raw as RoleName)) return raw as RoleName;
  return "建檔者";
}

export function PermissionModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [members, setMembers] = useState<Member[]>(DEFAULT_MEMBERS);
  const [initial, setInitial] = useState<Member[]>(DEFAULT_MEMBERS);
  const [ids, setIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function fetchMembers() {
    setLoading(true);
    setError(null);
    try {
      const rows = await querySupabase<UserRow>(
        "users",
        "select=id,name,email,app_role&email=ilike.*@tzuchi.org.tw&order=name.asc",
      );
      if (rows.length === 0) {
        // 雲端沒資料 fallback 到 hardcode，讓 UI 還看得到示意名單。
        setMembers(DEFAULT_MEMBERS);
        setInitial(DEFAULT_MEMBERS);
        setIds([]);
        return;
      }
      const mapped: Member[] = rows.map((r) => ({
        name: r.name ?? r.email ?? "(未命名)",
        email: r.email ?? "",
        role: normalizeRole(r.app_role),
      }));
      setMembers(mapped);
      setInitial(mapped);
      setIds(rows.map((r) => r.id));
    } catch (err) {
      const msg =
        typeof err === "string"
          ? err
          : err instanceof Error
            ? err.message
            : "載入成員失敗";
      setError(msg);
      // 失敗時至少顯示 DEFAULT 讓使用者能作業
      setMembers(DEFAULT_MEMBERS);
      setInitial(DEFAULT_MEMBERS);
      setIds([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (open) {
      fetchMembers();
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const dirtyCount = members.reduce((n, m, i) => n + (m.role !== initial[i].role ? 1 : 0), 0);
  const dirty = dirtyCount > 0;

  const setRoleAt = (i: number, role: RoleName) =>
    setMembers((list) => list.map((m, idx) => (idx === i ? { ...m, role } : m)));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4 py-8">
      <div
        onClick={onClose}
        className="pm-backdrop-anim absolute inset-0 bg-slate-900/30"
        style={{ backdropFilter: "blur(6px)", WebkitBackdropFilter: "blur(6px)" }}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="perm-title"
        className="pm-modal-anim pm-glass relative w-[760px] max-w-full max-h-full flex flex-col rounded-2xl text-slate-800"
      >
        <div
          className="pointer-events-none absolute -top-16 -right-16 w-48 h-48 rounded-full opacity-60"
          style={{
            background: "radial-gradient(closest-side, rgba(59,125,184,0.35), transparent 70%)",
          }}
        />

        <div className="px-6 pt-5 pb-4 flex items-start justify-between relative">
          <div>
            <div className="flex items-center gap-2">
              <div
                className="w-7 h-7 rounded-lg flex items-center justify-center text-white"
                style={{ background: "linear-gradient(135deg,#4a8cc6,#3b7db8)" }}
              >
                <Key className="w-3.5 h-3.5" strokeWidth={2.2} />
              </div>
              <h2 id="perm-title" className="text-[17px] font-semibold tracking-wide">
                權限管理
              </h2>
              <span className="ml-1 text-[11px] px-2 py-0.5 rounded-full bg-slate-900/5 text-slate-600">
                {members.length} 位成員
              </span>
            </div>
            <p className="text-[12px] mt-1 text-slate-500">
              為每位成員指派身份，右側圖示即時顯示對應的功能權限
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-lg flex items-center justify-center transition hover:bg-black/5 text-slate-500"
            aria-label="關閉"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="mx-6 px-4 py-2 rounded-lg flex items-center justify-between bg-slate-900/[0.025]">
          <div className="text-[11px] font-medium tracking-wide text-slate-500">成員</div>
          <div className="flex items-center gap-1.5">
            {PERMS.map((p) => (
              <div key={p.key} className="w-12 text-center text-[10.5px] font-medium tracking-wide text-slate-500">
                {p.key}
              </div>
            ))}
          </div>
        </div>

        <div
          className="px-6 py-3 space-y-2 overflow-y-auto"
          style={{ maxHeight: "min(62vh, 520px)" }}
        >
          {members.map((m, i) => (
            <MemberRow key={m.email} member={m} onRoleChange={(r) => setRoleAt(i, r)} />
          ))}
        </div>

        <div className="px-6 py-4 flex items-center justify-between gap-3 rounded-b-2xl bg-white/40 border-t border-slate-900/5">
          <div className="text-[11.5px] text-slate-500">
            {dirty ? (
              <>
                尚未套用變更：<b className="text-[#3b7db8]">{dirtyCount}</b> 位成員
              </>
            ) : (
              "所有成員權限已同步"
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={fetchMembers}
              disabled={loading || saving}
              className="pm-press h-9 px-3 rounded-lg text-[13px] font-medium transition text-slate-500 hover:bg-black/5 disabled:opacity-50 flex items-center gap-1.5"
              title="重新從雲端載入"
            >
              {loading ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <RefreshCw className="w-3.5 h-3.5" />
              )}
              重新載入
            </button>
            <button
              type="button"
              onClick={onClose}
              className="pm-press h-9 px-4 rounded-lg text-[13px] font-medium transition text-slate-600 hover:bg-black/5"
            >
              取消
            </button>
            <button
              type="button"
              onClick={async () => {
                // 把每位 role 有變更的成員 PATCH 回 Supabase public.users。
                // ids[] 對齊 members[] 的順序（空陣列表示 fallback 到 DEFAULT，不寫回）。
                if (ids.length === 0) {
                  setError("目前沒有雲端對應使用者可寫回（先讓 10 人登入一次）。");
                  return;
                }
                setSaving(true);
                setError(null);
                try {
                  const tasks: Promise<unknown>[] = [];
                  for (let i = 0; i < members.length; i++) {
                    if (members[i].role === initial[i].role) continue;
                    const id = ids[i];
                    const role = members[i].role;
                    tasks.push(
                      invoke("patch_user_role", { userId: id, role }),
                    );
                  }
                  await Promise.all(tasks);
                  setInitial(members);
                  onClose();
                } catch (err) {
                  const msg =
                    typeof err === "string"
                      ? err
                      : err instanceof Error
                        ? err.message
                        : "儲存失敗，請確認你擁有系統管理員權限。";
                  setError(msg);
                } finally {
                  setSaving(false);
                }
              }}
              disabled={!dirty || saving}
              className="pm-press pm-ring h-9 px-5 rounded-lg text-[13px] font-semibold text-white transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5"
              style={{
                background: "linear-gradient(180deg, #4a8cc6 0%, #3b7db8 100%)",
                boxShadow: dirty
                  ? "0 6px 16px -4px rgba(59,125,184,0.6), inset 0 1px 0 rgba(255,255,255,0.25)"
                  : "none",
              }}
            >
              {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              {saving ? "儲存中..." : "儲存變更"}
            </button>
          </div>
          {error && (
            <div className="absolute left-6 right-6 bottom-16 px-3 py-2 rounded-lg bg-red-50 border border-red-100 text-xs text-red-700">
              {error}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
