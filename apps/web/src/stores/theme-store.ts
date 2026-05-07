import { create } from "zustand";
import { persist } from "zustand/middleware";

export type ThemeMode = "light" | "dark" | "system";
export type Palette = "slate" | "aurora" | "indigo" | "plum" | "clay";

export const PALETTES: readonly Palette[] = ["slate", "aurora", "indigo", "plum", "clay"];

interface ThemeStore {
  mode: ThemeMode;
  palette: Palette;
  setMode: (mode: ThemeMode) => void;
  setPalette: (palette: Palette) => void;
  /** Revert mode to "system" and palette to "slate", and update the DOM. */
  reset: () => void;
}

function applyMode(mode: ThemeMode): void {
  if (typeof document === "undefined") return;
  const isDark =
    mode === "dark" ||
    (mode === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", isDark);
}

function applyPalette(palette: Palette): void {
  if (typeof document === "undefined") return;
  document.documentElement.dataset.palette = palette;
}

export const useThemeStore = create<ThemeStore>()(
  persist(
    (set) => ({
      mode: "system",
      palette: "slate",
      setMode: (mode) => {
        applyMode(mode);
        set({ mode });
      },
      setPalette: (palette) => {
        applyPalette(palette);
        set({ palette });
      },
      reset: () => {
        applyMode("system");
        applyPalette("slate");
        set({ mode: "system", palette: "slate" });
      },
    }),
    {
      name: "md.theme.v1",
      onRehydrateStorage: () => (state) => {
        if (!state) return;
        applyMode(state.mode);
        // `palette` may be undefined for users hydrating a pre-multi-palette payload;
        // fall back to the default and persist it on next write.
        applyPalette(state.palette ?? "slate");
      },
    },
  ),
);
