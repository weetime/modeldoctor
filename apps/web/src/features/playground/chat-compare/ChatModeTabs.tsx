import { cn } from "@/lib/utils";
import { useTranslation } from "react-i18next";
import { NavLink } from "react-router-dom";

export function ChatModeTabs() {
  const { t } = useTranslation("playground");
  const cls = ({ isActive }: { isActive: boolean }) =>
    cn(
      "rounded-md px-3 py-1.5 text-sm",
      isActive ? "bg-accent text-foreground" : "text-muted-foreground hover:bg-accent/40 hover:text-foreground",
    );
  return (
    <div className="flex items-center gap-1 border-b border-border px-2">
      <NavLink to="/playground/chat" end className={cls}>
        {t("chat.compare.modeTabs.single")}
      </NavLink>
      <NavLink to="/playground/chat/compare" className={cls}>
        {t("chat.compare.modeTabs.compare")}
      </NavLink>
    </div>
  );
}
