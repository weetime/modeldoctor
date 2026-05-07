import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { upsertLlmJudgeProviderSchema, type UpsertLlmJudgeProvider } from "@modeldoctor/contracts";
import { zodResolver } from "@hookform/resolvers/zod";
import { Eye, EyeOff } from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { useLlmJudgeProvider, useTestLlmJudge, useUpsertLlmJudgeProvider } from "./queries";

export function AiDiagnosisSection() {
  const { t } = useTranslation("settings");
  const { t: tc } = useTranslation("common");
  const provider = useLlmJudgeProvider();
  const upsert = useUpsertLlmJudgeProvider();
  const test = useTestLlmJudge();
  const [showKey, setShowKey] = useState(false);

  const form = useForm<UpsertLlmJudgeProvider>({
    mode: "onTouched",
    resolver: zodResolver(upsertLlmJudgeProviderSchema),
    defaultValues: { baseUrl: "", apiKey: "", model: "", enabled: true },
    values: provider.data
      ? { baseUrl: provider.data.baseUrl, apiKey: "", model: provider.data.model, enabled: provider.data.enabled }
      : undefined,
  });

  async function onSave(values: UpsertLlmJudgeProvider) {
    if (!values.apiKey && provider.data) {
      toast.error(t("ai.error.keyRequired"));
      return;
    }
    await upsert.mutateAsync(values);
    toast.success(t("ai.saveSuccess"));
  }

  async function onTest() {
    const v = form.getValues();
    if (!v.baseUrl || !v.apiKey || !v.model) {
      toast.error(t("ai.error.fillBeforeTest"));
      return;
    }
    const r = await test.mutateAsync({ baseUrl: v.baseUrl, apiKey: v.apiKey, model: v.model });
    if (r.ok) toast.success(t("ai.testSuccess", { ms: r.latencyMs }));
    else toast.error(t("ai.testFailed", { error: r.error ?? "unknown" }));
  }

  return (
    <section className="rounded-lg border border-border bg-card p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          {t("ai.title")}
        </h2>
        <div className="flex items-center gap-2">
          <Label htmlFor="ai-enabled" className="text-sm">{t("ai.enabled")}</Label>
          <Switch
            id="ai-enabled"
            checked={form.watch("enabled")}
            onCheckedChange={(v) => form.setValue("enabled", v)}
          />
        </div>
      </div>
      <p className="mb-3 text-xs text-muted-foreground">{t("ai.description")}</p>

      <form className="space-y-3" onSubmit={form.handleSubmit(onSave)}>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <div>
            <Label htmlFor="ai-baseurl">{t("ai.baseUrl")}</Label>
            <Input id="ai-baseurl" placeholder="https://api.deepseek.com/v1" {...form.register("baseUrl")} />
            {form.formState.errors.baseUrl && (
              <div className="mt-1 text-xs text-rose-500">{form.formState.errors.baseUrl.message}</div>
            )}
          </div>
          <div>
            <Label htmlFor="ai-model">{t("ai.model")}</Label>
            <Input id="ai-model" placeholder="deepseek-chat" {...form.register("model")} />
            {form.formState.errors.model && (
              <div className="mt-1 text-xs text-rose-500">{form.formState.errors.model.message}</div>
            )}
          </div>
        </div>
        <div>
          <Label htmlFor="ai-key">{t("ai.apiKey")}</Label>
          <div className="relative">
            <Input
              id="ai-key"
              type={showKey ? "text" : "password"}
              placeholder={provider.data ? "sk-*** (留空保留现值)" : "sk-..."}
              {...form.register("apiKey")}
            />
            <button
              type="button"
              onClick={() => setShowKey((s) => !s)}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground"
              aria-label={showKey ? "hide" : "show"}
            >
              {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
        </div>
        <div className="flex gap-2">
          <Button type="button" variant="outline" onClick={onTest} disabled={test.isPending}>
            {test.isPending ? t("ai.testing") : t("ai.test")}
          </Button>
          <Button type="submit" disabled={upsert.isPending}>
            {upsert.isPending ? t("ai.saving") : tc("actions.save")}
          </Button>
        </div>
      </form>
    </section>
  );
}
