import { create } from "zustand";
import { persist } from "zustand/middleware";

export type ThemeMode = "light" | "dark" | "system";

interface ThemeStore {
	mode: ThemeMode;
	setMode: (mode: ThemeMode) => void;
}

function applyMode(mode: ThemeMode): void {
	const isDark =
		mode === "dark" ||
		(mode === "system" &&
			window.matchMedia("(prefers-color-scheme: dark)").matches);
	document.documentElement.classList.toggle("dark", isDark);
}

export const useThemeStore = create<ThemeStore>()(
	persist(
		(set) => ({
			mode: "system",
			setMode: (mode) => {
				applyMode(mode);
				set({ mode });
			},
		}),
		{
			name: "md.theme.v1",
			onRehydrateStorage: () => (state) => {
				if (state) applyMode(state.mode);
			},
		},
	),
);
