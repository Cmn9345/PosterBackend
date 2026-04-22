import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Smartphone, Mail, ChevronRight, Check, LogOut } from "lucide-react";
import { useState, useEffect } from "react";
import { useAuthStore } from "../stores/authStore";

export const Route = createFileRoute("/profile")({
  component: Profile,
});

/* -- Google "G" SVG -- */
function GoogleLogo({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" width="20" height="20">
      <path
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
        fill="#4285F4"
      />
      <path
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
        fill="#34A853"
      />
      <path
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18A10.96 10.96 0 0 0 1 12c0 1.77.42 3.45 1.18 4.93l3.66-2.84z"
        fill="#FBBC05"
      />
      <path
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
        fill="#EA4335"
      />
    </svg>
  );
}

/* -- Identity badge options -- */
const identityOptions = [
  "慈濟志工",
  "慈濟委員",
  "慈誠隊員",
  "社區志工",
  "職工",
  "其他",
];

/* -- Hierarchy data -- */
const hierarchyFields = [
  { label: "合心", value: "本會" },
  { label: "和氣 (一)", value: "台灣" },
  { label: "和氣 (二)", value: "北區" },
  { label: "和氣 (三)", value: "台北和氣一" },
];

/* -- Shared input classes -- */
const inputClass =
  "w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary";
const disabledInputClass =
  "w-full bg-gray-100 border border-gray-200 text-gray-500 cursor-not-allowed rounded-lg px-3 py-2.5 text-sm";
const labelClass = "block text-sm font-medium text-gray-700 mb-1.5";

function Profile() {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);

  /* -- Derive name parts from user.name -- */
  const derivedLastName = user?.name ? user.name.charAt(0) : "";
  const derivedFirstName = user?.name ? user.name.slice(1) : "";

  /* -- Form state -- */
  const [lastName, setLastName] = useState(derivedLastName);
  const [firstName, setFirstName] = useState(derivedFirstName);
  const [birthYear, setBirthYear] = useState("");
  const [birthMonth, setBirthMonth] = useState("");
  const [birthDay, setBirthDay] = useState("");
  const [gender, setGender] = useState<"male" | "female">("male");
  const [identity, setIdentity] = useState("慈濟志工");

  /* Sync form when user data loads */
  useEffect(() => {
    if (user?.name) {
      setLastName(user.name.charAt(0));
      setFirstName(user.name.slice(1));
    }
  }, [user?.name]);

  /* -- Toast state -- */
  const [toastVisible, setToastVisible] = useState(false);
  const [toastMessage, setToastMessage] = useState("");

  useEffect(() => {
    if (!toastVisible) return;
    const timer = setTimeout(() => setToastVisible(false), 3000);
    return () => clearTimeout(timer);
  }, [toastVisible]);

  function showToast(message: string) {
    setToastMessage(message);
    setToastVisible(true);
  }

  const userEmail = user?.email ?? "";
  const isGoogleBound = !!user;

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-8 flex flex-col gap-6">
      {/* Toast */}
      <div
        className={`fixed top-6 right-6 z-50 flex items-center gap-2 bg-emerald-600 text-white px-5 py-3 rounded-lg shadow-lg transition-all duration-300 ${
          toastVisible
            ? "translate-x-0 opacity-100"
            : "translate-x-full opacity-0"
        }`}
      >
        <Check className="w-4 h-4" />
        <span className="text-sm font-medium">{toastMessage}</span>
      </div>

      {/* Breadcrumb */}
      <nav className="flex items-center gap-1.5 text-sm text-gray-500">
        <span>設定</span>
        <ChevronRight className="w-3.5 h-3.5" />
        <span className="text-primary font-medium">個人資料管理</span>
      </nav>

      {/* Title */}
      <h1 className="text-2xl font-bold text-primary">個人資料管理</h1>

      {/* Action buttons */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <button
          className="flex items-center justify-center gap-2 bg-primary text-white rounded-lg px-4 py-3 text-sm font-medium hover:bg-primary/90 transition-colors"
          onClick={() => showToast("手機號碼變更申請已送出")}
        >
          <Smartphone className="w-4 h-4" />
          變更手機號碼
        </button>
        <button
          className="flex items-center justify-center gap-2 bg-primary text-white rounded-lg px-4 py-3 text-sm font-medium hover:bg-primary/90 transition-colors"
          onClick={() => showToast("Gmail 信箱變更申請已送出")}
        >
          <Mail className="w-4 h-4" />
          變更 Gmail 信箱
        </button>
      </div>

      {/* Card 1: 聯絡資訊 */}
      <div className="card-box">
        <h2 className="text-base font-semibold text-primary mb-5">聯絡資訊</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
          {/* Phone */}
          <div>
            <label className={labelClass}>
              手機號碼 <span className="text-red-500">*</span>
            </label>
            <div className="flex gap-2">
              <div className={`${disabledInputClass} w-28 shrink-0 flex items-center gap-1.5`}>
                <span>+886</span>
              </div>
              <input
                type="tel"
                value=""
                disabled
                placeholder="尚未設定"
                className={disabledInputClass}
              />
            </div>
          </div>
          {/* Email */}
          <div>
            <label className={labelClass}>
              Email <span className="text-red-500">*</span>
            </label>
            <input
              type="email"
              value={userEmail}
              disabled
              className={disabledInputClass}
            />
          </div>
        </div>
      </div>

      {/* Card 2: 基本資料 */}
      <div className="card-box">
        <h2 className="text-base font-semibold text-primary mb-5">基本資料</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
          {/* Last name */}
          <div>
            <label className={labelClass}>
              姓氏 <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              className={inputClass}
            />
          </div>
          {/* First name */}
          <div>
            <label className={labelClass}>
              名字 <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              className={inputClass}
            />
          </div>
          {/* Birthday — year / month / day dropdowns */}
          <div>
            <label className={labelClass}>
              生日 <span className="text-red-500">*</span>
            </label>
            <div className="flex gap-2">
              <select
                value={birthYear}
                onChange={(e) => setBirthYear(e.target.value)}
                className={`${inputClass} flex-1`}
              >
                <option value="">年</option>
                {Array.from({ length: 100 }, (_, i) => new Date().getFullYear() - i).map((y) => (
                  <option key={y} value={y}>{y}</option>
                ))}
              </select>
              <select
                value={birthMonth}
                onChange={(e) => setBirthMonth(e.target.value)}
                className={`${inputClass} w-20`}
              >
                <option value="">月</option>
                {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                  <option key={m} value={m}>{m} 月</option>
                ))}
              </select>
              <select
                value={birthDay}
                onChange={(e) => setBirthDay(e.target.value)}
                className={`${inputClass} w-20`}
              >
                <option value="">日</option>
                {Array.from(
                  { length: birthYear && birthMonth
                    ? new Date(Number(birthYear), Number(birthMonth), 0).getDate()
                    : 31 },
                  (_, i) => i + 1,
                ).map((d) => (
                  <option key={d} value={d}>{d} 日</option>
                ))}
              </select>
            </div>
          </div>
          {/* Gender */}
          <div>
            <label className={labelClass}>
              性別 <span className="text-red-500">*</span>
            </label>
            <div className="flex items-center gap-6 h-[42px]">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="gender"
                  value="male"
                  checked={gender === "male"}
                  onChange={() => setGender("male")}
                  className="w-4 h-4 text-primary accent-[#003366]"
                />
                <span className="text-sm text-gray-700">男</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="gender"
                  value="female"
                  checked={gender === "female"}
                  onChange={() => setGender("female")}
                  className="w-4 h-4 text-primary accent-[#003366]"
                />
                <span className="text-sm text-gray-700">女</span>
              </label>
            </div>
          </div>
        </div>
      </div>

      {/* Card 3: 組織資訊 */}
      <div className="card-box">
        <h2 className="text-base font-semibold text-primary mb-5">組織資訊</h2>
        <div className="flex flex-col gap-5">
          {/* Identity dropdown */}
          <div>
            <label className={labelClass}>
              身份 <span className="text-red-500">*</span>
            </label>
            <div className="flex items-center gap-3">
              <select
                value={identity}
                onChange={(e) => setIdentity(e.target.value)}
                className={`${inputClass} appearance-none bg-[url('data:image/svg+xml;charset=UTF-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2212%22%20height%3D%2212%22%20viewBox%3D%220%200%2012%2012%22%3E%3Cpath%20fill%3D%22%23666%22%20d%3D%22M6%208L1%203h10z%22%2F%3E%3C%2Fsvg%3E')] bg-no-repeat bg-[right_12px_center]`}
              >
                {identityOptions.map((opt) => (
                  <option key={opt} value={opt}>
                    {opt}
                  </option>
                ))}
              </select>
              <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-medium bg-primary/10 text-primary shrink-0">
                {identity}
              </span>
            </div>
          </div>

          {/* 4-tier hierarchy */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
            {hierarchyFields.map((field) => (
              <div key={field.label}>
                <label className={labelClass}>{field.label}</label>
                <input
                  type="text"
                  value={field.value}
                  disabled
                  className={disabledInputClass}
                />
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Card 4: 快速登入綁定 */}
      <div className="card-box">
        <h2 className="text-base font-semibold text-primary mb-5">
          快速登入綁定
        </h2>
        {isGoogleBound ? (
          <div className="flex items-center gap-3 border border-emerald-200 bg-emerald-50 rounded-lg px-5 py-3 text-sm font-medium text-emerald-700">
            <GoogleLogo />
            <span>已綁定 Google 帳號 ({userEmail})</span>
            <Check className="w-4 h-4 ml-auto text-emerald-600" />
          </div>
        ) : (
          <button
            className="flex items-center gap-3 border border-gray-300 rounded-lg px-5 py-3 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
            onClick={() => showToast("Google 帳號綁定成功")}
          >
            <GoogleLogo />
            <span>綁定 Google 帳號</span>
          </button>
        )}
      </div>

      {/* Account card: sign out */}
      <div className="card-box">
        <h2 className="text-base font-semibold text-primary mb-4">帳號</h2>
        <button
          type="button"
          onClick={async () => {
            if (!window.confirm("確定要登出？")) return;
            await useAuthStore.getState().logout();
            navigate({ to: "/login" });
          }}
          className="flex items-center gap-2 px-4 py-2.5 text-sm font-medium text-red-600 border border-red-200 rounded-lg hover:bg-red-50 transition-colors"
        >
          <LogOut className="w-4 h-4" />
          登出
        </button>
        <p className="text-xs text-gray-500 mt-2">
          登出後需要重新以 Google 帳號登入，session token 也會被撤銷。
        </p>
      </div>

      {/* Save button */}
      <div className="flex justify-end">
        <button
          className="bg-primary text-white rounded-lg px-8 py-2.5 text-sm font-medium hover:bg-primary/90 transition-colors"
          onClick={() => {
            // TODO: Wire to update_user_profile invoke command once available
            showToast("個人資料已儲存");
          }}
        >
          儲存
        </button>
      </div>
    </div>
  );
}
