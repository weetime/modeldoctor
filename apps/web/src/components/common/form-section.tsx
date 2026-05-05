import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

interface FormSectionProps {
  title?: string;
  description?: string;
  children: ReactNode;
  className?: string;
}

/**
 * Standard creation-form section wrapper. Renders a bordered card with an
 * optional small-caps title + description, then form fields below. Used by
 * both page-style (multi-section) and dialog-style (typically single section)
 * creation forms.
 */
export function FormSection({ title, description, children, className }: FormSectionProps) {
  return (
    <section className={cn("rounded-lg border border-border bg-card p-4 space-y-3", className)}>
      {title ? (
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          {title}
        </h2>
      ) : null}
      {description ? <p className="text-xs text-muted-foreground">{description}</p> : null}
      {children}
    </section>
  );
}
