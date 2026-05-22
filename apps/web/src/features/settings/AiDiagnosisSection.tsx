import { zodResolver } from "@hookform/resolvers/zod";
import { type UpsertLlmJudgeProvider, upsertLlmJudgeProviderSchema } from "@modeldoctor/contracts";
import { Eye, EyeOff } from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { useLlmJudgeProvider, useTestLlmJudge, useUpsertLlmJudgeProvider } from "./queries";
import { SettingRow } from "./settings-primitives";

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
      ? {
          baseUrl: provider.data.baseUrl,
          apiKey: "",
          model: provider.data.model,
          enabled: provider.data.enabled,
        }
      : undefined,
  });

  async function onSave(values: UpsertLlmJudgeProvider) {
    // First-time create requires a key. Updates may omit it (server reuses saved cipher).
    if (!values.apiKey && !provider.data) {
      toast.error(t("ai.error.keyRequired"));
      return;
    }
    // Empty string → omit so the schema's optional() and the server's reuse path both kick in.
    const payload: UpsertLlmJudgeProvider = {
      baseUrl: values.baseUrl,
      model: values.model,
      enabled: values.enabled,
      ...(values.apiKey ? { apiKey: values.apiKey } : {}),
    };
    await upsert.mutateAsync(payload);
    toast.success(t("ai.saveSuccess"));
  }

  async function onTest() {
    const v = form.getValues();
    // Need baseUrl + model always. apiKey may be omitted iff a saved provider exists.
    if (!v.baseUrl || !v.model || (!v.apiKey && !provider.data)) {
      toast.error(t("ai.error.fillBeforeTest"));
      return;
    }
    const r = await test.mutateAsync({
      baseUrl: v.baseUrl,
      model: v.model,
      ...(v.apiKey ? { apiKey: v.apiKey } : {}),
    });
    if (r.ok) toast.success(t("ai.testSuccess", { ms: r.latencyMs }));
    else toast.error(t("ai.testFailed", { error: r.error ?? "unknown" }));
  }

  return (
    <form className="space-y-1" onSubmit={form.handleSubmit(onSave)}>
      <SettingRow
        label={t("ai.enabled")}
        htmlFor="ai-enabled"
        control={
          <Switch
            id="ai-enabled"
            checked={form.watch("enabled")}
            onCheckedChange={(v) => form.setValue("enabled", v)}
          />
        }
      />
      <SettingRow
        label={t("ai.baseUrl")}
        htmlFor="ai-baseurl"
        control={
          <div className="max-w-md">
            <Input
              id="ai-baseurl"
              placeholder="https://api.deepseek.com/v1"
              {...form.register("baseUrl")}
            />
            {form.formState.errors.baseUrl && (
              <div className="mt-1 text-xs text-rose-500">
                {form.formState.errors.baseUrl.message}
              </div>
            )}
          </div>
        }
      />
      <SettingRow
        label={t("ai.model")}
        htmlFor="ai-model"
        control={
          <div className="max-w-md">
            <Input id="ai-model" placeholder="deepseek-chat" {...form.register("model")} />
            {form.formState.errors.model && (
              <div className="mt-1 text-xs text-rose-500">
                {form.formState.errors.model.message}
              </div>
            )}
          </div>
        }
      />
      <SettingRow
        label={t("ai.apiKey")}
        htmlFor="ai-key"
        control={
          <div className="relative max-w-md">
            <Input
              id="ai-key"
              type={showKey ? "text" : "password"}
              placeholder={provider.data ? t("ai.keyPlaceholderExisting") : "sk-..."}
              {...form.register("apiKey")}
            />
            <button
              type="button"
              onClick={() => setShowKey((s) => !s)}
              disabled={!form.watch("apiKey")}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground disabled:cursor-not-allowed disabled:opacity-40"
              aria-label={showKey ? "hide" : "show"}
              title={
                form.watch("apiKey")
                  ? showKey
                    ? t("ai.hideKey")
                    : t("ai.showKey")
                  : provider.data
                    ? t("ai.savedKeyNotRevealable")
                    : t("ai.keyEmpty")
              }
            >
              {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
        }
      />
      <div className="flex gap-2 pt-2 md:pl-[204px]">
        <Button type="button" variant="outline" onClick={onTest} disabled={test.isPending}>
          {test.isPending ? t("ai.testing") : t("ai.test")}
        </Button>
        <Button type="submit" disabled={upsert.isPending}>
          {upsert.isPending ? t("ai.saving") : tc("actions.save")}
        </Button>
      </div>
    </form>
  );
}
