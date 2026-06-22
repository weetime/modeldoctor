import type { EndpointReportRange, NarrativeFinding } from "@modeldoctor/contracts";
import { formatDistanceToNow } from "date-fns";
import { RefreshCw, Sparkles } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { useLlmJudgeProvider } from "@/features/llm-judge-providers/queries";
import { useSynthesize } from "./queries";

interface Props {
  connectionId: string;
  profileSlug: string;
  range: EndpointReportRange;
  runIds: string[];
}

const SEV_BADGE = {
  critical: { emoji: "🔴", cls: "border-rose-500" },
  warning: { emoji: "🟡", cls: "border-amber-500" },
  info: { emoji: "🔵", cls: "border-blue-500" },
} as const;

export function AiDiagnosisCard({ connectionId, profileSlug, range, runIds }: Props) {
  const { t, i18n } = useTranslation("insights");
  const provider = useLlmJudgeProvider();
  const synth = useSynthesize(connectionId);
  const [latest, setLatest] = useState<{
    findings: NarrativeFinding[];
    generatedAt: string;
    fromCache: boolean;
  } | null>(null);

  async function generate() {
    try {
      const locale = i18n.language === "en-US" ? "en-US" : "zh-CN";
      const r = await synth.mutateAsync({ profileSlug, range, runIds, locale });
      setLatest({ findings: r.findings, generatedAt: r.generatedAt, fromCache: r.fromCache });
    } catch {
      // mutation error state shown below
    }
  }

  if (provider.isLoading) {
    return (
      <Card>
        <CardContent className="p-6 text-sm text-muted-foreground">…</CardContent>
      </Card>
    );
  }

  if (!provider.data) {
    return (
      <Card>
        <CardHeader>
          <h3 className="text-sm font-semibold">{t("detail.ai.title")}</h3>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="text-sm text-muted-foreground">{t("detail.ai.providerMissing")}</div>
          <Button asChild variant="outline" size="sm">
            <Link to="/settings">{t("detail.ai.goToSettings")}</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (!provider.data.enabled) {
    return (
      <Card>
        <CardHeader>
          <h3 className="text-sm font-semibold">{t("detail.ai.title")}</h3>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          {t("detail.ai.providerDisabled")}
        </CardContent>
      </Card>
    );
  }

  if (runIds.length === 0) {
    return null; // no point synthesizing zero data
  }

  return (
    <Card className="border-violet-200 dark:border-violet-900">
      <CardHeader className="flex-row items-center justify-between">
        <h3 className="text-sm font-semibold flex items-center gap-1.5">
          <Sparkles className="h-4 w-4 text-violet-500" />
          {t("detail.ai.title")}
        </h3>
        {latest && (
          <Button variant="ghost" size="sm" onClick={generate} disabled={synth.isPending}>
            <RefreshCw className={`mr-1 h-3 w-3 ${synth.isPending ? "animate-spin" : ""}`} />
            {t("detail.ai.refresh")}
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        {!latest && !synth.isPending && (
          <Button onClick={generate} className="gap-1.5">
            <Sparkles className="h-4 w-4" />
            {t("detail.ai.generate")}
          </Button>
        )}
        {synth.isPending && (
          <div className="space-y-2">
            <div className="text-sm text-muted-foreground">{t("detail.ai.generating")}</div>
            <div className="h-3 animate-pulse rounded bg-muted" />
            <div className="h-3 w-3/4 animate-pulse rounded bg-muted" />
            <div className="h-3 w-1/2 animate-pulse rounded bg-muted" />
          </div>
        )}
        {synth.error && !synth.isPending && (
          <div className="text-sm text-rose-600 dark:text-rose-400">{synth.error.message}</div>
        )}
        {latest?.findings.map((f, i) => {
          const sev = SEV_BADGE[f.severity];
          return (
            <div key={i} className={`rounded-md border-l-[3px] bg-card px-3 py-2 ${sev.cls}`}>
              <div className="font-medium text-sm">
                {sev.emoji} {f.title}
              </div>
              <div className="mt-1 text-sm text-muted-foreground">{f.rootCause}</div>
              <ul className="mt-1 list-disc pl-5 text-sm">
                {f.recommendations.map((rec, j) => (
                  <li key={j}>{rec}</li>
                ))}
              </ul>
            </div>
          );
        })}
        {latest && (
          <div className="text-xs text-muted-foreground">
            {t("detail.ai.lastGenerated", {
              when: formatDistanceToNow(new Date(latest.generatedAt), { addSuffix: true }),
            })}
            {latest.fromCache && ` · ${t("detail.ai.fromCache")}`}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
