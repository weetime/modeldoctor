import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

interface ParamsPanelProps {
  open: boolean;
  children: ReactNode;
}

export function ParamsPanel({ open, children }: ParamsPanelProps) {
  if (!open) return null;
  return (
    <aside
      className={cn("w-80 shrink-0 overflow-y-auto border-l border-border bg-card", "px-4 py-4")}
    >
      {children}
    </aside>
  );
}
