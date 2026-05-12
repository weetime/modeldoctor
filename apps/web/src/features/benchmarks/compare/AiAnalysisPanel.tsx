import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import type { CompareNarrative } from "@modeldoctor/contracts";
import { RefreshCw, Sparkles } from "lucide-react";
import { useTranslation } from "react-i18next";

export interface AiAnalysisPanelProps {
  narrative: CompareNarrative | null;
  onGenerate: () => void;
  canGenerate: boolean;
  isGenerating: boolean;
  errorMessage?: string;
}

export function AiAnalysisPanel({
  narrative,
  onGenerate,
  canGenerate,
  isGenerating,
  errorMessage,
}: AiAnalysisPanelProps) {
  const { t } = useTranslation("benchmarks");

  return (
    <Card className="border-violet-200 dark:border-violet-900">
      <CardHeader className="flex-row items-center justify-between">
        <h3 className="text-sm font-semibold flex items-center gap-1.5">
          <Sparkles className="h-4 w-4 text-violet-500" />
          {t("savedCompare.report.sectionAnalysis")}
        </h3>
        {narrative && canGenerate ? (
          <Button variant="ghost" size="sm" onClick={onGenerate} disabled={isGenerating}>
            <RefreshCw className={`mr-1 h-3 w-3 ${isGenerating ? "animate-spin" : ""}`} />
            {t("savedCompare.detail.regenerate")}
          </Button>
        ) : null}
      </CardHeader>
      <CardContent className="space-y-4">
        {!narrative && !isGenerating ? (
          <div className="space-y-2">
            <div className="text-sm text-muted-foreground">
              {t("savedCompare.report.narrativeMissing")}
            </div>
            <Button onClick={onGenerate} disabled={!canGenerate} className="gap-1.5">
              <Sparkles className="h-4 w-4" /> {t("savedCompare.report.generateButton")}
            </Button>
            {!canGenerate ? (
              <div className="text-xs text-muted-foreground">
                {t("savedCompare.errors.providerMissing")}
              </div>
            ) : null}
          </div>
        ) : null}
        {isGenerating ? (
          <div className="space-y-2">
            <div className="h-3 animate-pulse rounded bg-muted" />
            <div className="h-3 w-3/4 animate-pulse rounded bg-muted" />
            <div className="h-3 w-1/2 animate-pulse rounded bg-muted" />
          </div>
        ) : null}
        {errorMessage ? <div className="text-sm text-rose-600">{errorMessage}</div> : null}
        {narrative ? (
          <div className="space-y-4">
            <section>
              <h4 className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-2">
                {t("savedCompare.report.sectionTldr")}
              </h4>
              <ul className="space-y-2">
                {narrative.tldr.map((row, i) => (
                  <li key={i} className="rounded-md border border-border p-3">
                    <div className="font-medium">{row.headline}</div>
                    <div className="text-sm text-muted-foreground">{row.oneLine}</div>
                  </li>
                ))}
              </ul>
            </section>
            {narrative.analysis.length > 0 ? (
              <section>
                <h4 className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-2">
                  {t("savedCompare.report.sectionAnalysis")}
                </h4>
                <div className="space-y-3">
                  {narrative.analysis.map((row, i) => (
                    <div key={i}>
                      <div className="text-sm font-medium">{row.metricLabel}</div>
                      <div className="text-sm text-muted-foreground">{row.body}</div>
                    </div>
                  ))}
                </div>
              </section>
            ) : null}
            <section>
              <h4 className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-2">
                {t("savedCompare.report.sectionConclusion")}
              </h4>
              <p className="text-sm">{narrative.conclusion.recommendation}</p>
              {narrative.conclusion.caveats.length > 0 ? (
                <ul className="mt-2 list-disc pl-5 text-sm text-muted-foreground">
                  {narrative.conclusion.caveats.map((c, i) => (
                    <li key={i}>{c}</li>
                  ))}
                </ul>
              ) : null}
            </section>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
