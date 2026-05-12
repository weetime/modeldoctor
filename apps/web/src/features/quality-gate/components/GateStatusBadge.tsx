import type { GateResult, RunStatus } from "@modeldoctor/contracts";
import { Badge } from "@/components/ui/badge";

export function GateStatusBadge({
  status,
  gateResult,
}: {
  status: RunStatus;
  gateResult: GateResult | null;
}) {
  if (status === "PENDING") return <Badge variant="outline">等待中</Badge>;
  if (status === "RUNNING") return <Badge variant="default">运行中</Badge>;
  if (status === "CANCELLED") return <Badge variant="outline">已取消</Badge>;
  if (status === "FAILED") return <Badge variant="destructive">失败</Badge>;
  if (gateResult === "PASSED")
    return <Badge className="bg-emerald-600 hover:bg-emerald-700 text-white border-transparent">通过</Badge>;
  if (gateResult === "WARNING") return <Badge variant="warning">警告</Badge>;
  return <Badge variant="destructive">未通过</Badge>;
}
