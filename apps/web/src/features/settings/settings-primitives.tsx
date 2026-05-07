import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

interface SettingSectionProps {
  title: string;
  description?: string;
  destructive?: boolean;
  children: ReactNode;
}

/**
 * One settings section: heading + description on top, child rows below.
 * Sibling sections inside a `divide-y` parent get a hairline separator
 * automatically; padding here keeps spacing consistent.
 */
export function SettingSection({ title, description, destructive, children }: SettingSectionProps) {
  return (
    <section className="py-6 first:pt-0 last:pb-0">
      <header className="mb-3">
        <h2
          className={cn(
            "text-base font-semibold tracking-tight",
            destructive && "text-destructive",
          )}
        >
          {title}
        </h2>
        {description ? <p className="mt-1 text-sm text-muted-foreground">{description}</p> : null}
      </header>
      <div>{children}</div>
    </section>
  );
}

interface SettingRowProps {
  label: string;
  description?: string;
  htmlFor?: string;
  control: ReactNode;
}

/**
 * A single settings row.
 *
 * Two-column layout on `md+`:
 *   left  ~240px  → label + helper text
 *   right 1fr     → control (callers cap input width via `max-w-md` etc.)
 *
 * Stacks vertically on mobile.
 */
export function SettingRow({ label, description, htmlFor, control }: SettingRowProps) {
  return (
    <div className="grid grid-cols-1 items-start gap-1.5 py-2.5 md:grid-cols-[180px_minmax(0,1fr)] md:gap-6">
      <div className="md:pt-1.5">
        <Label htmlFor={htmlFor} className="text-sm font-medium">
          {label}
        </Label>
        {description ? <p className="mt-1 text-xs text-muted-foreground">{description}</p> : null}
      </div>
      <div>{control}</div>
    </div>
  );
}

interface DangerZoneCardProps {
  children: ReactNode;
}

/** Red-outlined container that hosts a stack of `DangerZoneRow`s. */
export function DangerZoneCard({ children }: DangerZoneCardProps) {
  return (
    <div className="overflow-hidden rounded-md border border-destructive/40 bg-destructive/[0.025] divide-y divide-destructive/30">
      {children}
    </div>
  );
}

interface DangerZoneRowProps {
  title: string;
  description?: string;
  action: ReactNode;
}

/**
 * One destructive action: bold title + description on the left, action button
 * on the right. Mirrors GitHub's "Danger Zone" pattern.
 */
export function DangerZoneRow({ title, description, action }: DangerZoneRowProps) {
  return (
    <div className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <h3 className="text-sm font-semibold">{title}</h3>
        {description ? <p className="mt-1 text-sm text-muted-foreground">{description}</p> : null}
      </div>
      <div className="shrink-0">{action}</div>
    </div>
  );
}
