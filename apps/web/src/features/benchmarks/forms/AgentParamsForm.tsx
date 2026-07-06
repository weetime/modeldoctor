import type { Tau3Domain } from "@modeldoctor/tool-adapters/schemas";
import { useId } from "react";
import { useFormContext, useWatch } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { Checkbox } from "@/components/ui/checkbox";
import {
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useLlmJudgeProviders } from "@/features/llm-judge-providers/queries";
import { numberField } from "./_shared/numberField";

const DOMAINS: Tau3Domain[] = ["airline", "retail", "telecom"];

type Tier = "smoke" | "standard" | "full";

/**
 * Mirrors the three official templates seeded in apps/api/prisma/seed.ts
 * (tpl_official_agent_{smoke,standard,full}) — domains / maxSteps /
 * maxConcurrency / gate are identical across tiers, only these two fields
 * differ. Hardcoded (rather than fetched via useTemplate) so picking a tier
 * doesn't depend on a network round-trip; if the seed values ever drift,
 * update both places together.
 */
const TIER_PRESETS: Record<Tier, { numTasksPerDomain: number | null; numTrials: number }> = {
  smoke: { numTasksPerDomain: 5, numTrials: 1 },
  standard: { numTasksPerDomain: 20, numTrials: 3 },
  full: { numTasksPerDomain: null, numTrials: 4 },
};

interface AgentParamsFormProps {
  fieldPrefix?: "params" | "config";
}

/** τ³-bench (tau3) agent-scenario params: domains multiselect, tier picker
 * (fills numTasksPerDomain/numTrials), and optional user-simulator provider.
 * `gate` stays at its `{mode:"off"}` default — no editor here, per Task 14
 * scope (a full gate editor is a separate, optional follow-up). */
export function AgentParamsForm({ fieldPrefix = "params" }: AgentParamsFormProps = {}) {
  const { t } = useTranslation("benchmarks");
  const { control, setValue } = useFormContext();
  const id = useId();
  const providers = useLlmJudgeProviders();

  const domains = (useWatch({ control, name: `${fieldPrefix}.domains` }) ?? []) as Tau3Domain[];
  const numTasksPerDomain = useWatch({ control, name: `${fieldPrefix}.numTasksPerDomain` }) as
    | number
    | null
    | undefined;

  // Toggle via a Set so a redundant click (already-checked domain re-checked)
  // can never produce a duplicate entry — `domains` always stays a de-duped
  // subset of DOMAINS, in DOMAINS' canonical order.
  function toggleDomain(domain: Tau3Domain, checked: boolean) {
    const next = new Set(domains);
    if (checked) next.add(domain);
    else next.delete(domain);
    setValue(
      `${fieldPrefix}.domains`,
      DOMAINS.filter((d) => next.has(d)),
      { shouldValidate: true, shouldDirty: true },
    );
  }

  function applyTier(tier: Tier) {
    const preset = TIER_PRESETS[tier];
    setValue(`${fieldPrefix}.numTasksPerDomain`, preset.numTasksPerDomain, {
      shouldValidate: true,
      shouldDirty: true,
    });
    setValue(`${fieldPrefix}.numTrials`, preset.numTrials, {
      shouldValidate: true,
      shouldDirty: true,
    });
  }

  return (
    <div className="space-y-4">
      <FormField
        control={control}
        name={`${fieldPrefix}.domains`}
        render={() => (
          <FormItem>
            <FormLabel required>{t("forms.agent.domains")}</FormLabel>
            <div className="flex flex-wrap gap-4">
              {DOMAINS.map((domain) => {
                const domainId = `${id}-domain-${domain}`;
                return (
                  <div key={domain} className="flex items-center gap-2">
                    <Checkbox
                      id={domainId}
                      checked={domains.includes(domain)}
                      onCheckedChange={(c) => toggleDomain(domain, c === true)}
                    />
                    <Label htmlFor={domainId} className="cursor-pointer font-normal">
                      {domain}
                    </Label>
                  </div>
                );
              })}
            </div>
            <FormMessage />
          </FormItem>
        )}
      />

      <div className="space-y-2">
        <Label htmlFor={`${id}-tier`}>{t("forms.agent.tier")}</Label>
        <Select onValueChange={(v) => applyTier(v as Tier)}>
          <SelectTrigger id={`${id}-tier`} aria-label={t("forms.agent.tier")}>
            <SelectValue placeholder={t("forms.agent.tierPlaceholder")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="smoke">{t("forms.agent.tiers.smoke")}</SelectItem>
            <SelectItem value="standard">{t("forms.agent.tiers.standard")}</SelectItem>
            <SelectItem value="full">{t("forms.agent.tiers.full")}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <FormField
          control={control}
          name={`${fieldPrefix}.numTasksPerDomain`}
          render={({ field }) => (
            <FormItem>
              <FormLabel required>{t("forms.agent.numTasksPerDomain")}</FormLabel>
              <FormControl>
                <Input
                  type="number"
                  min={1}
                  value={field.value ?? ""}
                  placeholder={field.value === null ? t("forms.agent.fullPlaceholder") : undefined}
                  onChange={(e) =>
                    field.onChange(e.target.value === "" ? null : Number(e.target.value))
                  }
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={control}
          name={`${fieldPrefix}.numTrials`}
          render={({ field }) => (
            <FormItem>
              <FormLabel required>{t("forms.agent.numTrials")}</FormLabel>
              <FormControl>
                <Input type="number" min={1} max={8} {...numberField(field)} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
      </div>

      {numTasksPerDomain === null && (
        <p className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
          {t("forms.agent.fullTierCostHint")}
        </p>
      )}

      <FormField
        control={control}
        name={`${fieldPrefix}.userSimProviderId`}
        render={({ field }) => (
          <FormItem>
            <FormLabel>{t("forms.agent.userSimProviderId")}</FormLabel>
            <Select
              value={field.value ?? "__default__"}
              onValueChange={(v) => field.onChange(v === "__default__" ? undefined : v)}
            >
              <FormControl>
                <SelectTrigger aria-label={t("forms.agent.userSimProviderId")}>
                  <SelectValue />
                </SelectTrigger>
              </FormControl>
              <SelectContent>
                <SelectItem value="__default__">
                  {t("forms.agent.userSimProviderDefault")}
                </SelectItem>
                {(providers.data ?? []).map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <FormDescription>{t("forms.agent.userSimProviderHint")}</FormDescription>
            <FormMessage />
          </FormItem>
        )}
      />
    </div>
  );
}
