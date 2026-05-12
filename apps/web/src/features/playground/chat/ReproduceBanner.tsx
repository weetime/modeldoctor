import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Link } from "react-router-dom";

export function ReproduceBanner({
  runId,
  sampleId,
  expected,
}: {
  runId: string;
  sampleId: string;
  expected: string;
}) {
  return (
    <Alert>
      <AlertTitle>复现自评测 · 样本 #{sampleId.slice(-6)}</AlertTitle>
      <AlertDescription>
        期望：{expected.slice(0, 120)}
        {expected.length > 120 ? "…" : ""}
        {" · "}
        <Link className="underline" to={`/quality-gate/runs/${runId}`}>
          返回评测报告
        </Link>
      </AlertDescription>
    </Alert>
  );
}
