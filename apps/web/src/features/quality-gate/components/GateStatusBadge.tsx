import type { GateResult, RunStatus } from "@modeldoctor/contracts";
import { AlertTriangle, Ban, CheckCircle2, Clock, Loader2, XCircle } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useTranslation } from "react-i18next";

interface Visual {
  icon: LucideIcon;
  className: string;
  /** key under quality-gate -> runs.status or runs.gateResult */
  i18n: { ns: "runs.status" | "runs.gateResult"; key: string };
}

const NON_TERMINAL_VISUAL: Partial<Record<RunStatus, Visual>> = {
  PENDING: {
    icon: Clock,
    className: "text-muted-foreground",
    i18n: { ns: "runs.status", key: "pending" },
  },
  RUNNING: {
    icon: Loader2,
    className: "text-blue-600 dark:text-blue-400",
    i18n: { ns: "runs.status", key: "running" },
  },
  CANCELLED: {
    icon: Ban,
    className: "text-muted-foreground",
    i18n: { ns: "runs.status", key: "cancelled" },
  },
  FAILED: {
    icon: XCircle,
    className: "text-destructive",
    i18n: { ns: "runs.status", key: "failed" },
  },
};

const GATE_VISUAL: Record<NonNullable<GateResult>, Visual> = {
  PASSED: {
    icon: CheckCircle2,
    className: "text-emerald-600 dark:text-emerald-400",
    i18n: { ns: "runs.gateResult", key: "passed" },
  },
  WARNING: {
    icon: AlertTriangle,
    className: "text-amber-600 dark:text-amber-400",
    i18n: { ns: "runs.gateResult", key: "warning" },
  },
  FAILED: {
    icon: XCircle,
    className: "text-destructive",
    i18n: { ns: "runs.gateResult", key: "failed" },
  },
};

export function GateStatusBadge({
  status,
  gateResult,
}: {
  status: RunStatus;
  gateResult: GateResult | null;
}) {
  const { t } = useTranslation("quality-gate");

  const v: Visual =
    status === "COMPLETED" && gateResult
      ? GATE_VISUAL[gateResult]
      : (NON_TERMINAL_VISUAL[status] ??
        // COMPLETED without a gateResult: treat as passed.
        GATE_VISUAL.PASSED);

  const Icon = v.icon;
  const label = t(`${v.i18n.ns}.${v.i18n.key}`);
  const spin = v.icon === Loader2 ? " animate-spin" : "";
  return (
    <span className={`inline-flex items-center gap-1.5 text-sm ${v.className}`} aria-label={label}>
      <Icon className={`h-3.5 w-3.5${spin}`} strokeWidth={1.75} />
      <span>{label}</span>
    </span>
  );
}
