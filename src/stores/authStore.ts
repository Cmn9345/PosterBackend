// src/stores/authStore.ts
import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";

interface AuthUser {
  email: string;
  name: string;
  role: string;
  avatar_url?: string;
}

interface AuthState {
  user: AuthUser | null;
  token: string | null;
  loading: boolean;
  error: string | null;
  /** `false` until the very first `checkAuth()` resolves — route guards
   *  should hold off on any `!user → /login` redirect until this is `true`,
   *  otherwise we flash to the login page while the async check is still in
   *  flight and the restored session hasn't been applied yet. */
  initialized: boolean;
  login: () => Promise<void>;
  logout: () => Promise<void>;
  checkAuth: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  token: null,
  loading: false,
  error: null,
  initialized: false,

  login: async () => {
    set({ loading: true, error: null });
    try {
      const result = await invoke<{
        success: boolean;
        user?: AuthUser;
        token?: string;
        error?: string;
      }>("google_login");
      if (result.success && result.user) {
        set({
          user: result.user,
          token: result.token ?? null,
          loading: false,
          initialized: true,
        });
      } else {
        set({ error: result.error ?? "Login failed", loading: false });
      }
    } catch (e) {
      set({ error: String(e), loading: false });
    }
  },

  logout: async () => {
    try {
      await invoke("logout");
    } catch {
      // ignore
    }
    set({ user: null, token: null, initialized: true });
  },

  checkAuth: async () => {
    try {
      const result = await invoke<{
        success: boolean;
        user?: AuthUser;
        token?: string;
      }>("check_auth");
      if (result.success && result.user) {
        set({
          user: result.user,
          token: result.token ?? null,
          initialized: true,
        });
        return;
      }
    } catch {
      // not authenticated — fall through
    }
    set({ initialized: true });
  },
}));
