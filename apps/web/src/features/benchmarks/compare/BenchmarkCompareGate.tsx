import { Navigate, useSearchParams } from "react-router-dom";
import { BenchmarkComparePage } from "./BenchmarkComparePage";

/**
 * Pre-empts BenchmarkComparePage: when the URL has no `?ids=…` (or an
 * empty value), redirect to the default scenario list. The list page
 * is the only legit way to start a comparison; this gate ensures the
 * compare URL never lands on a redundant picker.
 */
export function BenchmarkCompareGate() {
  const [searchParams] = useSearchParams();
  const raw = searchParams.get("ids") ?? "";
  const hasIds = raw.split(",").some((s) => s.trim().length > 0);
  if (!hasIds) return <Navigate to="/benchmarks/inference" replace />;
  return <BenchmarkComparePage />;
}
