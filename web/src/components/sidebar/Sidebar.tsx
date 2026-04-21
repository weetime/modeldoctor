import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { useSidebarStore } from "@/stores/sidebar-store";
import { ChevronDown } from "lucide-react";
import { useTranslation } from "react-i18next";
import { NavLink } from "react-router-dom";
import {
	type SidebarItem as Item,
	sidebarGroups,
	sidebarUtilityItems,
} from "./sidebar-config";

function ItemRow({ item, t }: { item: Item; t: (k: string) => string }) {
	const Icon = item.icon;
	return (
		<NavLink
			to={item.to}
			className={({ isActive }) =>
				cn(
					"group relative flex items-center gap-2 rounded-md px-3 py-1.5 text-sm",
					"text-muted-foreground hover:bg-accent/50 hover:text-foreground",
					isActive && "bg-accent/50 text-foreground",
				)
			}
		>
			{({ isActive }) => (
				<>
					{isActive ? (
						<span className="absolute left-0 top-1.5 h-5 w-0.5 rounded-r bg-foreground" />
					) : null}
					<Icon className="h-4 w-4" strokeWidth={1.5} />
					<span className="flex-1">{t(item.labelKey)}</span>
					{item.comingSoon ? (
						<Badge variant="outline">{t("status.comingSoon")}</Badge>
					) : null}
				</>
			)}
		</NavLink>
	);
}

export function Sidebar() {
	const { t } = useTranslation("sidebar");
	const { t: tc } = useTranslation("common");
	const collapsed = useSidebarStore((s) => s.collapsedGroups);
	const toggleGroup = useSidebarStore((s) => s.toggleGroup);

	return (
		<aside className="flex h-screen w-64 flex-col border-r border-border bg-card">
			<div className="px-5 py-5">
				<div className="text-sm font-semibold tracking-tight">
					{tc("appName")}
				</div>
				<div className="mt-0.5 text-[11px] text-muted-foreground">
					{tc("tagline")}
				</div>
			</div>

			<Separator />

			<nav className="flex-1 overflow-y-auto px-2 py-3">
				{sidebarGroups.map((group) => {
					const isCollapsed = collapsed[group.id];
					return (
						<div key={group.id} className="mb-3">
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
							{isCollapsed ? null : (
								<div className="mt-1 flex flex-col gap-px">
									{group.items.map((item) => (
										<ItemRow key={item.to} item={item} t={(k) => t(k)} />
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
					<ItemRow key={item.to} item={item} t={(k) => t(k)} />
				))}
			</div>
		</aside>
	);
}
