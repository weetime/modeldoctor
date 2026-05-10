import { FormActions } from "@/components/common/form-actions";
import { FormSection } from "@/components/common/form-section";
import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
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
import {
  Sheet,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { type EndpointKey, applyCurlToEndpoint } from "@/lib/apply-curl-to-endpoint";
import { parseCurlCommand, toApiBaseUrl } from "@/lib/curl-parser";
import { zodResolver } from "@hookform/resolvers/zod";
import type {
  ConnectionPublic,
  ConnectionWithSecret,
  DiscoverConnectionResponse,
  ModalityCategory,
  ServerKind,
  UpdateConnection,
} from "@modeldoctor/contracts";
import { ENGINE_DISPLAY_NAME } from "@modeldoctor/contracts";
import { AlertTriangle, Eye, EyeOff, Loader2, Sparkles, X as XIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { useCreateConnection, useDiscoverConnection, useUpdateConnection } from "./queries";
import {
  type ConnectionInput,
  connectionInputCreateSchema,
  connectionInputEditSchema,
} from "./schema";

/**
 * Sheet mode — `create` for a brand-new row, `edit` to modify an existing
 * one. In edit mode, the apiKey field is disabled by default (placeholder
 * shows the saved key preview); the user toggles "Reset apiKey" to send a
 * new value. With the toggle off, the PATCH body omits `apiKey` entirely.
 */
export type ConnectionSheetMode =
  | { kind: "create" }
  | { kind: "edit"; existing: ConnectionPublic };

interface ConnectionSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: ConnectionSheetMode;
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
  prometheusUrl: null,
  serverKind: null,
  tags: [],
};

const CATEGORIES: ModalityCategory[] = ["chat", "audio", "embeddings", "rerank", "image"];
const MAX_SUGGESTION_CHIPS = 8;

const SERVER_KIND_OPTIONS: ReadonlyArray<{ value: ServerKind; label: string }> = [
  { value: "vllm", label: ENGINE_DISPLAY_NAME.vllm },
  { value: "sglang", label: ENGINE_DISPLAY_NAME.sglang },
  { value: "tgi", label: ENGINE_DISPLAY_NAME.tgi },
  { value: "trtllm", label: ENGINE_DISPLAY_NAME.trtllm },
  { value: "mindie", label: ENGINE_DISPLAY_NAME.mindie },
  { value: "lmdeploy", label: ENGINE_DISPLAY_NAME.lmdeploy },
  { value: "tei", label: ENGINE_DISPLAY_NAME.tei },
  { value: "infinity", label: ENGINE_DISPLAY_NAME.infinity },
  { value: "llamacpp", label: ENGINE_DISPLAY_NAME.llamacpp },
  { value: "comfyui", label: ENGINE_DISPLAY_NAME.comfyui },
  { value: "higress", label: "Higress (Gateway)" },
  { value: "generic", label: "Generic" },
];

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
    prometheusUrl: c.prometheusUrl ?? null,
    serverKind: c.serverKind ?? null,
    category: c.category,
    tags: c.tags,
  };
}

export function ConnectionSheet({
  open,
  onOpenChange,
  mode,
  initialValues,
  onSaved,
}: ConnectionSheetProps) {
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
  const [discoverResult, setDiscoverResult] = useState<DiscoverConnectionResponse | null>(null);
  const [discoverError, setDiscoverError] = useState<string | null>(null);
  const discoverMut = useDiscoverConnection();

  const form = useForm<ConnectionInput>({
    resolver: zodResolver(isEdit ? connectionInputEditSchema : connectionInputCreateSchema),
    mode: "onTouched",
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
    setDiscoverResult(null);
    setDiscoverError(null);
  }, [open, existing, initialValues]);

  // Re-validate when toggling the reset-apiKey switch in edit mode.
  // biome-ignore lint/correctness/useExhaustiveDependencies: resetApiKey is the trigger; biome can't see that the body's behaviour depends on the apiKey field's enabled state
  useEffect(() => {
    if (!isEdit) return;
    form.trigger("apiKey").catch(() => {});
  }, [isEdit, form, resetApiKey]);

  const baseUrlValue = form.watch("apiBaseUrl");
  const apiKeyValue = form.watch("apiKey");

  const handleDiscover = async () => {
    setDiscoverError(null);
    setDiscoverResult(null);
    const trimmedBaseUrl = baseUrlValue?.trim();
    if (!trimmedBaseUrl) return;
    const trimmedApiKey = apiKeyValue?.trim() || undefined;
    try {
      const res = await discoverMut.mutateAsync({
        baseUrl: trimmedBaseUrl,
        apiKey: trimmedApiKey,
      });
      setDiscoverResult(res);
    } catch (e) {
      const msg = e instanceof Error ? e.message : t("dialog.discover.noResults");
      setDiscoverError(
        msg.toLowerCase().includes("cloud metadata") ||
          msg.toLowerCase().includes("private") ||
          msg.toLowerCase().includes("loopback") ||
          msg.toLowerCase().includes("ssrf")
          ? t("dialog.discover.ssrfBlocked")
          : msg,
      );
    }
  };

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
          prometheusUrl: values.prometheusUrl ?? null,
          serverKind: values.serverKind ?? null,
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
          prometheusUrl: values.prometheusUrl ?? null,
          serverKind: values.serverKind ?? null,
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
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-[640px]">
        <SheetHeader>
          <SheetTitle>{isEdit ? t("dialog.editTitle") : t("dialog.createTitle")}</SheetTitle>
        </SheetHeader>

        <Form {...form}>
          <form
            onSubmit={onSubmit}
            autoComplete="off"
            className="flex min-h-0 flex-1 flex-col gap-4"
          >
            {/* Honeypots: Chrome ignores autocomplete=off when a password field is present. */}
            <input
              type="text"
              name="username"
              autoComplete="username"
              tabIndex={-1}
              aria-hidden="true"
              style={{
                position: "absolute",
                opacity: 0,
                height: 0,
                width: 0,
                pointerEvents: "none",
              }}
            />
            <input
              type="password"
              name="password"
              autoComplete="new-password"
              tabIndex={-1}
              aria-hidden="true"
              style={{
                position: "absolute",
                opacity: 0,
                height: 0,
                width: 0,
                pointerEvents: "none",
              }}
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

              <FormSection>
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <FormField
                    control={form.control}
                    name="name"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel required>{t("dialog.fields.name")}</FormLabel>
                        <FormControl>
                          <Input
                            autoComplete="off"
                            placeholder={t("dialog.fields.namePlaceholder")}
                            {...field}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="category"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel required>{t("dialog.fields.category")}</FormLabel>
                        <FormControl>
                          <Select value={field.value ?? ""} onValueChange={field.onChange}>
                            <SelectTrigger aria-label={t("dialog.fields.category")}>
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
                        </FormControl>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {t("dialog.fields.categoryHelp")}
                        </p>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <FormField
                    control={form.control}
                    name="apiBaseUrl"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel required>{t("dialog.fields.apiBaseUrl")}</FormLabel>
                        <FormControl>
                          <Input
                            autoComplete="off"
                            placeholder={t("dialog.fields.apiBaseUrlPlaceholder")}
                            {...field}
                          />
                        </FormControl>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {t("dialog.fields.apiBaseUrlHelp")}
                        </p>
                        <div className="flex items-center gap-2 pt-1">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={handleDiscover}
                            disabled={!baseUrlValue?.trim() || discoverMut.isPending}
                          >
                            {discoverMut.isPending ? (
                              <>
                                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                {t("dialog.discover.running")}
                              </>
                            ) : (
                              <>
                                <Sparkles className="mr-2 h-4 w-4" />
                                {t("dialog.discover.button")}
                              </>
                            )}
                          </Button>
                          {!baseUrlValue?.trim() ? (
                            <span className="text-xs text-muted-foreground">
                              {t("dialog.discover.missingBaseUrl")}
                            </span>
                          ) : null}
                        </div>
                        {discoverError ? (
                          <div className="mt-3 flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
                            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                            <span>{discoverError}</span>
                          </div>
                        ) : null}
                        {discoverResult && !discoverError ? (
                          <DiscoverResultBanner result={discoverResult} />
                        ) : null}
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="model"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel required>{t("dialog.fields.model")}</FormLabel>
                        <FormControl>
                          <Input
                            autoComplete="off"
                            placeholder={t("dialog.fields.modelPlaceholder")}
                            {...field}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <FormField
                  control={form.control}
                  name="apiKey"
                  render={({ field }) => (
                    <FormItem>
                      <div className="flex items-center justify-between">
                        <FormLabel required={!apiKeyDisabled}>
                          {t("dialog.fields.apiKey")}
                        </FormLabel>
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
                        <FormControl>
                          <Input
                            autoComplete="new-password"
                            type={revealKey ? "text" : "password"}
                            placeholder={apiKeyPlaceholder}
                            disabled={apiKeyDisabled}
                            {...field}
                          />
                        </FormControl>
                        {!apiKeyDisabled ? (
                          <button
                            type="button"
                            onClick={() => setRevealKey((v) => !v)}
                            className="absolute inset-y-0 right-2 flex items-center text-muted-foreground hover:text-foreground"
                            aria-label={revealKey ? "hide" : "show"}
                          >
                            {revealKey ? (
                              <EyeOff className="h-4 w-4" />
                            ) : (
                              <Eye className="h-4 w-4" />
                            )}
                          </button>
                        ) : null}
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {t("dialog.apiKeyEncryptedNotice")}
                      </p>
                      <FormMessage />
                    </FormItem>
                  )}
                />

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
                  <p className="mt-1 text-xs text-muted-foreground">
                    {t("dialog.fields.tagsHelp")}
                  </p>
                </div>

                <FormField
                  control={form.control}
                  name="customHeaders"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("dialog.fields.customHeaders")}</FormLabel>
                      <FormControl>
                        <Textarea
                          rows={3}
                          placeholder={t("dialog.fields.customHeadersPlaceholder")}
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="queryParams"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("dialog.fields.queryParams")}</FormLabel>
                      <FormControl>
                        <Textarea
                          rows={2}
                          placeholder={t("dialog.fields.queryParamsPlaceholder")}
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="tokenizerHfId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("dialog.fields.tokenizerHfId")}</FormLabel>
                      <FormControl>
                        <Input
                          autoComplete="off"
                          placeholder={t("dialog.fields.tokenizerHfIdPlaceholder")}
                          {...field}
                        />
                      </FormControl>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {t("dialog.fields.tokenizerHfIdHelp")}
                      </p>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="serverKind"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("dialog.fields.serverKind")}</FormLabel>
                      <FormControl>
                        <Select
                          value={field.value ?? ""}
                          onValueChange={(v) => field.onChange(v === "" ? null : v)}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder={t("dialog.fields.serverKindPlaceholder")} />
                          </SelectTrigger>
                          <SelectContent>
                            {SERVER_KIND_OPTIONS.map((o) => (
                              <SelectItem key={o.value} value={o.value}>
                                {o.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </FormControl>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {t("dialog.fields.serverKindHelp")}
                      </p>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="prometheusUrl"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("dialog.fields.prometheusUrl")}</FormLabel>
                      <FormControl>
                        <Input
                          type="url"
                          autoComplete="off"
                          placeholder={t("dialog.fields.prometheusUrlPlaceholder")}
                          {...field}
                          value={field.value ?? ""}
                          onChange={(e) =>
                            field.onChange(e.target.value === "" ? null : e.target.value)
                          }
                        />
                      </FormControl>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {t("dialog.fields.prometheusUrlHelp")}
                      </p>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                {submitError ? (
                  <p className="text-sm text-destructive">
                    {submitError.toLowerCase().includes("exists")
                      ? t("dialog.errors.duplicateName")
                      : submitError}
                  </p>
                ) : null}
              </FormSection>
            </div>

            <SheetFooter className="border-t border-border pt-3">
              <FormActions
                onCancel={() => onOpenChange(false)}
                cancelLabel={tc("actions.cancel")}
                submitLabel={tc("actions.save")}
                pending={createMut.isPending || updateMut.isPending}
              />
            </SheetFooter>
          </form>
        </Form>
      </SheetContent>
    </Sheet>
  );
}

function DiscoverResultBanner({ result }: { result: DiscoverConnectionResponse }) {
  const { t } = useTranslation("connections");
  const filledFields = [
    result.inferred.serverKind.value,
    result.inferred.models.values.length > 0 ? "x" : null,
    result.inferred.category.value,
    result.inferred.suggestedTags.values.length > 0 ? "x" : null,
    result.inferred.prometheusUrl.value,
  ].filter(Boolean).length;
  const failedCount = result.health.probesFailed.length;
  const variant: "destructive" | "warning" | "success" =
    filledFields === 0 ? "destructive" : failedCount > 0 ? "warning" : "success";

  const message =
    variant === "destructive"
      ? t("dialog.discover.noResults")
      : variant === "warning"
        ? t("dialog.discover.successPartial", { filled: filledFields, failed: failedCount })
        : t("dialog.discover.successAll", { filled: filledFields });

  const colorClass =
    variant === "destructive"
      ? "border-destructive/30 bg-destructive/10 text-destructive"
      : variant === "warning"
        ? "border-yellow-500/30 bg-yellow-500/10 text-yellow-700 dark:text-yellow-300"
        : "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300";

  return (
    <div className={`mt-3 flex items-start gap-2 rounded-md border p-3 text-sm ${colorClass}`}>
      <span>{message}</span>
    </div>
  );
}
