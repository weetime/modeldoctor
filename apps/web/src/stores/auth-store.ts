import type { PublicUser } from "@modeldoctor/contracts";
import { create } from "zustand";

interface AuthState {
  accessToken: string | null;
  user: PublicUser | null;
  setAuth: (accessToken: string, user: PublicUser) => void;
  clear: () => void;
}

// Access token is NEVER persisted. The HttpOnly refresh cookie handles
// persistence across reloads via /api/auth/refresh on app boot.
export const useAuthStore = create<AuthState>((set) => ({
  accessToken: null,
  user: null,
  setAuth: (accessToken, user) => set({ accessToken, user }),
  clear: () => set({ accessToken: null, user: null }),
}));
