import { Minus, TrendingDown, TrendingUp } from "lucide-react";
import { cn } from "@/lib/utils";
import type { VerdictKind } from "./metrics";
import type { Verdict } from "./verdict";

export interface VerdictBadgeProps {
  verdict: Verdict;
  // verdictKind decides which icon direction means "regressed" vs "improved".
  // For latency/errorRate: up = regressed. For throughput: up = improved.
  verdictKind: VerdictKind;
  deltaText: string;
}

function iconFor(verdict: Verdict, kind: VerdictKind) {
  if (verdict === "unchanged") return Minus;
  // Higher = worse for latency/errorRate; higher = better for throughput.
  const upIsBad = kind === "latency" || kind === "errorRate";
  if (verdict === "regressed") return upIsBad ? TrendingUp : TrendingDown;
  return upIsBad ? TrendingDown : TrendingUp;
}

const COLOR_CLASSES: Record<Verdict, string> = {
  regressed: "text-destructive",
  improved: "text-green-700 dark:text-green-400",
  unchanged: "text-muted-foreground",
};

export function VerdictBadge({ verdict, verdictKind, deltaText }: VerdictBadgeProps) {
  const Icon = iconFor(verdict, verdictKind);
  return (
    <span
      className={cn("inline-flex items-center gap-1 text-xs tabular-nums", COLOR_CLASSES[verdict])}
    >
      <Icon className="h-3 w-3" aria-hidden="true" />
      {deltaText}
    </span>
  );
}
