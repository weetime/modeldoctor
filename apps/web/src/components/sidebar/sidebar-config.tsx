import {
  Activity,
  Boxes,
  Bug,
  CheckCircle2,
  Database,
  Gauge,
  GitCompare,
  Image as ImageIcon,
  LineChart,
  ListOrdered,
  type LucideIcon,
  MessageSquare,
  Mic,
  Network,
  Settings,
} from "lucide-react";

export interface SidebarItem {
  to: string;
  icon: LucideIcon;
  labelKey: string; // sidebar:items.X
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
    id: "benchmarks",
    labelKey: "groups.benchmarks",
    items: [
      { to: "/benchmarks/inference", icon: Gauge, labelKey: "items.benchmarkInference" },
      { to: "/benchmarks/capacity", icon: Activity, labelKey: "items.benchmarkCapacity" },
      { to: "/benchmarks/gateway", icon: Network, labelKey: "items.benchmarkGateway" },
      { to: "/benchmarks/compare", icon: GitCompare, labelKey: "items.benchmarkCompare" },
      // benchmark-templates entry omitted in PR1; lands in PR2.
    ],
  },
  {
    id: "diagnostics",
    labelKey: "groups.diagnostics",
    items: [
      { to: "/debug", icon: Bug, labelKey: "items.requestDebug" },
      { to: "/diagnostics", icon: CheckCircle2, labelKey: "items.diagnostics" },
    ],
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
