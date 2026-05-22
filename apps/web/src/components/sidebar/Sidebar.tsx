import {
  ChevronDown,
  LogOut,
  Monitor,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  Sun,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { NavLink } from "react-router-dom";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { useAuthStore } from "@/stores/auth-store";
import { useSidebarStore } from "@/stores/sidebar-store";
import { type ThemeMode, useThemeStore } from "@/stores/theme-store";
import {
  type SidebarItem as Item,
  sidebarGroups,
  sidebarPrimaryItems,
  sidebarUtilityItems,
} from "./sidebar-config";

interface ItemRowProps {
  item: Item;
  t: (k: string) => string;
  railCollapsed: boolean;
}

function ItemRow({ item, t, railCollapsed }: ItemRowProps) {
  const Icon = item.icon;
  const label = t(item.labelKey);
  const link = (
    <NavLink
      to={item.to}
      aria-label={railCollapsed ? label : undefined}
      className={({ isActive }) =>
        cn(
          "group relative flex items-center rounded-md text-sm",
          "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
          isActive && "bg-accent/50 text-foreground",
          railCollapsed ? "justify-center px-0 py-2" : "gap-2 px-3 py-1.5",
        )
      }
    >
      {({ isActive }) => (
        <>
          {isActive ? (
            <span
              className={cn(
                "absolute rounded-r bg-foreground",
                railCollapsed
                  ? "left-0 top-1/2 h-5 w-0.5 -translate-y-1/2"
                  : "left-0 top-1.5 h-5 w-0.5",
              )}
            />
          ) : null}
          <Icon className="h-4 w-4 shrink-0" strokeWidth={1.5} />
          {railCollapsed ? null : <span className="flex-1">{label}</span>}
        </>
      )}
    </NavLink>
  );

  if (!railCollapsed) return link;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{link}</TooltipTrigger>
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  );
}

function ThemeRow({ railCollapsed }: { railCollapsed: boolean }) {
  const { t } = useTranslation("common");
  const mode = useThemeStore((s) => s.mode);
  const setMode = useThemeStore((s) => s.setMode);
  const Icon = mode === "light" ? Sun : mode === "dark" ? Moon : Monitor;
  const label = t("theme.label");
  const items: { value: ThemeMode; label: string; icon: typeof Sun }[] = [
    { value: "light", label: t("theme.light"), icon: Sun },
    { value: "dark", label: t("theme.dark"), icon: Moon },
    { value: "system", label: t("theme.system"), icon: Monitor },
  ];

  const trigger = (
    <DropdownMenuTrigger asChild>
      <button
        type="button"
        aria-label={t("theme.toggle")}
        className={cn(
          "group flex w-full items-center rounded-md text-sm",
          "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
          railCollapsed ? "justify-center px-0 py-2" : "gap-2 px-3 py-1.5",
        )}
      >
        <Icon className="h-4 w-4 shrink-0" strokeWidth={1.5} />
        {railCollapsed ? null : <span className="flex-1 text-left">{label}</span>}
      </button>
    </DropdownMenuTrigger>
  );

  return (
    <DropdownMenu>
      {railCollapsed ? (
        <Tooltip>
          <TooltipTrigger asChild>{trigger}</TooltipTrigger>
          <TooltipContent side="right">{label}</TooltipContent>
        </Tooltip>
      ) : (
        trigger
      )}
      <DropdownMenuContent side="top" align="start" className="min-w-[8rem]">
        {items.map((item) => (
          <DropdownMenuItem key={item.value} onClick={() => setMode(item.value)} className="gap-2">
            <item.icon className="h-4 w-4" />
            <span>{item.label}</span>
            {mode === item.value ? (
              <span className="ml-auto text-xs text-muted-foreground">●</span>
            ) : null}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function initialsFor(email: string, displayName: string | null): string {
  const src = displayName?.trim() || email;
  return src.slice(0, 2).toUpperCase();
}

function UserPanel({ railCollapsed }: { railCollapsed: boolean }) {
  const { t: tSidebar } = useTranslation("sidebar");
  const user = useAuthStore((s) => s.user);
  if (!user) return null;
  const label = user.displayName?.trim() || user.email;

  const avatar = (
    <div className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-pink-500 text-xs font-bold text-white">
      {user.avatarUrl ? (
        <img src={user.avatarUrl} alt="" className="h-full w-full object-cover" />
      ) : (
        initialsFor(user.email, user.displayName)
      )}
    </div>
  );

  const trigger = (
    <DropdownMenuTrigger asChild>
      <button
        type="button"
        className={cn(
          "flex w-full items-center rounded-md text-sm",
          "text-foreground hover:bg-accent/50",
          railCollapsed ? "justify-center px-0 py-2" : "gap-2 px-3 py-1.5",
        )}
        aria-label={label}
      >
        {avatar}
        {railCollapsed ? null : (
          <>
            <span className="min-w-0 flex-1 truncate text-left font-medium">{label}</span>
            <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" strokeWidth={2} />
          </>
        )}
      </button>
    </DropdownMenuTrigger>
  );

  return (
    <div className="border-t border-border px-2 py-2">
      <DropdownMenu>
        {railCollapsed ? (
          <Tooltip>
            <TooltipTrigger asChild>{trigger}</TooltipTrigger>
            <TooltipContent side="right">{label}</TooltipContent>
          </Tooltip>
        ) : (
          trigger
        )}
        <DropdownMenuContent side="top" align="start" className="min-w-[10rem]">
          <DropdownMenuItem asChild>
            <NavLink to="/me">{tSidebar("items.profile")}</NavLink>
          </DropdownMenuItem>
          <DropdownMenuItem onClick={handleLogout} className="gap-2">
            <LogOut className="h-4 w-4" />
            <span>{tSidebar("items.logout")}</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

async function handleLogout() {
  // Clear the in-memory store first: otherwise a parallel 401 anywhere in the
  // app could trigger silent-refresh and re-hydrate the session while the
  // logout POST is still in flight. The server-side logout reads the refresh
  // cookie, not the bearer, so dropping the access token locally is safe.
  const token = useAuthStore.getState().accessToken;
  useAuthStore.getState().clear();
  try {
    await fetch("/api/auth/logout", {
      method: "POST",
      credentials: "include",
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
  } catch {
    // ignore — we've already locally logged the user out
  }
  window.location.href = "/login";
}

export function Sidebar() {
  const { t } = useTranslation("sidebar");
  const { t: tc } = useTranslation("common");
  const collapsed = useSidebarStore((s) => s.collapsedGroups);
  const toggleGroup = useSidebarStore((s) => s.toggleGroup);
  const railCollapsed = useSidebarStore((s) => s.railCollapsed);
  const toggleRail = useSidebarStore((s) => s.toggleRail);
  const userEmail = useAuthStore((s) => s.user?.email);

  return (
    <aside
      className={cn(
        "flex h-screen flex-col border-r border-border bg-card transition-[width] duration-150",
        railCollapsed ? "w-14" : "w-64",
      )}
    >
      {railCollapsed ? (
        <div className="flex items-center justify-center px-2 py-5">
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={toggleRail}
                aria-label={tc("sidebar.expand")}
                className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent/50 hover:text-foreground"
              >
                <PanelLeftOpen className="h-4 w-4" strokeWidth={1.5} />
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">{tc("sidebar.expand")}</TooltipContent>
          </Tooltip>
        </div>
      ) : (
        <div className="flex items-start justify-between px-5 py-5">
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold tracking-tight">{tc("appName")}</div>
            <div className="mt-0.5 truncate text-[11px] text-muted-foreground">{tc("tagline")}</div>
          </div>
          <button
            type="button"
            onClick={toggleRail}
            aria-label={tc("sidebar.collapse")}
            title={tc("sidebar.collapse")}
            className="-mr-1 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent/50 hover:text-foreground"
          >
            <PanelLeftClose className="h-4 w-4" strokeWidth={1.5} />
          </button>
        </div>
      )}

      <Separator />

      <nav className={cn("flex-1 overflow-y-auto py-3", railCollapsed ? "px-2" : "px-2")}>
        {sidebarPrimaryItems.length > 0 ? (
          <div className="mb-3 flex flex-col gap-px">
            {sidebarPrimaryItems.map((item) => (
              <ItemRow key={item.to} item={item} t={(k) => t(k)} railCollapsed={railCollapsed} />
            ))}
          </div>
        ) : null}
        {sidebarGroups.map((group) => {
          const isCollapsed = collapsed[group.id];
          const visibleItems = group.items.filter((item) => !item.devOnly || import.meta.env.DEV);
          if (visibleItems.length === 0) return null;
          return (
            <div key={group.id} className="mb-3">
              {railCollapsed ? (
                <div className="mx-2 mb-1 h-px bg-border/60" aria-hidden />
              ) : (
                <button
                  type="button"
                  onClick={() => toggleGroup(group.id)}
                  className="flex w-full items-center justify-between px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground"
                >
                  <span>{t(group.labelKey)}</span>
                  <ChevronDown
                    className={cn("h-3 w-3 transition-transform", isCollapsed && "-rotate-90")}
                    strokeWidth={2}
                  />
                </button>
              )}
              {!railCollapsed && isCollapsed ? null : (
                <div className="mt-1 flex flex-col gap-px">
                  {visibleItems.map((item) => (
                    <ItemRow
                      key={item.to}
                      item={item}
                      t={(k) => t(k)}
                      railCollapsed={railCollapsed}
                    />
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </nav>

      <Separator />

      <div className="flex flex-col gap-px px-2 py-3">
        <ThemeRow railCollapsed={railCollapsed} />
        {sidebarUtilityItems.map((item) => (
          <ItemRow key={item.to} item={item} t={(k) => t(k)} railCollapsed={railCollapsed} />
        ))}
      </div>

      {userEmail ? <UserPanel railCollapsed={railCollapsed} /> : null}
    </aside>
  );
}
