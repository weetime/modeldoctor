import { FormSection } from "@/components/common/form-section";
import { PageHeader } from "@/components/common/page-header";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useConnections } from "@/features/connections/queries";
import type { GateConfig } from "@modeldoctor/contracts";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { GateConfigForm } from "./components/GateConfigForm";
import { useCreateRun, useEvaluations } from "./queries";

export function RunCreatePage() {
  const nav = useNavigate();
  const { t } = useTranslation("quality-gate");
  const { t: tSidebar } = useTranslation("sidebar");
  const { t: tCommon } = useTranslation("common");
  const evaluations = useEvaluations();
  const conns = useConnections();
  const create = useCreateRun();
  const [evaluationId, setEvalId] = useState<string | undefined>();
  const [endpointAId, setA] = useState<string | undefined>();
  const [endpointBId, setB] = useState<string | undefined>();
  const [gate, setGate] = useState<GateConfig>({ passRateMin: 0.9 });

  async function handleTrigger() {
    if (!evaluationId || !endpointAId) return;
    try {
      const run = await create.mutateAsync({
        evaluationId,
        endpointAId,
        endpointBId,
        gateConfig: gate,
      });
      nav(`/quality-gate/runs/${run.id}`);
    } catch (err) {
      toast.error(t("runs.form.saveError", { message: (err as Error).message }));
    }
  }

  const breadcrumbs = [
    { label: tSidebar("groups.qualityGate") },
    { label: tSidebar("items.qualityGateRuns"), to: "/quality-gate/runs" },
    { label: tCommon("actions.create") },
  ];

  return (
    <>
      <PageHeader
        title={t("runs.form.newTitle")}
        subtitle={t("runs.form.newSubtitle")}
        breadcrumbs={breadcrumbs}
      />
      <div className="px-8 py-6 space-y-6">
        <FormSection title={t("runs.form.sectionTarget")}>
          <div className="space-y-1">
            <Label>{t("runs.form.evaluationLabel")}</Label>
            <Select value={evaluationId} onValueChange={setEvalId}>
              <SelectTrigger>
                <SelectValue placeholder={t("runs.form.evaluationPlaceholder")} />
              </SelectTrigger>
              <SelectContent>
                {evaluations.data?.map((e) => (
                  <SelectItem key={e.id} value={e.id}>
                    {e.name} ({e.totalSamples})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="space-y-1">
              <Label>{t("runs.form.endpointA")}</Label>
              <Select value={endpointAId} onValueChange={setA}>
                <SelectTrigger>
                  <SelectValue placeholder={t("runs.form.endpointPlaceholder")} />
                </SelectTrigger>
                <SelectContent>
                  {conns.data?.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>{t("runs.form.endpointB")}</Label>
              <Select
                value={endpointBId ?? "__none__"}
                onValueChange={(v) => setB(v === "__none__" ? undefined : v)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">{t("runs.form.endpointBNone")}</SelectItem>
                  {conns.data
                    ?.filter((c) => c.id !== endpointAId)
                    .map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </FormSection>

        <FormSection title={t("runs.form.sectionGate")}>
          <GateConfigForm value={gate} onChange={setGate} dual={!!endpointBId} />
        </FormSection>

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={() => nav("/quality-gate/runs")}>
            {t("evaluations.form.cancel")}
          </Button>
          <Button
            disabled={!evaluationId || !endpointAId || create.isPending}
            onClick={handleTrigger}
          >
            {create.isPending ? "…" : t("runs.form.trigger")}
          </Button>
        </div>
      </div>
    </>
  );
}
