import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ModalityCategory } from "@modeldoctor/contracts";
import { Code2, PanelRightClose, PanelRightOpen } from "lucide-react";
import { type ReactNode, useState } from "react";
import { useTranslation } from "react-i18next";
import { ParamsPanel } from "./ParamsPanel";
import { ViewCodeDialog } from "./ViewCodeDialog";
import type { CodeSnippets } from "./code-snippets/chat";

export interface PlaygroundShellProps {
  category: ModalityCategory;
  tabs?: Array<{ key: string; label: string }>;
  activeTab?: string;
  onTabChange?: (k: string) => void;
  viewCodeSnippets?: CodeSnippets | null;
  historySlot?: ReactNode;
  paramsSlot: ReactNode;
  rightPanelDefaultOpen?: boolean;
  children: ReactNode;
}

export function PlaygroundShell({
  tabs,
  activeTab,
  onTabChange,
  viewCodeSnippets,
  historySlot,
  paramsSlot,
  rightPanelDefaultOpen = true,
  children,
}: PlaygroundShellProps) {
  const { t: tc } = useTranslation("common");
  const { t } = useTranslation("playground");
  const [panelOpen, setPanelOpen] = useState(rightPanelDefaultOpen);
  const [viewCodeOpen, setViewCodeOpen] = useState(false);

  return (
    <div className="flex h-screen min-h-0 flex-col">
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
        <div className="flex items-center gap-2">
          {historySlot}
          {viewCodeSnippets ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setViewCodeOpen(true)}
              aria-label={t("viewCode.title")}
            >
              <Code2 className="mr-1 h-4 w-4" />
              {t("viewCode.title")}
            </Button>
          ) : null}
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
        </div>
      </header>
      <div className="flex min-h-0 flex-1">
        <main className="flex min-w-0 flex-1 flex-col overflow-hidden">{children}</main>
        <ParamsPanel open={panelOpen}>{paramsSlot}</ParamsPanel>
      </div>
      {viewCodeSnippets ? (
        <ViewCodeDialog
          open={viewCodeOpen}
          onOpenChange={setViewCodeOpen}
          snippets={viewCodeSnippets}
        />
      ) : null}
    </div>
  );
}
