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
import type { SampleDelta, SampleFilter } from "@modeldoctor/contracts";
import { Check, Minus, X } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useRunSamples } from "../queries";

function deltaVariant(delta: SampleDelta): "destructive" | "default" | "secondary" | "outline" {
  switch (delta) {
    case "REGRESSION":
      return "destructive";
    case "IMPROVEMENT":
      return "default";
    case "BOTH_PASS":
      return "secondary";
    default:
      return "outline";
  }
}

function PassIcon({ passed }: { passed: boolean }) {
  return passed ? (
    <Check className="h-4 w-4 text-emerald-500" aria-label="pass" />
  ) : (
    <X className="h-4 w-4 text-destructive" aria-label="fail" />
  );
}

const FILTERS: SampleFilter[] = ["all", "regression", "improvement", "both-pass", "both-fail"];

export function SamplesTable({
  runId,
  onOpenSample,
}: {
  runId: string;
  onOpenSample: (sampleId: string) => void;
}) {
  const { t } = useTranslation("quality-gate");
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
            {t(`report.filters.${f}`)}
          </Button>
        ))}
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-12">{t("report.samplesTable.headers.index")}</TableHead>
            <TableHead>{t("report.samplesTable.headers.answerPreview")}</TableHead>
            <TableHead className="w-24">{t("report.samplesTable.headers.delta")}</TableHead>
            <TableHead className="w-20">{t("report.samplesTable.headers.passedA")}</TableHead>
            <TableHead className="w-20">{t("report.samplesTable.headers.passedB")}</TableHead>
            <TableHead className="w-32 text-right">
              {t("report.samplesTable.headers.actions")}
            </TableHead>
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
                <Badge variant={deltaVariant(s.delta)}>{t(`report.delta.${s.delta}`)}</Badge>
              </TableCell>
              <TableCell>
                <PassIcon passed={s.resultA.judge.passed} />
              </TableCell>
              <TableCell>
                {s.resultB ? (
                  <PassIcon passed={s.resultB.judge.passed} />
                ) : (
                  <Minus className="h-4 w-4 text-muted-foreground" aria-hidden />
                )}
              </TableCell>
              <TableCell className="text-right">
                <Button size="sm" variant="ghost" onClick={() => onOpenSample(s.id)}>
                  {t("report.sampleDrawer.detail")}
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
            {t("report.samplesTable.prevPage")}
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={page * data.pageSize >= data.total}
            onClick={() => setPage(page + 1)}
          >
            {t("report.samplesTable.nextPage")}
          </Button>
        </div>
      )}
    </div>
  );
}
