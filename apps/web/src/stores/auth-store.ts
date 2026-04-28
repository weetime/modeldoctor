import type { PublicUser } from "@modeldoctor/contracts";
import { create } from "zustand";

interface AuthState {
  accessToken: string | null;
  // ISO 8601 — matches AuthTokenResponse.accessTokenExpiresAt. Used by
  // the proactive-refresh scheduler (Task B8) to fire setTimeout ~30s
  // before this moment.
  accessTokenExpiresAt: string | null;
  user: PublicUser | null;
  setAuth: (accessToken: string, user: PublicUser, accessTokenExpiresAt: string) => void;
  clear: () => void;
}

// Access token is NEVER persisted. The HttpOnly refresh cookie handles
// persistence across reloads via /api/auth/refresh on app boot.
export const useAuthStore = create<AuthState>((set) => ({
  accessToken: null,
  accessTokenExpiresAt: null,
  user: null,
  setAuth: (accessToken, user, accessTokenExpiresAt) =>
    set({ accessToken, user, accessTokenExpiresAt }),
  clear: () => set({ accessToken: null, user: null, accessTokenExpiresAt: null }),
}));
