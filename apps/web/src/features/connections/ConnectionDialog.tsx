import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { type EndpointKey, applyCurlToEndpoint } from "@/lib/apply-curl-to-endpoint";
import { parseCurlCommand, toApiBaseUrl } from "@/lib/curl-parser";
import { useConnectionsStore } from "@/stores/connections-store";
import type { Connection } from "@/types/connection";
import { zodResolver } from "@hookform/resolvers/zod";
import type { ModalityCategory } from "@modeldoctor/contracts";
import { Eye, EyeOff, X as XIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { type ConnectionInput, connectionInputSchema } from "./schema";

interface ConnectionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** If provided, dialog is in edit mode for this connection. */
  connection?: Connection;
  /**
   * Create-mode prefill — e.g. "Save as new" from an inline endpoint form.
   * Ignored when `connection` is set.
   */
  initialValues?: Partial<ConnectionInput>;
  onSaved?: (c: Connection) => void;
}

// Defaults for a fresh dialog. Intentionally Partial so `category` can be
// unset — the user must pick one to satisfy the schema's required enum.
const empty: Partial<ConnectionInput> = {
  name: "",
  apiBaseUrl: "",
  apiKey: "",
  model: "",
  customHeaders: "",
  queryParams: "",
  tags: [],
};

const CATEGORIES: ModalityCategory[] = ["chat", "audio", "embeddings", "rerank", "image"];
const PRESET_TAGS = [
  "vLLM",
  "SGLang",
  "TGI",
  "Ollama",
  "OpenAI",
  "Anthropic",
  "multimodal",
  "streaming",
  "production",
  "test",
];

export function ConnectionDialog({
  open,
  onOpenChange,
  connection,
  initialValues,
  onSaved,
}: ConnectionDialogProps) {
  const { t } = useTranslation("connections");
  const { t: tc } = useTranslation("common");
  const create = useConnectionsStore((s) => s.create);
  const update = useConnectionsStore((s) => s.update);
  const [revealKey, setRevealKey] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [curlInput, setCurlInput] = useState("");
  const [tagDraft, setTagDraft] = useState("");

  const form = useForm<ConnectionInput>({
    resolver: zodResolver(connectionInputSchema),
    defaultValues: empty,
  });

  useEffect(() => {
    if (open) {
      form.reset(connection ?? { ...empty, ...initialValues });
      setSubmitError(null);
      setRevealKey(false);
      setCurlInput("");
      setTagDraft("");
    }
  }, [open, connection, initialValues, form]);

  const onParseCurl = () => {
    const trimmed = curlInput.trim();
    if (!trimmed) {
      toast.error(t("dialog.curl.empty"));
      return;
    }
    const parsed = parseCurlCommand(trimmed);
    const { patch, filledKeys } = applyCurlToEndpoint(parsed);

    if (filledKeys.length === 0) {
      toast.error(t("dialog.curl.invalid"));
      return;
    }

    const validatedKeys: ReadonlySet<EndpointKey> = new Set(["apiBaseUrl", "apiKey", "model"]);
    for (const key of filledKeys) {
      const value = patch[key];
      if (value === undefined) continue;
      form.setValue(key, value, { shouldValidate: validatedKeys.has(key) });
    }

    const localized = filledKeys.map((k) => t(`dialog.fields.${k}`));
    toast.success(t("dialog.curl.filled", { fields: localized.join(", ") }));
  };

  const onSubmit = form.handleSubmit((values) => {
    try {
      const sanitized = { ...values, apiBaseUrl: toApiBaseUrl(values.apiBaseUrl) };
      const saved = connection ? update(connection.id, sanitized) : create(sanitized);
      onSaved?.(saved);
      onOpenChange(false);
    } catch (e) {
      const msg = e instanceof Error ? e.message : tc("errors.unknown");
      setSubmitError(msg);
    }
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{connection ? t("dialog.editTitle") : t("dialog.createTitle")}</DialogTitle>
        </DialogHeader>

        <form onSubmit={onSubmit} className="space-y-4">
          <details className="rounded-md border border-border bg-muted/30 px-3 py-2 text-sm">
            <summary className="cursor-pointer text-xs font-medium text-muted-foreground hover:text-foreground">
              {t("dialog.curl.import")}
            </summary>
            <div className="mt-2 space-y-2">
              <Textarea
                rows={5}
                value={curlInput}
                onChange={(e) => setCurlInput(e.target.value)}
                placeholder={t("dialog.curl.placeholder")}
                className="font-mono text-xs"
              />
              <Button type="button" size="sm" variant="outline" onClick={onParseCurl}>
                {t("dialog.curl.parse")}
              </Button>
            </div>
          </details>

          <div>
            <Label htmlFor="name">{t("dialog.fields.name")}</Label>
            <Input
              id="name"
              autoComplete="off"
              placeholder={t("dialog.fields.namePlaceholder")}
              {...form.register("name")}
            />
            {form.formState.errors.name ? (
              <p className="mt-1 text-xs text-destructive">{tc("errors.required")}</p>
            ) : null}
          </div>

          <div>
            <Label htmlFor="apiBaseUrl">{t("dialog.fields.apiBaseUrl")}</Label>
            <Input
              id="apiBaseUrl"
              autoComplete="off"
              placeholder={t("dialog.fields.apiBaseUrlPlaceholder")}
              {...form.register("apiBaseUrl")}
            />
            {form.formState.errors.apiBaseUrl ? (
              <p className="mt-1 text-xs text-destructive">{t("dialog.errors.invalidUrl")}</p>
            ) : null}
            <p className="mt-1 text-xs text-muted-foreground">
              {t("dialog.fields.apiBaseUrlHelp")}
            </p>
          </div>

          <div>
            <Label htmlFor="apiKey">{t("dialog.fields.apiKey")}</Label>
            <div className="relative">
              <Input
                id="apiKey"
                autoComplete="off"
                type={revealKey ? "text" : "password"}
                placeholder={t("dialog.fields.apiKeyPlaceholder")}
                {...form.register("apiKey")}
              />
              <button
                type="button"
                onClick={() => setRevealKey((v) => !v)}
                className="absolute inset-y-0 right-2 flex items-center text-muted-foreground hover:text-foreground"
                aria-label={revealKey ? "hide" : "show"}
              >
                {revealKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            {form.formState.errors.apiKey ? (
              <p className="mt-1 text-xs text-destructive">{tc("errors.required")}</p>
            ) : null}
          </div>

          <div>
            <Label htmlFor="model">{t("dialog.fields.model")}</Label>
            <Input
              id="model"
              autoComplete="off"
              placeholder={t("dialog.fields.modelPlaceholder")}
              {...form.register("model")}
            />
            {form.formState.errors.model ? (
              <p className="mt-1 text-xs text-destructive">{tc("errors.required")}</p>
            ) : null}
          </div>

          <div>
            <Label htmlFor="category">{t("dialog.fields.category")}</Label>
            <Controller
              control={form.control}
              name="category"
              render={({ field }) => (
                <Select value={field.value ?? ""} onValueChange={field.onChange}>
                  <SelectTrigger id="category" aria-label={t("dialog.fields.category")}>
                    <SelectValue placeholder={t("dialog.fields.categoryPlaceholder")} />
                  </SelectTrigger>
                  <SelectContent>
                    {CATEGORIES.map((c) => (
                      <SelectItem key={c} value={c}>
                        {t(`dialog.categoryOptions.${c}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
            <p className="mt-1 text-xs text-muted-foreground">{t("dialog.fields.categoryHelp")}</p>
            {form.formState.errors.category ? (
              <p className="mt-1 text-xs text-destructive">{tc("errors.required")}</p>
            ) : null}
          </div>

          <div>
            <Label htmlFor="tags">{t("dialog.fields.tags")}</Label>
            <Controller
              control={form.control}
              name="tags"
              render={({ field }) => {
                const current = field.value ?? [];
                const tryAdd = (raw: string) => {
                  const trimmed = raw.trim();
                  if (!trimmed) return;
                  if (current.includes(trimmed)) return;
                  field.onChange([...current, trimmed]);
                };
                const remove = (tag: string) =>
                  field.onChange(current.filter((t: string) => t !== tag));
                const suggestions = PRESET_TAGS.filter((p) => !current.includes(p));
                return (
                  <div className="space-y-2">
                    <div className="flex flex-wrap gap-1">
                      {current.map((tag: string) => (
                        <span
                          key={tag}
                          className="inline-flex items-center gap-1 rounded-full bg-secondary px-2 py-0.5 text-xs"
                        >
                          {tag}
                          <button
                            type="button"
                            aria-label={t("dialog.fields.tagsRemove", {
                              tag,
                              defaultValue: `Remove tag ${tag}`,
                            })}
                            onClick={() => remove(tag)}
                          >
                            <XIcon className="h-3 w-3" />
                          </button>
                        </span>
                      ))}
                    </div>
                    <Input
                      id="tags"
                      value={tagDraft}
                      onChange={(e) => setTagDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          tryAdd(tagDraft);
                          setTagDraft("");
                        }
                      }}
                      placeholder={t("dialog.fields.tagsPlaceholder")}
                    />
                    {suggestions.length > 0 ? (
                      <div className="flex flex-wrap gap-1">
                        {suggestions.slice(0, 8).map((s) => (
                          <button
                            type="button"
                            key={s}
                            onClick={() => tryAdd(s)}
                            className="rounded-full border border-dashed border-border px-2 py-0.5 text-xs text-muted-foreground hover:bg-accent/40"
                          >
                            + {s}
                          </button>
                        ))}
                      </div>
                    ) : null}
                  </div>
                );
              }}
            />
            <p className="mt-1 text-xs text-muted-foreground">{t("dialog.fields.tagsHelp")}</p>
          </div>

          <div>
            <Label htmlFor="customHeaders">{t("dialog.fields.customHeaders")}</Label>
            <Textarea
              id="customHeaders"
              rows={3}
              placeholder={t("dialog.fields.customHeadersPlaceholder")}
              {...form.register("customHeaders")}
            />
          </div>

          <div>
            <Label htmlFor="queryParams">{t("dialog.fields.queryParams")}</Label>
            <Textarea
              id="queryParams"
              rows={2}
              placeholder={t("dialog.fields.queryParamsPlaceholder")}
              {...form.register("queryParams")}
            />
          </div>

          {submitError ? (
            <p className="text-sm text-destructive">
              {submitError.toLowerCase().includes("exists")
                ? t("dialog.errors.duplicateName")
                : submitError}
            </p>
          ) : null}

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              {tc("actions.cancel")}
            </Button>
            <Button type="submit">{tc("actions.save")}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
