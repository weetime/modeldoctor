import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

interface FormSectionProps {
  title?: string;
  description?: string;
  children: ReactNode;
  className?: string;
}

/**
 * Standard creation-form section wrapper — flat layout per #99.
 * Renders an optional small-caps title + description, then fields below.
 * No border / bg / padding: fields sit directly on the page (or dialog)
 * background; sections are separated only by spacing + headings.
 * A subtle bottom divider visually groups each section without nesting cards.
 */
export function FormSection({ title, description, children, className }: FormSectionProps) {
  return (
    <section className={cn("space-y-3 pb-4 last:pb-0", className)}>
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
