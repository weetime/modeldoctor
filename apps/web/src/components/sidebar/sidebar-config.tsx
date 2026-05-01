import {
  Activity,
  Boxes,
  Bug,
  CheckCircle2,
  Database,
  Gauge,
  GitCompare,
  HeartPulse,
  History,
  Image as ImageIcon,
  LineChart,
  ListOrdered,
  type LucideIcon,
  MessageSquare,
  Mic,
  Settings,
  Timer,
  Zap,
} from "lucide-react";

export interface SidebarItem {
  to: string;
  icon: LucideIcon;
  labelKey: string; // sidebar:items.X
  comingSoon?: boolean;
  devOnly?: boolean;
}

export interface SidebarGroup {
  id: string;
  labelKey: string; // sidebar:groups.X
  items: SidebarItem[];
}

export const sidebarGroups: SidebarGroup[] = [
  {
    id: "playground",
    labelKey: "groups.playground",
    items: [
      { to: "/playground/chat", icon: MessageSquare, labelKey: "items.playgroundChat" },
      { to: "/playground/image", icon: ImageIcon, labelKey: "items.playgroundImage" },
      { to: "/playground/audio", icon: Mic, labelKey: "items.playgroundAudio" },
      {
        to: "/playground/embeddings",
        icon: Boxes,
        labelKey: "items.playgroundEmbeddings",
      },
      { to: "/playground/rerank", icon: ListOrdered, labelKey: "items.playgroundRerank" },
    ],
  },
  {
    id: "performance",
    labelKey: "groups.performance",
    items: [
      { to: "/load-test", icon: Activity, labelKey: "items.loadTest" },
      { to: "/benchmarks", icon: Gauge, labelKey: "items.benchmark" },
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
  {
    id: "dev",
    labelKey: "groups.dev",
    items: [
      {
        to: "/dev/charts",
        icon: LineChart,
        labelKey: "items.devCharts",
        devOnly: true,
      },
    ],
  },
];

export const sidebarUtilityItems: SidebarItem[] = [
  { to: "/connections", icon: Database, labelKey: "items.connections" },
  { to: "/settings", icon: Settings, labelKey: "items.settings" },
];
