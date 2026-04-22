import i18n from "@/lib/i18n";
import { create } from "zustand";
import { persist } from "zustand/middleware";

export type Locale = "en-US" | "zh-CN";

interface LocaleStore {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  /** Revert to browser-detected locale and update i18next. */
  reset: () => void;
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
      reset: () => {
        const detected = detectInitial();
        i18n.changeLanguage(detected);
        set({ locale: detected });
      },
    }),
    { name: "md.locale.v1" },
  ),
);
