import { useId } from "react";
import { useFormContext, Controller } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useConnectionsStore } from "@/stores/connections-store";
import type { CreateBenchmarkRequest } from "./schemas";

export function BenchmarkEndpointFields() {
  const { t } = useTranslation("benchmark");
  const { register, setValue, control, formState } =
    useFormContext<CreateBenchmarkRequest>();
  const apiTypeId = useId();
  const apiUrlId = useId();
  const apiKeyId = useId();
  const modelId = useId();
  const connId = useId();

  const conns = useConnectionsStore((s) => s.list());

  const onPickConnection = (connectionId: string) => {
    if (connectionId === "__manual__") return;
    const conn = conns.find((c) => c.id === connectionId);
    if (!conn) return;
    setValue("apiUrl", conn.apiUrl, { shouldValidate: true });
    setValue("apiKey", conn.apiKey, { shouldValidate: true });
    setValue("model", conn.model, { shouldValidate: true });
  };

  const errors = formState.errors;

  return (
    <div className="rounded-md border border-dashed border-border bg-muted/30 p-3 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs uppercase tracking-wide text-muted-foreground">
          {t("create.fields.apiUrl")}
        </span>
        {conns.length > 0 && (
          <div className="flex items-center gap-2">
            <Label htmlFor={connId} className="text-xs text-muted-foreground">
              {t("create.loadFromConnection")}
            </Label>
            <Select onValueChange={onPickConnection}>
              <SelectTrigger id={connId} className="h-8 w-[180px] text-xs">
                <SelectValue placeholder="—" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__manual__">Manual</SelectItem>
                {conns.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div className="col-span-1">
          <Label htmlFor={apiTypeId}>{t("create.fields.apiType")}</Label>
          <Controller
            name="apiType"
            control={control}
            render={({ field }) => (
              <Select value={field.value} onValueChange={field.onChange}>
                <SelectTrigger id={apiTypeId}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="chat">chat</SelectItem>
                  <SelectItem value="completion">completion</SelectItem>
                </SelectContent>
              </Select>
            )}
          />
        </div>
        <div className="col-span-2">
          <Label htmlFor={modelId}>{t("create.fields.model")}</Label>
          <Input
            id={modelId}
            {...register("model")}
            aria-invalid={!!errors.model}
          />
        </div>
      </div>

      <div>
        <Label htmlFor={apiUrlId}>{t("create.fields.apiUrl")}</Label>
        <Input
          id={apiUrlId}
          {...register("apiUrl")}
          aria-invalid={!!errors.apiUrl}
        />
      </div>
      <div>
        <Label htmlFor={apiKeyId}>{t("create.fields.apiKey")}</Label>
        <Input
          id={apiKeyId}
          type="password"
          {...register("apiKey")}
          aria-invalid={!!errors.apiKey}
        />
      </div>
    </div>
  );
}
