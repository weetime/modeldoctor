import { ChevronRight } from "lucide-react";
import { Fragment, type ReactNode } from "react";
import { Link } from "react-router-dom";

export interface BreadcrumbItem {
  label: string;
  /** When omitted, the crumb renders as plain muted text (no nav). The last
   * crumb (current page) should always omit `to`. */
  to?: string;
}

interface PageHeaderProps {
  title: string;
  subtitle?: string;
  rightSlot?: ReactNode;
  /** Section › list › current. Section is typically passed without `to`
   * (it's a grouping label, not a routable page). The final entry must
   * always omit `to` because it represents the current page. */
  breadcrumbs?: BreadcrumbItem[];
}

export function PageHeader({ title, subtitle, rightSlot, breadcrumbs }: PageHeaderProps) {
  return (
    <header className="border-b border-border bg-background">
      <div className="flex items-start justify-between gap-4 px-8 py-6">
        <div className="min-w-0">
          {breadcrumbs && breadcrumbs.length > 0 && (
            <nav
              aria-label="Breadcrumb"
              className="mb-2 flex flex-wrap items-center gap-1 text-xs text-muted-foreground"
            >
              {breadcrumbs.map((crumb, idx) => {
                const isLast = idx === breadcrumbs.length - 1;
                return (
                  <Fragment key={`${crumb.label}-${idx}`}>
                    {idx > 0 && (
                      <ChevronRight className="h-3 w-3 shrink-0 opacity-60" aria-hidden />
                    )}
                    {crumb.to && !isLast ? (
                      <Link to={crumb.to} className="transition-colors hover:text-foreground">
                        {crumb.label}
                      </Link>
                    ) : (
                      <span
                        aria-current={isLast ? "page" : undefined}
                        className={isLast ? "text-foreground/80" : undefined}
                      >
                        {crumb.label}
                      </span>
                    )}
                  </Fragment>
                );
              })}
            </nav>
          )}
          <h1 className="truncate text-2xl font-semibold tracking-tight">{title}</h1>
          {subtitle ? <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p> : null}
        </div>
        <div className="flex items-center gap-2">{rightSlot}</div>
      </div>
    </header>
  );
}
