import { PageHeader } from "@/components/common/page-header";
import { useParams } from "react-router-dom";

export function BenchmarkDetailPage() {
  const { id } = useParams<{ id: string }>();
  return (
    <>
      <PageHeader title="Benchmark" />
      <div className="px-8 py-6 text-sm text-muted-foreground">
        Detail for {id} — implementation arrives in Task 5.
      </div>
    </>
  );
}
