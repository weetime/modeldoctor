import { ThemeToggle } from "@/components/common/theme-toggle";
import type { ReactNode } from "react";

interface PageHeaderProps {
  title: string;
  subtitle?: string;
  rightSlot?: ReactNode;
  /** Theme switching now lives in the left sidebar (above 设置), so the
   * page-header toggle is OFF by default. Pass `showThemeToggle` only on
   * pages that genuinely need a duplicate (none currently). */
  showThemeToggle?: boolean;
}

export function PageHeader({
  title,
  subtitle,
  rightSlot,
  showThemeToggle = false,
}: PageHeaderProps) {
  return (
    <header className="border-b border-border bg-background">
      <div className="flex items-start justify-between gap-4 px-8 py-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          {subtitle ? <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p> : null}
        </div>
        <div className="flex items-center gap-2">
          {rightSlot}
          {showThemeToggle ? <ThemeToggle /> : null}
        </div>
      </div>
    </header>
  );
}
