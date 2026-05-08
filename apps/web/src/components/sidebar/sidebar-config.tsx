import {
  Activity,
  BarChart3,
  Boxes,
  Bug,
  CheckCircle2,
  Database,
  Gauge,
  Image as ImageIcon,
  Layers,
  LineChart,
  ListOrdered,
  type LucideIcon,
  MessageSquare,
  Mic,
  Network,
  Rocket,
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
      { to: "/benchmarks/reports", icon: BarChart3, labelKey: "items.endpointReports" },
      { to: "/benchmark-templates", icon: Layers, labelKey: "items.benchmarkTemplates" },
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
      {
        to: "/dev/deployments",
        icon: Rocket,
        labelKey: "items.deploymentRecipes",
      },
    ],
  },
];

/** Top-of-rail items rendered ABOVE all groups. Connections is foundational
 * (every playground tab and every benchmark depends on a saved connection),
 * so promoting it out of the bottom utility area keeps it one click away
 * from anywhere in the app. */
export const sidebarPrimaryItems: SidebarItem[] = [
  { to: "/connections", icon: Database, labelKey: "items.connections" },
];

export const sidebarUtilityItems: SidebarItem[] = [
  { to: "/settings", icon: Settings, labelKey: "items.settings" },
];
