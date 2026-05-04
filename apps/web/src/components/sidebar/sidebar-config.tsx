import {
  Boxes,
  Bug,
  CheckCircle2,
  Database,
  History,
  Image as ImageIcon,
  LineChart,
  ListOrdered,
  type LucideIcon,
  MessageSquare,
  Mic,
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
    id: "performance",
    labelKey: "groups.performance",
    items: [{ to: "/runs", icon: History, labelKey: "items.runs" }],
  },
  {
    id: "debug",
    labelKey: "groups.debug",
    items: [
      { to: "/debug", icon: Bug, labelKey: "items.requestDebug" },
      { to: "/e2e", icon: CheckCircle2, labelKey: "items.e2e" },
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
