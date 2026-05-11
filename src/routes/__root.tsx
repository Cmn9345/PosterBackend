import { createRootRoute, Link, Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { Bell, Key } from "lucide-react";
import { useEffect, useState } from "react";
import { useAuthStore } from "../stores/authStore";
import { useCoPawNotification } from "../hooks/useCoPawNotification";
import { PermissionModal } from "../components/PermissionModal";

const navItems = [
  { to: "/", label: "儀表盤" },
  { to: "/posters", label: "海報管理" },
  { to: "/exhibitions", label: "主題海報" },
  { to: "/exhibition-structure", label: "展覽管理" },
  { to: "/poster-reviews", label: "上架審核" },
  { to: "/applications", label: "申請審核" },
  { to: "/statistics", label: "統計" },
] as const;

const noNavRoutes = ["/login", "/onboarding"];

function RootLayout() {
  const router = useRouterState();
  const navigate = useNavigate();
  const currentPath = router.location.pathname;
  const hideNav = noNavRoutes.includes(currentPath);

  const { user, checkAuth, initialized } = useAuthStore();
  const { notifications } = useCoPawNotification();
  const unreadCount = notifications.length;
  const [permModalOpen, setPermModalOpen] = useState(false);

  // Check auth on app startup
  useEffect(() => {
    checkAuth();
  }, [checkAuth]);

  // Redirect to login if not authenticated (except on login/onboarding).
  // Hold off until the initial `checkAuth()` has resolved, otherwise we'd
  // flash the user to /login every app boot before the restored session is
  // applied.
  useEffect(() => {
    if (!initialized) return;
    if (!user && !hideNav) {
      navigate({ to: "/login" });
    }
  }, [user, hideNav, navigate, initialized]);

  if (hideNav) {
    return <Outlet />;
  }

  return (
    <div className="min-h-screen bg-surface">
      {/* Top Nav */}
      <nav className="bg-white border-b border-gray-200 px-6 py-3 flex items-center justify-between sticky top-0 z-40">
        <div className="flex items-center gap-3">
          <img src="/tzuchi-logo.png" alt="慈濟" className="h-8 w-auto" />
          <span className="font-title font-semibold text-lg text-primary">海報資料庫後台</span>
          <span
            className="px-1.5 py-0.5 text-[10px] font-mono font-medium tracking-tight text-gray-500 bg-gray-100 rounded"
            title={`版本 ${__APP_VERSION__}`}
          >
            v{__APP_VERSION__}
          </span>
        </div>

        <div className="hidden md:flex items-center gap-1">
          {navItems.map((item) => {
            const isActive =
              item.to === "/"
                ? currentPath === "/"
                : currentPath.startsWith(item.to);
            return (
              <Link
                key={item.to}
                to={item.to}
                className={
                  isActive
                    ? "px-3 py-2 text-sm text-primary font-medium bg-primary/5 rounded-lg"
                    : "px-3 py-2 text-sm text-gray-500 hover:text-primary rounded-lg hover:bg-gray-50 transition-colors"
                }
              >
                {item.label}
              </Link>
            );
          })}
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setPermModalOpen(true)}
            className="pm-press pm-ring inline-flex items-center gap-2 h-9 px-4 rounded-lg text-[13px] font-medium text-white transition-all"
            style={{
              background: "linear-gradient(180deg, #4a8cc6 0%, #3b7db8 100%)",
              boxShadow:
                "0 6px 16px -4px rgba(59,125,184,0.55), inset 0 1px 0 rgba(255,255,255,0.25)",
            }}
          >
            <Key className="w-4 h-4" strokeWidth={2.2} />
            權限管理
          </button>
          <button
            className="relative cursor-pointer p-2 rounded-lg hover:bg-gray-100 transition-colors"
            aria-label="通知"
          >
            <Bell className="w-5 h-5 text-gray-500" />
            {unreadCount > 0 && (
              <span className="absolute -top-0.5 -right-0.5 w-4 h-4 bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center">
                {unreadCount > 9 ? "9+" : unreadCount}
              </span>
            )}
          </button>
          <Link
            to="/profile"
            className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-gray-100 transition-colors"
          >
            <div className="w-8 h-8 bg-primary/10 text-primary font-semibold rounded-full flex items-center justify-center text-sm">
              {user?.name?.[0] ?? "?"}
            </div>
            <span className="text-sm text-gray-700 font-medium">
              {user?.name ?? "未登入"}
            </span>
          </Link>
        </div>
      </nav>

      {/* Page Content */}
      <Outlet />

      <PermissionModal open={permModalOpen} onClose={() => setPermModalOpen(false)} />
    </div>
  );
}

export const Route = createRootRoute({
  component: RootLayout,
});
