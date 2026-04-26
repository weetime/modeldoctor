import { useFormContext } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import {
  PROFILE_DEFAULTS,
  PROFILE_ORDER,
  profileLabelKey,
  type LivePreset,
} from "./profiles";
import type { BenchmarkProfile } from "@modeldoctor/contracts";
import type { CreateBenchmarkRequest } from "./schemas";

export function BenchmarkProfilePicker() {
  const { t } = useTranslation("benchmark");
  const { setValue, watch } = useFormContext<CreateBenchmarkRequest>();
  const current = watch("profile");

  const onPick = (p: BenchmarkProfile) => {
    if (p === "sharegpt") return;
    setValue("profile", p, { shouldValidate: true });
    if (p !== "custom") {
      const d = PROFILE_DEFAULTS[p as LivePreset];
      setValue("datasetName", d.datasetName, { shouldValidate: true });
      setValue("datasetInputTokens", d.datasetInputTokens, {
        shouldValidate: true,
      });
      setValue("datasetOutputTokens", d.datasetOutputTokens, {
        shouldValidate: true,
      });
      setValue("requestRate", d.requestRate, { shouldValidate: true });
      setValue("totalRequests", d.totalRequests, { shouldValidate: true });
    }
  };

  return (
    <div className="flex flex-wrap gap-2">
      {PROFILE_ORDER.map((p) => {
        const label = t(`profiles.${profileLabelKey(p)}`);
        const selected = current === p;
        const disabled = p === "sharegpt";
        const className = cn(
          "rounded-full border px-3 py-1 text-xs",
          selected
            ? "bg-primary text-primary-foreground border-primary"
            : "bg-background border-border text-foreground",
          disabled && "opacity-50 cursor-not-allowed",
        );
        const button = (
          <Button
            key={p}
            type="button"
            variant="ghost"
            disabled={disabled}
            onClick={() => onPick(p)}
            className={className}
          >
            {label}
            {disabled && (
              <span className="ml-1 text-[10px] text-muted-foreground">
                {t("comingSoon")}
              </span>
            )}
          </Button>
        );
        return disabled ? (
          <Tooltip key={p}>
            <TooltipTrigger asChild>
              <span>{button}</span>
            </TooltipTrigger>
            <TooltipContent>{t("comingSoon")}</TooltipContent>
          </Tooltip>
        ) : (
          button
        );
      })}
    </div>
  );
}
