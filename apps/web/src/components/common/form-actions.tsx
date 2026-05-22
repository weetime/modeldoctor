import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface FormActionsProps {
  onCancel?: () => void;
  /** Localized Cancel label. Required when `onCancel` is set — callers must pass an i18n value, never a hardcoded English string. */
  cancelLabel?: string;
  submitLabel: string;
  /** Disabled state for the submit button (e.g. !formState.isValid) */
  disabled?: boolean;
  /** Pending state from a mutation; renders "…" inside the submit button */
  pending?: boolean;
  className?: string;
  /** Extra leading content (e.g. a destructive Delete button on edit pages) */
  leading?: ReactNode;
}

/**
 * Standard creation/edit form footer: right-aligned Cancel + Submit pair.
 * Used both inside `<form>` (page mode) and inside `<DialogFooter>` (dialog
 * mode). The dialog wrapper provides its own border + padding, so we don't
 * add any here.
 */
export function FormActions({
  onCancel,
  cancelLabel,
  submitLabel,
  disabled,
  pending,
  className,
  leading,
}: FormActionsProps) {
  return (
    <div className={cn("flex justify-end gap-2", className)}>
      {leading}
      {onCancel ? (
        <Button type="button" variant="outline" onClick={onCancel}>
          {cancelLabel}
        </Button>
      ) : null}
      <Button type="submit" disabled={disabled || pending}>
        {pending ? "…" : submitLabel}
      </Button>
    </div>
  );
}
