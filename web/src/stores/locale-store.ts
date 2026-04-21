import i18n from "@/lib/i18n";
import { create } from "zustand";
import { persist } from "zustand/middleware";

export type Locale = "en-US" | "zh-CN";

interface LocaleStore {
	locale: Locale;
	setLocale: (locale: Locale) => void;
}

function detectInitial(): Locale {
	const nav = typeof navigator !== "undefined" ? navigator.language : "en-US";
	return nav.toLowerCase().startsWith("zh") ? "zh-CN" : "en-US";
}

export const useLocaleStore = create<LocaleStore>()(
	persist(
		(set) => ({
			locale: detectInitial(),
			setLocale: (locale) => {
				i18n.changeLanguage(locale);
				set({ locale });
			},
		}),
		{
			name: "md.locale.v1",
			onRehydrateStorage: () => (state) => {
				if (state) i18n.changeLanguage(state.locale);
			},
		},
	),
);
