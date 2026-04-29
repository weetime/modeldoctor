import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ModalityCategory } from "@modeldoctor/contracts";
import { PanelRightClose, PanelRightOpen } from "lucide-react";
import { type ReactNode, useState } from "react";
import { useTranslation } from "react-i18next";
import { ParamsPanel } from "./ParamsPanel";

export interface PlaygroundShellProps {
  category: ModalityCategory;
  tabs?: Array<{ key: string; label: string }>;
  activeTab?: string;
  onTabChange?: (k: string) => void;
  paramsSlot: ReactNode;
  rightPanelDefaultOpen?: boolean;
  children: ReactNode;
}

export function PlaygroundShell({
  tabs,
  activeTab,
  onTabChange,
  paramsSlot,
  rightPanelDefaultOpen = true,
  children,
}: PlaygroundShellProps) {
  const { t: tc } = useTranslation("common");
  const [panelOpen, setPanelOpen] = useState(rightPanelDefaultOpen);

  return (
    <div className="flex h-[calc(100vh-0px)] min-h-0 flex-col">
      <header className="flex items-center justify-between border-b border-border px-6 py-3">
        <div className="flex items-center gap-1">
          {tabs?.map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => onTabChange?.(tab.key)}
              className={cn(
                "rounded-md px-3 py-1.5 text-sm",
                tab.key === activeTab
                  ? "bg-accent text-foreground"
                  : "text-muted-foreground hover:bg-accent/40 hover:text-foreground",
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setPanelOpen((v) => !v)}
          aria-label={
            panelOpen
              ? tc("sidebar.collapse", { defaultValue: "Collapse" })
              : tc("sidebar.expand", { defaultValue: "Expand" })
          }
        >
          {panelOpen ? (
            <PanelRightClose className="h-4 w-4" />
          ) : (
            <PanelRightOpen className="h-4 w-4" />
          )}
        </Button>
      </header>
      <div className="flex min-h-0 flex-1">
        <main className="flex min-w-0 flex-1 flex-col overflow-hidden">{children}</main>
        <ParamsPanel open={panelOpen}>{paramsSlot}</ParamsPanel>
      </div>
    </div>
  );
}
