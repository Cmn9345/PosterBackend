import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useAuthStore } from "../stores/authStore";

export const Route = createFileRoute("/login")({
  component: Login,
});

function Login() {
  const navigate = useNavigate();
  const { login, loading: authLoading, error: authError, user, initialized } = useAuthStore();
  const [step, setStep] = useState<"phone" | "otp">("phone");
  const [phone, setPhone] = useState("");
  const [phoneError, setPhoneError] = useState(false);
  const [otp, setOtp] = useState(["", "", "", "", "", ""]);
  const [countdown, setCountdown] = useState(0);
  const otpRefs = useRef<(HTMLInputElement | null)[]>([]);

  // Already authenticated → send them straight to the dashboard instead of
  // showing the login form. Covers the case where the user reloads the app
  // and lands on /login while a restored session is still valid.
  useEffect(() => {
    if (initialized && user) {
      navigate({ to: "/" });
    }
  }, [initialized, user, navigate]);

  useEffect(() => {
    if (countdown <= 0) return;
    const timer = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          clearInterval(timer);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [countdown]);

  const maskedPhone = phone
    ? phone.slice(0, 3) + "****" + phone.slice(7)
    : "";

  const handleSendOtp = () => {
    if (!phone.trim()) {
      setPhoneError(true);
      return;
    }
    setPhoneError(false);
    setStep("otp");
    setCountdown(60);
    setTimeout(() => otpRefs.current[0]?.focus(), 100);
  };

  const handleOtpChange = (index: number, value: string) => {
    if (!/^\d*$/.test(value)) return;
    const newOtp = [...otp];
    newOtp[index] = value.slice(-1);
    setOtp(newOtp);
    if (value && index < 5) {
      otpRefs.current[index + 1]?.focus();
    }
  };

  const handleOtpKeyDown = (
    index: number,
    e: React.KeyboardEvent<HTMLInputElement>,
  ) => {
    if (e.key === "Backspace" && !otp[index] && index > 0) {
      otpRefs.current[index - 1]?.focus();
    }
  };

  const handleResend = () => {
    setCountdown(60);
    setOtp(["", "", "", "", "", ""]);
    setTimeout(() => otpRefs.current[0]?.focus(), 100);
  };

  return (
    <div
      className="min-h-screen flex items-center justify-center px-4 relative overflow-hidden"
      style={{
        background:
          "linear-gradient(135deg, #003366 0%, #004d99 40%, #0d6eaa 70%, #1a8ab5 100%)",
      }}
    >
      {/* Radial gradient overlay */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            "radial-gradient(ellipse at 30% 20%, rgba(255,255,255,0.08) 0%, transparent 60%), radial-gradient(ellipse at 70% 80%, rgba(255,255,255,0.05) 0%, transparent 50%)",
        }}
      />

      {/* Login card */}
      <div className="max-w-[420px] w-full bg-white/85 backdrop-blur-[16px] rounded-3xl p-10 shadow-[0_8px_32px_rgba(0,0,0,0.08)] border border-white/60 relative z-10">
        {/* Logo & Title */}
        <div className="flex flex-col items-center mb-8">
          <img
            src="/tzuchi-logo.png"
            alt="慈濟"
            className="h-16 w-auto mb-4"
          />
          <h1 className="font-title text-2xl font-bold text-gray-900">海報資料庫後台</h1>
          <p className="text-sm text-gray-500 mt-1">
            慈濟基金會 海報管理系統
          </p>
        </div>

        {/* Google Login */}
        {authError && (
          <div className="mb-3 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-600">
            {authError}
          </div>
        )}
        <button
          type="button"
          disabled={authLoading}
          onClick={async () => {
            await login();
            const user = useAuthStore.getState().user;
            if (!user) return;
            try {
              const status = await invoke<{ onboarded: boolean }>(
                "check_onboarding_status",
              );
              navigate({ to: status.onboarded ? "/" : "/onboarding" });
            } catch (e) {
              console.error("[Login] onboarding check failed:", e);
              navigate({ to: "/onboarding" });
            }
          }}
          className="w-full h-[52px] border-2 border-gray-200 bg-white rounded-xl flex items-center justify-center gap-3 hover:bg-gray-50 hover:border-gray-300 transition-colors cursor-pointer disabled:opacity-50"
        >
          <svg className="w-5 h-5" viewBox="0 0 24 24">
            <path
              d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
              fill="#4285F4"
            />
            <path
              d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
              fill="#34A853"
            />
            <path
              d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
              fill="#FBBC05"
            />
            <path
              d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
              fill="#EA4335"
            />
          </svg>
          <span className="text-sm font-medium text-gray-700">
            {authLoading ? "登入中..." : "使用 Google 帳號登入"}
          </span>
        </button>
        <p className="text-xs text-gray-400 text-center mt-2">
          僅限慈濟 Google Workspace 帳號登入
        </p>

        {/* Divider */}
        <div className="flex items-center gap-3 my-6">
          <hr className="flex-1 border-gray-200" />
          <span className="text-sm text-gray-400">或</span>
          <hr className="flex-1 border-gray-200" />
        </div>

        {/* Phone Login */}
        {step === "phone" && (
          <div className="space-y-3">
            <div className="flex gap-2">
              <input
                type="text"
                value="台灣(886)"
                disabled
                className="w-[100px] h-[48px] bg-gray-100 border border-gray-200 rounded-xl px-3 text-sm text-gray-500"
              />
              <input
                type="tel"
                value={phone}
                onChange={(e) => {
                  setPhone(e.target.value);
                  if (phoneError) setPhoneError(false);
                }}
                placeholder="請輸入手機號碼"
                className={`flex-1 h-[48px] border rounded-xl px-4 text-sm outline-none transition-colors ${
                  phoneError
                    ? "border-red-500 focus:border-red-500"
                    : "border-gray-200 focus:border-primary"
                }`}
              />
            </div>
            {phoneError && (
              <p className="text-xs text-red-500">請輸入手機號碼</p>
            )}
            <button
              type="button"
              onClick={handleSendOtp}
              className="w-full h-[48px] bg-primary text-white rounded-xl text-sm font-medium hover:bg-primary/90 transition-colors cursor-pointer"
            >
              發送驗證碼
            </button>
          </div>
        )}

        {step === "otp" && (
          <div className="space-y-4">
            <p className="text-sm text-gray-600 text-center">
              驗證碼已發送至{" "}
              <span className="font-medium text-gray-900">{maskedPhone}</span>
            </p>

            {/* OTP Inputs */}
            <div className="flex justify-center gap-2">
              {otp.map((digit, index) => (
                <input
                  key={index}
                  ref={(el) => {
                    otpRefs.current[index] = el;
                  }}
                  type="text"
                  inputMode="numeric"
                  maxLength={1}
                  value={digit}
                  onChange={(e) => handleOtpChange(index, e.target.value)}
                  onKeyDown={(e) => handleOtpKeyDown(index, e)}
                  className="w-12 h-12 text-center text-lg font-bold border border-gray-200 rounded-xl outline-none focus:border-primary transition-colors"
                />
              ))}
            </div>

            <button
              type="button"
              onClick={() => navigate({ to: "/onboarding" })}
              className="w-full h-[48px] bg-primary text-white rounded-xl text-sm font-medium hover:bg-primary/90 transition-colors cursor-pointer"
            >
              驗證並登入
            </button>

            <div className="flex items-center justify-between text-sm">
              <button
                type="button"
                onClick={() => {
                  setStep("phone");
                  setOtp(["", "", "", "", "", ""]);
                }}
                className="text-gray-500 hover:text-gray-700 transition-colors cursor-pointer"
              >
                &larr; 重新輸入號碼
              </button>
              <button
                type="button"
                onClick={handleResend}
                disabled={countdown > 0}
                className={`transition-colors cursor-pointer ${
                  countdown > 0
                    ? "text-gray-400 cursor-not-allowed"
                    : "text-primary hover:text-primary/80"
                }`}
              >
                {countdown > 0 ? `重新發送 (${countdown}s)` : "重新發送"}
              </button>
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="mt-8 pt-6 border-t border-gray-200">
          <p className="text-xs text-gray-400 text-center">
            登入即表示您同意我們的使用條款與隱私權政策
          </p>
        </div>
      </div>
    </div>
  );
}
