import {
  AUTOMATION_STEPS,
  type AutomationSchedule,
  type AutomationStep,
  DEFAULT_REGRESSION_THRESHOLDS,
  type DiscoveredModelPublic,
} from "@modeldoctor/contracts";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { FormActions } from "@/components/common/form-actions";
import { FormSection } from "@/components/common/form-section";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Sheet, SheetContent, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { useTemplates } from "@/features/benchmark-templates/queries";
import { useEvaluations } from "@/features/quality-gate/queries";
import { useUpdateDiscoveredModel } from "./queries";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  model: DiscoveredModelPublic;
}

export function AutomationSheet({ open, onOpenChange, model }: Props) {
  const { t } = useTranslation("deployment-gate");
  const { t: tCommon } = useTranslation("common");
  const update = useUpdateDiscoveredModel(model.id);
  const evaluations = useEvaluations();
  const templates = useTemplates();

  const [enabled, setEnabled] = useState(model.automationEnabled);
  const [steps, setSteps] = useState<AutomationStep[]>(model.steps);
  const [evaluationId, setEvaluationId] = useState(model.evaluationId ?? "");
  const [passRateMin, setPassRateMin] = useState(model.gateConfig?.passRateMin ?? 0.9);
  const [templateId, setTemplateId] = useState(model.benchmarkTemplateId ?? "");
  const [schedule, setSchedule] = useState<AutomationSchedule>(model.schedule);
  const [th, setTh] = useState(model.regressionThresholds ?? DEFAULT_REGRESSION_THRESHOLDS);

  useEffect(() => {
    if (!open) return;
    setEnabled(model.automationEnabled);
    setSteps(model.steps);
    setEvaluationId(model.evaluationId ?? "");
    setPassRateMin(model.gateConfig?.passRateMin ?? 0.9);
    setTemplateId(model.benchmarkTemplateId ?? "");
    setSchedule(model.schedule);
    setTh(model.regressionThresholds ?? DEFAULT_REGRESSION_THRESHOLDS);
  }, [open, model]);

  function toggleStep(s: AutomationStep, on: boolean) {
    setSteps((prev) =>
      on
        ? AUTOMATION_STEPS.filter((x) => x === s || prev.includes(x))
        : prev.filter((x) => x !== s),
    );
  }

  async function save() {
    try {
      await update.mutateAsync({
        automationEnabled: enabled,
        steps,
        evaluationId: evaluationId || null,
        gateConfig: steps.includes("quality_gate") ? { passRateMin } : null,
        benchmarkTemplateId: templateId || null,
        schedule,
        regressionThresholds: th,
      });
      toast.success(t("automation.saved"));
      onOpenChange(false);
    } catch (e) {
      toast.error((e as Error).message || tCommon("errors.unknown"));
    }
  }

  const templateList = templates.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-[520px] sm:max-w-[520px] overflow-y-auto">
        <SheetHeader>
          <SheetTitle>{t("automation.title")}</SheetTitle>
        </SheetHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <div className="mt-6 space-y-6">
            <div className="flex items-center justify-between">
              <Label>{t("automation.enabled")}</Label>
              <Switch checked={enabled} onCheckedChange={setEnabled} />
            </div>
            <FormSection title={t("automation.steps")}>
              {AUTOMATION_STEPS.map((s) => (
                <div key={s} className="flex items-center gap-2">
                  <Checkbox
                    id={`step-${s}`}
                    checked={steps.includes(s)}
                    onCheckedChange={(v) => toggleStep(s, v === true)}
                  />
                  <Label htmlFor={`step-${s}`}>{t(`detail.steps.${s}`)}</Label>
                </div>
              ))}
            </FormSection>
            {steps.includes("quality_gate") && (
              <FormSection title={t("automation.evaluation")}>
                <Select value={evaluationId} onValueChange={setEvaluationId}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(evaluations.data ?? []).map((e) => (
                      <SelectItem key={e.id} value={e.id}>
                        {e.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Label>{t("automation.passRateMin")}</Label>
                <Input
                  type="number"
                  min={0}
                  max={1}
                  step={0.05}
                  value={passRateMin}
                  onChange={(e) => setPassRateMin(Number(e.target.value))}
                />
              </FormSection>
            )}
            {steps.includes("benchmark") && (
              <FormSection title={t("automation.template")}>
                <Select value={templateId} onValueChange={setTemplateId}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {templateList.map((tpl) => (
                      <SelectItem key={tpl.id} value={tpl.id}>
                        {tpl.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Label>{t("automation.schedule")}</Label>
                <Select
                  value={schedule}
                  onValueChange={(v) => setSchedule(v as AutomationSchedule)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(["off", "daily", "weekly"] as const).map((s) => (
                      <SelectItem key={s} value={s}>
                        {t(`automation.scheduleOptions.${s}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Label>{t("automation.thresholds")}</Label>
                <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                  <div>
                    <Label className="text-xs">{t("automation.tpsDrop")}</Label>
                    <Input
                      type="number"
                      min={0}
                      value={th.outputTokensPerSecDropPct}
                      onChange={(e) =>
                        setTh({ ...th, outputTokensPerSecDropPct: Number(e.target.value) })
                      }
                    />
                  </div>
                  <div>
                    <Label className="text-xs">{t("automation.ttftRise")}</Label>
                    <Input
                      type="number"
                      min={0}
                      value={th.ttftP95RisePct}
                      onChange={(e) => setTh({ ...th, ttftP95RisePct: Number(e.target.value) })}
                    />
                  </div>
                  <div>
                    <Label className="text-xs">{t("automation.itlRise")}</Label>
                    <Input
                      type="number"
                      min={0}
                      value={th.itlP95RisePct}
                      onChange={(e) => setTh({ ...th, itlP95RisePct: Number(e.target.value) })}
                    />
                  </div>
                </div>
              </FormSection>
            )}
          </div>
          <SheetFooter className="pt-6">
            <FormActions
              onCancel={() => onOpenChange(false)}
              cancelLabel={tCommon("actions.cancel")}
              submitLabel={tCommon("actions.save")}
              pending={update.isPending}
              disabled={steps.length === 0}
            />
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}
