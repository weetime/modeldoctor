import { useTranslation } from "react-i18next";
import { useLocation, useNavigate } from "react-router-dom";

export interface ChatModeTab {
  key: string;
  label: string;
}

/**
 * Returns Shell-compatible tabs config + active key + onChange handler that
 * navigates between /playground/chat (single) and /playground/chat/compare.
 */
export function useChatModeTabs(): {
  tabs: ChatModeTab[];
  active: "single" | "compare";
  onChange: (k: string) => void;
} {
  const { t } = useTranslation("playground");
  const nav = useNavigate();
  const { pathname } = useLocation();
  const active = pathname.endsWith("/compare") ? "compare" : "single";
  return {
    tabs: [
      { key: "single", label: t("chat.compare.modeTabs.single") },
      { key: "compare", label: t("chat.compare.modeTabs.compare") },
    ],
    active,
    onChange: (k: string) => nav(k === "compare" ? "/playground/chat/compare" : "/playground/chat"),
  };
}
