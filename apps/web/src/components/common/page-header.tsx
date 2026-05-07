import type { ReactNode } from "react";

interface PageHeaderProps {
  title: string;
  subtitle?: string;
  rightSlot?: ReactNode;
}

export function PageHeader({ title, subtitle, rightSlot }: PageHeaderProps) {
  return (
    <header className="border-b border-border bg-background">
      <div className="flex items-start justify-between gap-4 px-8 py-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          {subtitle ? <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p> : null}
        </div>
        <div className="flex items-center gap-2">{rightSlot}</div>
      </div>
    </header>
  );
}
