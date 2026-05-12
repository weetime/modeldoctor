import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import type { GateConfig } from "@modeldoctor/contracts";
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
import { GateConfigForm } from "./components/GateConfigForm";
import { useCreateRun, useEvaluations } from "./queries";

export function RunCreatePage() {
  const nav = useNavigate();
  const { t } = useTranslation("quality-gate");
  const evaluations = useEvaluations();
  const conns = useConnections();
  const create = useCreateRun();
  const [evaluationId, setEvalId] = useState<string | undefined>();
  const [endpointAId, setA] = useState<string | undefined>();
  const [endpointBId, setB] = useState<string | undefined>();
  const [gate, setGate] = useState<GateConfig>({ passRateMin: 0.9 });

  return (
    <div className="p-6 max-w-3xl space-y-4">
      <h1 className="text-xl font-semibold">{t("runs.form.newTitle")}</h1>

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

      <div className="grid grid-cols-2 gap-3">
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

      <GateConfigForm value={gate} onChange={setGate} dual={!!endpointBId} />

      <Button
        disabled={!evaluationId || !endpointAId}
        onClick={async () => {
          const run = await create.mutateAsync({
            evaluationId: evaluationId!,
            endpointAId: endpointAId!,
            endpointBId,
            gateConfig: gate,
          });
          nav(`/quality-gate/runs/${run.id}`);
        }}
      >
        {t("runs.form.trigger")}
      </Button>
    </div>
  );
}
