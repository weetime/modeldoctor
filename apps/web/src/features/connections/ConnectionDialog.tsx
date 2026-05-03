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
import { zodResolver } from "@hookform/resolvers/zod";
import type {
  ConnectionPublic,
  ConnectionWithSecret,
  ModalityCategory,
  UpdateConnection,
} from "@modeldoctor/contracts";
import { Eye, EyeOff, X as XIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { useCreateConnection, useUpdateConnection } from "./queries";
import {
  type ConnectionInput,
  connectionInputCreateSchema,
  connectionInputEditSchema,
} from "./schema";

/**
 * Dialog mode — `create` for a brand-new row, `edit` to modify an existing
 * one. In edit mode, the apiKey field is disabled by default (placeholder
 * shows the saved key preview); the user toggles "Reset apiKey" to send a
 * new value. With the toggle off, the PATCH body omits `apiKey` entirely.
 */
export type ConnectionDialogMode =
  | { kind: "create" }
  | { kind: "edit"; existing: ConnectionPublic };

interface ConnectionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: ConnectionDialogMode;
  /**
   * Create-mode prefill — e.g. "Save as new connection" from the picker.
   * Ignored when `mode.kind === "edit"`.
   */
  initialValues?: Partial<ConnectionInput>;
  onSaved?: (c: ConnectionPublic | ConnectionWithSecret) => void;
}

const empty: Partial<ConnectionInput> = {
  name: "",
  apiBaseUrl: "",
  apiKey: "",
  model: "",
  customHeaders: "",
  queryParams: "",
  tokenizerHfId: "",
  tags: [],
};

const CATEGORIES: ModalityCategory[] = ["chat", "audio", "embeddings", "rerank", "image"];
const MAX_SUGGESTION_CHIPS = 8;

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

/** ConnectionPublic → form-shape default values (note: no apiKey is exposed by the server). */
function existingToFormValues(c: ConnectionPublic): Partial<ConnectionInput> {
  return {
    name: c.name,
    apiBaseUrl: c.baseUrl,
    apiKey: "", // never sent in PATCH unless reset toggle is on
    model: c.model,
    customHeaders: c.customHeaders,
    queryParams: c.queryParams,
    tokenizerHfId: c.tokenizerHfId ?? "",
    category: c.category,
    tags: c.tags,
  };
}

export function ConnectionDialog({
  open,
  onOpenChange,
  mode,
  initialValues,
  onSaved,
}: ConnectionDialogProps) {
  const { t } = useTranslation("connections");
  const { t: tc } = useTranslation("common");
  const createMut = useCreateConnection();
  const updateMut = useUpdateConnection();

  const isEdit = mode.kind === "edit";
  const existing = mode.kind === "edit" ? mode.existing : null;

  const [revealKey, setRevealKey] = useState(false);
  const [resetApiKey, setResetApiKey] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [curlInput, setCurlInput] = useState("");
  const [tagDraft, setTagDraft] = useState("");

  const form = useForm<ConnectionInput>({
    resolver: zodResolver(isEdit ? connectionInputEditSchema : connectionInputCreateSchema),
    defaultValues: empty,
  });

  // biome-ignore lint/correctness/useExhaustiveDependencies: form reference is stable; we intentionally re-reset on mode/initialValues change
  useEffect(() => {
    if (!open) return;
    if (existing) {
      form.reset(existingToFormValues(existing));
    } else {
      form.reset({ ...empty, ...initialValues });
    }
    setSubmitError(null);
    setRevealKey(false);
    setResetApiKey(false);
    setCurlInput("");
    setTagDraft("");
  }, [open, existing, initialValues]);

  // Re-validate when toggling the reset-apiKey switch in edit mode.
  // biome-ignore lint/correctness/useExhaustiveDependencies: resetApiKey is the trigger; biome can't see that the body's behaviour depends on the apiKey field's enabled state
  useEffect(() => {
    if (!isEdit) return;
    form.trigger("apiKey").catch(() => {});
  }, [isEdit, form, resetApiKey]);

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
      if (key === "apiKey" && isEdit && !resetApiKey) {
        // Don't surreptitiously change apiKey from a curl in edit mode.
        continue;
      }
      form.setValue(key, value, { shouldValidate: validatedKeys.has(key) });
    }

    const localized = filledKeys.map((k) => t(`dialog.fields.${k}`));
    toast.success(t("dialog.curl.filled", { fields: localized.join(", ") }));
  };

  const onSubmit = form.handleSubmit(async (values) => {
    setSubmitError(null);
    const sanitizedBaseUrl = toApiBaseUrl(values.apiBaseUrl);
    try {
      if (existing) {
        const body: UpdateConnection = {
          name: values.name,
          baseUrl: sanitizedBaseUrl,
          model: values.model,
          customHeaders: values.customHeaders,
          queryParams: values.queryParams,
          tokenizerHfId: values.tokenizerHfId.trim() || null,
          category: values.category,
          tags: values.tags,
        };
        if (resetApiKey) {
          if (values.apiKey.trim().length === 0) {
            setSubmitError(t("dialog.resetApiKeyRequired"));
            return;
          }
          body.apiKey = values.apiKey;
        }
        const saved = await updateMut.mutateAsync({ id: existing.id, body });
        onSaved?.(saved);
      } else {
        const saved = await createMut.mutateAsync({
          name: values.name,
          baseUrl: sanitizedBaseUrl,
          apiKey: values.apiKey,
          model: values.model,
          customHeaders: values.customHeaders,
          queryParams: values.queryParams,
          tokenizerHfId: values.tokenizerHfId.trim() || null,
          category: values.category,
          tags: values.tags,
        });
        onSaved?.(saved);
      }
      onOpenChange(false);
    } catch (e) {
      const msg = e instanceof Error ? e.message : tc("errors.unknown");
      setSubmitError(msg);
    }
  });

  const apiKeyDisabled = isEdit && !resetApiKey;
  const apiKeyPlaceholder = isEdit
    ? (existing?.apiKeyPreview ?? t("dialog.fields.apiKeyPlaceholder"))
    : t("dialog.fields.apiKeyPlaceholder");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90vh] max-w-2xl flex-col">
        <DialogHeader>
          <DialogTitle>{isEdit ? t("dialog.editTitle") : t("dialog.createTitle")}</DialogTitle>
        </DialogHeader>

        <form onSubmit={onSubmit} autoComplete="off" className="flex min-h-0 flex-1 flex-col gap-4">
          {/* Honeypots: Chrome ignores autocomplete=off when a password field is present. */}
          <input
            type="text"
            name="username"
            autoComplete="username"
            tabIndex={-1}
            aria-hidden="true"
            style={{ position: "absolute", opacity: 0, height: 0, width: 0, pointerEvents: "none" }}
          />
          <input
            type="password"
            name="password"
            autoComplete="new-password"
            tabIndex={-1}
            aria-hidden="true"
            style={{ position: "absolute", opacity: 0, height: 0, width: 0, pointerEvents: "none" }}
          />
          <div className="flex-1 space-y-4 overflow-y-auto pr-1">
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

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
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
                <p className="mt-1 text-xs text-muted-foreground">
                  {t("dialog.fields.categoryHelp")}
                </p>
                {form.formState.errors.category ? (
                  <p className="mt-1 text-xs text-destructive">{tc("errors.required")}</p>
                ) : null}
              </div>
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
              <div className="flex items-center justify-between">
                <Label htmlFor="apiKey">{t("dialog.fields.apiKey")}</Label>
                {isEdit ? (
                  <label className="flex items-center gap-1 text-xs text-muted-foreground">
                    <input
                      type="checkbox"
                      checked={resetApiKey}
                      onChange={(e) => {
                        const next = e.target.checked;
                        setResetApiKey(next);
                        if (!next) form.setValue("apiKey", "");
                      }}
                    />
                    {t("dialog.resetApiKey")}
                  </label>
                ) : null}
              </div>
              <div className="relative">
                <Input
                  id="apiKey"
                  autoComplete="new-password"
                  type={revealKey ? "text" : "password"}
                  placeholder={apiKeyPlaceholder}
                  disabled={apiKeyDisabled}
                  {...form.register("apiKey")}
                />
                {!apiKeyDisabled ? (
                  <button
                    type="button"
                    onClick={() => setRevealKey((v) => !v)}
                    className="absolute inset-y-0 right-2 flex items-center text-muted-foreground hover:text-foreground"
                    aria-label={revealKey ? "hide" : "show"}
                  >
                    {revealKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                ) : null}
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {t("dialog.apiKeyEncryptedNotice")}
              </p>
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
                    field.onChange(current.filter((item: string) => item !== tag));
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
                          {suggestions.slice(0, MAX_SUGGESTION_CHIPS).map((s) => (
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

            <div>
              <Label htmlFor="tokenizerHfId">{t("dialog.fields.tokenizerHfId")}</Label>
              <Input
                id="tokenizerHfId"
                placeholder={t("dialog.fields.tokenizerHfIdPlaceholder")}
                {...form.register("tokenizerHfId")}
              />
              <p className="mt-1 text-xs text-muted-foreground">
                {t("dialog.fields.tokenizerHfIdHelp")}
              </p>
            </div>

            {submitError ? (
              <p className="text-sm text-destructive">
                {submitError.toLowerCase().includes("exists")
                  ? t("dialog.errors.duplicateName")
                  : submitError}
              </p>
            ) : null}
          </div>

          <DialogFooter className="border-t border-border pt-3">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              {tc("actions.cancel")}
            </Button>
            <Button type="submit" disabled={createMut.isPending || updateMut.isPending}>
              {tc("actions.save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
