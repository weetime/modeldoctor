import { useState } from "react";
import type { SampleFilter } from "@modeldoctor/contracts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useRunSamples } from "../queries";

const FILTERS: SampleFilter[] = [
  "all",
  "regression",
  "improvement",
  "both-pass",
  "both-fail",
];
const FILTER_LABEL: Record<SampleFilter, string> = {
  all: "全部",
  regression: "回归",
  improvement: "改善",
  "both-pass": "都过",
  "both-fail": "都挂",
};

export function SamplesTable({
  runId,
  onOpenSample,
}: {
  runId: string;
  onOpenSample: (sampleId: string) => void;
}) {
  const [filter, setFilter] = useState<SampleFilter>("regression");
  const [page, setPage] = useState(1);
  const { data } = useRunSamples(runId, { filter, page, pageSize: 20 });

  return (
    <div className="space-y-2">
      <div className="flex gap-2 flex-wrap">
        {FILTERS.map((f) => (
          <Button
            key={f}
            variant={f === filter ? "default" : "outline"}
            size="sm"
            onClick={() => {
              setFilter(f);
              setPage(1);
            }}
          >
            {FILTER_LABEL[f]}
          </Button>
        ))}
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-12">#</TableHead>
            <TableHead>A 答案预览</TableHead>
            <TableHead className="w-24">delta</TableHead>
            <TableHead className="w-20">A 通过</TableHead>
            <TableHead className="w-20">B 通过</TableHead>
            <TableHead className="w-32 text-right">操作</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {data?.items.map((s) => (
            <TableRow key={s.id}>
              <TableCell>{s.sampleIdx + 1}</TableCell>
              <TableCell className="truncate max-w-md">
                {s.resultA.call.rawAnswer.slice(0, 80)}
              </TableCell>
              <TableCell>
                <Badge
                  variant={
                    s.delta === "REGRESSION" ? "destructive" : "outline"
                  }
                >
                  {s.delta}
                </Badge>
              </TableCell>
              <TableCell>{s.resultA.judge.passed ? "✓" : "✗"}</TableCell>
              <TableCell>
                {s.resultB ? (s.resultB.judge.passed ? "✓" : "✗") : "—"}
              </TableCell>
              <TableCell className="text-right">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => onOpenSample(s.id)}
                >
                  详情
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {data && data.total > data.pageSize && (
        <div className="flex justify-end gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={page === 1}
            onClick={() => setPage(page - 1)}
          >
            上一页
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={page * data.pageSize >= data.total}
            onClick={() => setPage(page + 1)}
          >
            下一页
          </Button>
        </div>
      )}
    </div>
  );
}
