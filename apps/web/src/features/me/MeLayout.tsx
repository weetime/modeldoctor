import { PageHeader } from "@/components/common/page-header";
import { cn } from "@/lib/utils";
import { useTranslation } from "react-i18next";
import { NavLink, Outlet } from "react-router-dom";

const NAV_ITEMS = [
  { to: "/me/profile", labelKey: "nav.profile" },
  { to: "/me/security", labelKey: "nav.security" },
  { to: "/me/notifications", labelKey: "nav.notifications" },
];

export function MeLayout(): JSX.Element {
  const { t } = useTranslation("me");
  return (
    <>
      <PageHeader title={t("page.title")} subtitle={t("page.subtitle")} />
      <div className="flex gap-8 px-8 py-6">
        <nav className="w-48 shrink-0 space-y-1">
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                cn(
                  "block rounded-md px-3 py-1.5 text-sm",
                  isActive
                    ? "bg-accent/50 text-foreground"
                    : "text-muted-foreground hover:bg-accent/30 hover:text-foreground",
                )
              }
            >
              {t(item.labelKey)}
            </NavLink>
          ))}
        </nav>
        <div className="min-w-0 flex-1">
          <Outlet />
        </div>
      </div>
    </>
  );
}
