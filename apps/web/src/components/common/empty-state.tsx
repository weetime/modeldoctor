import { cn } from "@/lib/utils";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  body?: string;
  actions?: ReactNode;
  className?: string;
}

export function EmptyState({ icon: Icon, title, body, actions, className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border bg-card/40 px-8 py-16 text-center",
        className,
      )}
    >
      <Icon className="h-8 w-8 text-muted-foreground" strokeWidth={1.5} />
      <h2 className="text-base font-semibold tracking-tight">{title}</h2>
      {body ? <p className="max-w-sm text-sm text-muted-foreground">{body}</p> : null}
      {actions ? <div className="mt-2 flex gap-2">{actions}</div> : null}
    </div>
  );
}
