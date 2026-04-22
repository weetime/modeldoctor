import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { useSidebarStore } from "@/stores/sidebar-store";
import { ChevronDown, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { useTranslation } from "react-i18next";
import { NavLink } from "react-router-dom";
import {
	type SidebarItem as Item,
	sidebarGroups,
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
					{railCollapsed ? (
						item.comingSoon ? (
							<span
								aria-hidden
								className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-warning"
							/>
						) : null
					) : (
						<>
							<span className="flex-1">{label}</span>
							{item.comingSoon ? (
								<Badge variant="outline">{t("status.comingSoon")}</Badge>
							) : null}
						</>
					)}
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

export function Sidebar() {
	const { t } = useTranslation("sidebar");
	const { t: tc } = useTranslation("common");
	const collapsed = useSidebarStore((s) => s.collapsedGroups);
	const toggleGroup = useSidebarStore((s) => s.toggleGroup);
	const railCollapsed = useSidebarStore((s) => s.railCollapsed);
	const toggleRail = useSidebarStore((s) => s.toggleRail);

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
						<div className="truncate text-sm font-semibold tracking-tight">
							{tc("appName")}
						</div>
						<div className="mt-0.5 truncate text-[11px] text-muted-foreground">
							{tc("tagline")}
						</div>
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

			<nav
				className={cn(
					"flex-1 overflow-y-auto py-3",
					railCollapsed ? "px-2" : "px-2",
				)}
			>
				{sidebarGroups.map((group) => {
					const isCollapsed = collapsed[group.id];
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
										className={cn(
											"h-3 w-3 transition-transform",
											isCollapsed && "-rotate-90",
										)}
										strokeWidth={2}
									/>
								</button>
							)}
							{!railCollapsed && isCollapsed ? null : (
								<div className="mt-1 flex flex-col gap-px">
									{group.items.map((item) => (
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

			<div className="px-2 py-3">
				{sidebarUtilityItems.map((item) => (
					<ItemRow
						key={item.to}
						item={item}
						t={(k) => t(k)}
						railCollapsed={railCollapsed}
					/>
				))}
			</div>
		</aside>
	);
}
