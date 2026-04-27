import { Badge } from "@/components/ui/badge";
import { useTranslation } from "react-i18next";
import type { BenchmarkState } from "@modeldoctor/contracts";

const VARIANT: Record<BenchmarkState, string> = {
  pending: "bg-zinc-100 text-zinc-700 border-zinc-200",
  submitted: "bg-zinc-100 text-zinc-700 border-zinc-200",
  running: "bg-blue-100 text-blue-700 border-blue-200",
  completed: "bg-green-100 text-green-700 border-green-200",
  failed: "bg-red-100 text-red-700 border-red-200",
  canceled: "bg-zinc-100 text-zinc-600 border-zinc-200",
};

export function BenchmarkStateBadge({ state }: { state: BenchmarkState }) {
  const { t } = useTranslation("benchmark");
  return (
    <Badge variant="outline" className={VARIANT[state]}>
      {t(`detail.states.${state}`)}
    </Badge>
  );
}
