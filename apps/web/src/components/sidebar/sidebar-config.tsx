import {
  Activity,
  AlertTriangle,
  AudioWaveform,
  BarChart3,
  Bot,
  Boxes,
  Bug,
  CheckCircle2,
  Database,
  FileText,
  Gauge,
  Image as ImageIcon,
  Layers,
  LineChart,
  ListOrdered,
  type LucideIcon,
  MessageSquare,
  Mic,
  Network,
  Plug,
  Rocket,
  Settings,
  ShieldCheck,
  Wrench,
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
      { to: "/playground/agent", icon: MessageSquare, labelKey: "items.playgroundChat" },
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
      {
        to: "/benchmarks/lb-strategy",
        icon: Layers,
        labelKey: "items.benchmarkPrefixCache",
      },
      {
        to: "/benchmarks/engine-kv-cache",
        icon: Database,
        labelKey: "items.benchmarkKvCacheStress",
      },
      { to: "/benchmarks/agent", icon: Bot, labelKey: "items.benchmarkAgent" },
      { to: "/benchmarks/omni", icon: AudioWaveform, labelKey: "items.benchmarkOmni" },
      { to: "/benchmarks/reports", icon: BarChart3, labelKey: "items.endpointReports" },
      {
        to: "/benchmarks/compare/saved",
        icon: FileText,
        labelKey: "items.compareReports",
      },
      { to: "/benchmark-templates", icon: Layers, labelKey: "items.benchmarkTemplates" },
    ],
  },
  {
    id: "quality-gate",
    labelKey: "groups.qualityGate",
    items: [
      {
        to: "/quality-gate/evaluations",
        icon: ShieldCheck,
        labelKey: "items.qualityGateEvaluations",
      },
      { to: "/quality-gate/runs", icon: CheckCircle2, labelKey: "items.qualityGateRuns" },
    ],
  },
  {
    id: "diagnostics",
    labelKey: "groups.diagnostics",
    items: [
      { to: "/alerts", icon: AlertTriangle, labelKey: "items.alerts" },
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
  { to: "/mcp-servers", icon: Plug, labelKey: "items.mcpServers" },
  { to: "/skills", icon: Wrench, labelKey: "items.skills" },
];

export const sidebarUtilityItems: SidebarItem[] = [
  { to: "/settings", icon: Settings, labelKey: "items.settings" },
];
