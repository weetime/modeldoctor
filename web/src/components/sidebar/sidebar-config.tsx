import {
	Activity,
	Bug,
	CheckCircle2,
	Database,
	GitCompare,
	HeartPulse,
	History,
	type LucideIcon,
	Settings,
	Timer,
	Zap,
} from "lucide-react";

export interface SidebarItem {
	to: string;
	icon: LucideIcon;
	labelKey: string; // sidebar:items.X
	comingSoon?: boolean;
}

export interface SidebarGroup {
	id: string;
	labelKey: string; // sidebar:groups.X
	items: SidebarItem[];
}

export const sidebarGroups: SidebarGroup[] = [
	{
		id: "performance",
		labelKey: "groups.performance",
		items: [
			{ to: "/load-test", icon: Activity, labelKey: "items.loadTest" },
			{ to: "/soak", icon: Timer, labelKey: "items.soak", comingSoon: true },
			{
				to: "/streaming",
				icon: Zap,
				labelKey: "items.streaming",
				comingSoon: true,
			},
		],
	},
	{
		id: "correctness",
		labelKey: "groups.correctness",
		items: [
			{ to: "/e2e", icon: CheckCircle2, labelKey: "items.e2e" },
			{
				to: "/regression",
				icon: GitCompare,
				labelKey: "items.regression",
				comingSoon: true,
			},
		],
	},
	{
		id: "observability",
		labelKey: "groups.observability",
		items: [
			{
				to: "/health",
				icon: HeartPulse,
				labelKey: "items.health",
				comingSoon: true,
			},
			{
				to: "/history",
				icon: History,
				labelKey: "items.history",
				comingSoon: true,
			},
		],
	},
	{
		id: "debug",
		labelKey: "groups.debug",
		items: [{ to: "/debug", icon: Bug, labelKey: "items.requestDebug" }],
	},
];

export const sidebarUtilityItems: SidebarItem[] = [
	{ to: "/connections", icon: Database, labelKey: "items.connections" },
	{ to: "/settings", icon: Settings, labelKey: "items.settings" },
];
