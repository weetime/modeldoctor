import type { BenchmarkStatus } from "@modeldoctor/contracts";
import { Ban, CheckCircle2, Clock, Loader2, Send, XCircle } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useTranslation } from "react-i18next";

interface StatusVisual {
  icon: LucideIcon;
  /** Tailwind classes applied to the icon. */
  iconClassName: string;
  /** Tailwind classes applied to the label text. */
  textClassName: string;
}

/**
 * Single source of truth for how a BenchmarkStatus is presented in the UI:
 * the icon, the color, and the i18n key for the label all live here so any
 * future status (e.g. "queued") is added in exactly one place.
 *
 * Color choice rationale:
 * - completed → emerald (positive terminal)
 * - failed    → destructive (errors share this hue across the app)
 * - running   → blue + spin (matches RunningSection's Loader2)
 * - submitted → blue (in-flight, server has accepted)
 * - pending   → muted (before submit)
 * - canceled  → muted (terminal but neutral)
 */
export const STATUS_DISPLAY: Record<BenchmarkStatus, StatusVisual> = {
  pending: {
    icon: Clock,
    iconClassName: "text-muted-foreground",
    textClassName: "text-muted-foreground",
  },
  submitted: {
    icon: Send,
    iconClassName: "text-blue-600 dark:text-blue-400",
    textClassName: "text-blue-600 dark:text-blue-400",
  },
  running: {
    icon: Loader2,
    iconClassName: "text-blue-600 dark:text-blue-400 animate-spin",
    textClassName: "text-blue-600 dark:text-blue-400",
  },
  completed: {
    icon: CheckCircle2,
    iconClassName: "text-emerald-600 dark:text-emerald-400",
    textClassName: "text-emerald-600 dark:text-emerald-400",
  },
  failed: {
    icon: XCircle,
    iconClassName: "text-destructive",
    textClassName: "text-destructive",
  },
  canceled: {
    icon: Ban,
    iconClassName: "text-muted-foreground",
    textClassName: "text-muted-foreground",
  },
};

interface StatusBadgeProps {
  status: BenchmarkStatus;
  /** When true, render only the icon (used in tight cells). Defaults to
   * false: icon + label side-by-side. */
  iconOnly?: boolean;
}

export function StatusBadge({ status, iconOnly = false }: StatusBadgeProps) {
  const { t } = useTranslation("benchmarks");
  const v = STATUS_DISPLAY[status];
  const Icon = v.icon;
  const label = t(`status.${status}`);
  return (
    <span
      className={`inline-flex items-center gap-1.5 text-sm ${v.textClassName}`}
      aria-label={label}
    >
      <Icon className={`h-3.5 w-3.5 ${v.iconClassName}`} strokeWidth={1.75} />
      {iconOnly ? null : <span>{label}</span>}
    </span>
  );
}
