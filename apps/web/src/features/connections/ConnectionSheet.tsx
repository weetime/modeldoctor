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
import { Sheet, SheetContent, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { SubscribersSection } from "@/features/alerts/SubscribersSection";
import { DatasourceSheet } from "@/features/prometheus-datasources/DatasourceSheet";
import { deriveDatasourceNameFromUrl } from "@/features/prometheus-datasources/derive-name";
import { normalizeBaseUrl } from "@/features/prometheus-datasources/normalize-base-url";
import { useDatasources } from "@/features/prometheus-datasources/queries";
import { type EndpointKey, applyCurlToEndpoint } from "@/lib/apply-curl-to-endpoint";
import { parseCurlCommand, toApiBaseUrl } from "@/lib/curl-parser";
import { useAuthStore } from "@/stores/auth-store";
import { zodResolver } from "@hookform/resolvers/zod";
import type {
  ConnectionPublic,
  ConnectionWithSecret,
  CreateConnection,
  DiscoverConnectionResponse,
  ModalityCategory,
  ServerKind,
  UpdateConnection,
} from "@modeldoctor/contracts";
import { ENGINE_DISPLAY_NAME } from "@modeldoctor/contracts";
import { AlertTriangle, Eye, EyeOff, Loader2, Sparkles, X as XIcon } from "lucide-react";
import { Fragment, useEffect, useRef, useState } from "react";
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
export type ConnectionSheetMode = { kind: "create" } | { kind: "edit"; existing: ConnectionPublic };

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
  // Leave undefined on create so the API auto-fills the org-default datasource.
  prometheusDatasourceId: undefined,
  serverKind: null,
  category: null,
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
    // Edit: pre-fill the actual binding (string id or null for explicit unbind).
    prometheusDatasourceId: c.prometheusDatasourceId ?? null,
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
  const [inferredPrometheusUrl, setInferredPrometheusUrl] = useState<string | null>(null);
  const [registerSheetOpen, setRegisterSheetOpen] = useState(false);
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
    setInferredPrometheusUrl(null);
  }, [open, existing, initialValues]);

  // Re-validate when toggling the reset-apiKey switch in edit mode.
  // biome-ignore lint/correctness/useExhaustiveDependencies: resetApiKey is the trigger; biome can't see that the body's behaviour depends on the apiKey field's enabled state
  useEffect(() => {
    if (!isEdit) return;
    form.trigger("apiKey").catch(() => {});
  }, [isEdit, form, resetApiKey]);

  const baseUrlValue = form.watch("apiBaseUrl");
  const apiKeyValue = form.watch("apiKey");
  const customHeadersValue = form.watch("customHeaders");

  const { data: datasources } = useDatasources();

  // -- Discover helpers ------------------------------------------------------
  const countFilledFields = (r: DiscoverConnectionResponse): number =>
    [
      r.inferred.serverKind.value,
      r.inferred.models.values.length > 0 ? "x" : null,
      r.inferred.category.value,
      r.inferred.suggestedTags.values.length > 0 ? "x" : null,
      r.inferred.prometheusUrl.value,
    ].filter(Boolean).length;

  const applyDiscoverToForm = (r: DiscoverConnectionResponse) => {
    const dirty = form.formState.dirtyFields as Record<string, boolean | undefined>;
    const inf = r.inferred;
    if (inf.serverKind.value && !dirty.serverKind) {
      form.setValue("serverKind", inf.serverKind.value, { shouldDirty: false });
    }
    if (inf.models.values.length > 0 && !dirty.model) {
      form.setValue("model", inf.models.values[0], { shouldDirty: false });
    }
    if (inf.category.value && !dirty.category) {
      form.setValue("category", inf.category.value, { shouldDirty: false });
    }
    if (inf.suggestedTags.values.length > 0 && !dirty.tags) {
      form.setValue("tags", inf.suggestedTags.values, { shouldDirty: false });
    }
    // Note: inf.prometheusUrl is shown in the DiscoverResultBanner for evidence,
    // but the form no longer carries a `prometheusUrl` field — metric pulls now
    // go through the dedicated PrometheusDatasource binding instead.
  };

  const runDiscover = async (rawBaseUrl: string, rawApiKey?: string, rawCustomHeaders?: string) => {
    setDiscoverError(null);
    setDiscoverResult(null);
    const baseUrl = rawBaseUrl.trim();
    if (!baseUrl) return;
    const apiKey = rawApiKey?.trim() || undefined;
    const customHeaders = rawCustomHeaders?.trim() || undefined;
    try {
      const res = await discoverMut.mutateAsync({ baseUrl, apiKey, customHeaders });
      setInferredPrometheusUrl(res.inferred.prometheusUrl.value ?? null);

      const filled = countFilledFields(res);
      if (filled > 0) {
        // Smart-fill pattern (Notion / Linear): apply silently, surface a
        // toast confirmation, no inline banner. The form fields ARE the
        // result. Dirty fields are preserved by applyDiscoverToForm.
        applyDiscoverToForm(res);
        const failed = res.health.probesFailed.length;
        toast.success(
          failed > 0
            ? t("dialog.discover.successPartial", { filled, failed })
            : t("dialog.discover.successAll", { filled }),
        );
      } else {
        // Zero detected fields: keep the panel so user can read evidence
        // and failed-probe reasons. Dismissable via the X button.
        setDiscoverResult(res);
      }
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

  const handleDiscover = () => runDiscover(baseUrlValue ?? "", apiKeyValue, customHeadersValue);
  const dismissDiscoverFeedback = () => {
    setDiscoverError(null);
    setDiscoverResult(null);
    setInferredPrometheusUrl(null);
  };

  // -- Auto-parse cURL on textarea change ------------------------------------
  const curlParseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastParsedCurl = useRef("");

  // Reset the parsed-curl marker when the sheet is reopened so the same curl
  // can be pasted again across opens.
  useEffect(() => {
    if (!open) {
      lastParsedCurl.current = "";
      if (curlParseTimer.current) {
        clearTimeout(curlParseTimer.current);
        curlParseTimer.current = null;
      }
    }
  }, [open]);

  const autoParseCurl = (input: string) => {
    const trimmed = input.trim();
    if (!trimmed || trimmed === lastParsedCurl.current) return;

    const parsed = parseCurlCommand(trimmed);
    const { patch, filledKeys } = applyCurlToEndpoint(parsed);
    if (filledKeys.length === 0) return; // not yet parseable; stay silent
    lastParsedCurl.current = trimmed;

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

    if (patch.apiBaseUrl) {
      void runDiscover(patch.apiBaseUrl, patch.apiKey, patch.customHeaders);
    }
  };

  const onCurlChange = (text: string) => {
    setCurlInput(text);
    if (curlParseTimer.current) clearTimeout(curlParseTimer.current);
    // 400ms debounce: a paste fires once with full content (parses
    // immediately on first stable tick); typing/pasting in chunks waits
    // until the user is done.
    curlParseTimer.current = setTimeout(() => autoParseCurl(text), 400);
  };

  const onSubmit = form.handleSubmit(async (values) => {
    setSubmitError(null);
    const sanitizedBaseUrl = toApiBaseUrl(values.apiBaseUrl);
    try {
      if (existing) {
        // superRefine guarantees category is non-null on submit; the cast
        // narrows the form's `ModalityCategory | null` to the create/update
        // contract's `ModalityCategory`.
        const category = values.category as Exclude<typeof values.category, null | undefined>;
        const body: UpdateConnection = {
          name: values.name,
          baseUrl: sanitizedBaseUrl,
          model: values.model,
          customHeaders: values.customHeaders,
          queryParams: values.queryParams,
          tokenizerHfId: values.tokenizerHfId.trim() || null,
          prometheusDatasourceId: values.prometheusDatasourceId ?? null,
          serverKind: values.serverKind ?? null,
          category,
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
        const category = values.category as Exclude<typeof values.category, null | undefined>;
        const create: CreateConnection = {
          name: values.name,
          baseUrl: sanitizedBaseUrl,
          apiKey: values.apiKey,
          model: values.model,
          customHeaders: values.customHeaders,
          queryParams: values.queryParams,
          tokenizerHfId: values.tokenizerHfId.trim() || null,
          // undefined → server auto-fills org default; null → explicit unbind;
          // string → caller-specified id.
          prometheusDatasourceId: values.prometheusDatasourceId,
          serverKind: values.serverKind ?? null,
          category,
          tags: values.tags,
        };
        const saved = await createMut.mutateAsync(create);
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

  // Discover → register CTA — see issue #207. Show the pill only when all
  // three conditions hold: an inferred URL exists, it's not already a
  // registered datasource, the user hasn't picked any datasource yet, and
  // the current user is an admin (backend requires admin for create).
  const user = useAuthStore((s) => s.user);
  const isAdmin = (user?.roles ?? []).includes("admin");
  const watchedDsId = form.watch("prometheusDatasourceId");
  // Compare via normalizeBaseUrl so trailing-slash / case-only variants
  // ("http://prom:9090/" vs "http://prom:9090") don't slip past the
  // dup-check and falsely surface a duplicate-register CTA.
  const inferredAlreadyRegistered = inferredPrometheusUrl
    ? (() => {
        const target = normalizeBaseUrl(inferredPrometheusUrl);
        return (datasources ?? []).some((d) => normalizeBaseUrl(d.baseUrl) === target);
      })()
    : false;
  const showRegisterCta =
    inferredPrometheusUrl != null && !inferredAlreadyRegistered && watchedDsId == null && isAdmin;

  return (
    <>
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
                      onChange={(e) => onCurlChange(e.target.value)}
                      placeholder={t("dialog.curl.placeholder")}
                      className="font-mono text-xs"
                      aria-label={t("dialog.curl.import")}
                    />
                    <p className="text-[11px] text-muted-foreground">
                      {t("dialog.curl.autoParseHint")}
                    </p>
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
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>

                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
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

                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    <FormField
                      control={form.control}
                      name="category"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel required>{t("dialog.fields.category")}</FormLabel>
                          <FormControl>
                            <Select
                              value={field.value ?? ""}
                              onValueChange={(v) => field.onChange(v === "" ? null : v)}
                            >
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
                                <SelectValue
                                  placeholder={t("dialog.fields.serverKindPlaceholder")}
                                />
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
                  </div>

                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
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
                      name="prometheusDatasourceId"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>{t("dialog.fields.prometheusDatasource.label")}</FormLabel>
                          <FormControl>
                            <Select
                              value={field.value ?? "__none__"}
                              onValueChange={(v) => field.onChange(v === "__none__" ? null : v)}
                            >
                              <SelectTrigger
                                aria-label={t("dialog.fields.prometheusDatasource.label")}
                              >
                                <SelectValue
                                  placeholder={t("dialog.fields.prometheusDatasource.placeholder")}
                                />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="__none__">
                                  {t("dialog.fields.prometheusDatasource.none")}
                                </SelectItem>
                                {datasources?.map((ds) => (
                                  <SelectItem key={ds.id} value={ds.id}>
                                    {ds.name}
                                    {ds.isDefault
                                      ? ` (${t("dialog.fields.prometheusDatasource.defaultSuffix")})`
                                      : ""}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </FormControl>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {t("dialog.fields.prometheusDatasource.help")}
                          </p>
                          <FormMessage />
                          {showRegisterCta ? (
                            <div className="mt-2 flex items-center gap-2 rounded-md border bg-muted/40 px-3 py-2 text-sm">
                              <Sparkles className="h-4 w-4 shrink-0 text-muted-foreground" />
                              <div className="min-w-0 flex-1">
                                <p className="truncate">
                                  {t("dialog.discover.registerCta.headline", {
                                    url: inferredPrometheusUrl,
                                  })}
                                </p>
                                <p className="text-xs text-muted-foreground">
                                  {t("dialog.discover.registerCta.body")}
                                </p>
                              </div>
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                onClick={() => setRegisterSheetOpen(true)}
                              >
                                {t("dialog.discover.registerCta.action")} →
                              </Button>
                            </div>
                          ) : null}
                        </FormItem>
                      )}
                    />
                  </div>

                  {submitError ? (
                    <p className="text-sm text-destructive">
                      {submitError.toLowerCase().includes("exists")
                        ? t("dialog.errors.duplicateName")
                        : submitError}
                    </p>
                  ) : null}
                </FormSection>

                {isEdit && existing ? <SubscribersSection connectionId={existing.id} /> : null}

                {discoverError ? (
                  <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                    <span className="flex-1">{discoverError}</span>
                    <button
                      type="button"
                      onClick={dismissDiscoverFeedback}
                      aria-label={t("dialog.discover.dismiss")}
                      className="opacity-70 hover:opacity-100"
                    >
                      <XIcon className="h-4 w-4" />
                    </button>
                  </div>
                ) : null}
                {discoverResult && !discoverError ? (
                  <DiscoverResultBanner
                    result={discoverResult}
                    onClose={dismissDiscoverFeedback}
                    closeLabel={t("dialog.discover.dismiss")}
                  />
                ) : null}
              </div>

              <SheetFooter className="border-t border-border pt-3">
                <FormActions
                  onCancel={() => onOpenChange(false)}
                  cancelLabel={tc("actions.cancel")}
                  submitLabel={tc("actions.save")}
                  pending={createMut.isPending || updateMut.isPending}
                  leading={
                    <Button
                      type="button"
                      variant="outline"
                      onClick={handleDiscover}
                      disabled={!baseUrlValue?.trim() || discoverMut.isPending}
                      title={
                        !baseUrlValue?.trim() ? t("dialog.discover.missingBaseUrl") : undefined
                      }
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
                  }
                />
              </SheetFooter>
            </form>
          </Form>
        </SheetContent>
      </Sheet>
      <DatasourceSheet
        open={registerSheetOpen}
        onOpenChange={setRegisterSheetOpen}
        mode={{
          kind: "create",
          initial: {
            baseUrl: inferredPrometheusUrl ?? "",
            name: deriveDatasourceNameFromUrl(inferredPrometheusUrl),
          },
        }}
        onSaved={(ds) => {
          form.setValue("prometheusDatasourceId", ds.id, { shouldDirty: true });
          setInferredPrometheusUrl(null);
          setRegisterSheetOpen(false);
        }}
      />
    </>
  );
}

/**
 * Persistent panel shown ONLY when Discover returned zero inferred fields.
 * Success/partial cases auto-apply via toast and never reach this component
 * — the form fields themselves are the result. This panel surfaces evidence
 * + failed-probe reasons so the user can diagnose why nothing matched, then
 * dismiss via the X button (or click Discover again with adjustments).
 */
function DiscoverResultBanner({
  result,
  onClose,
  closeLabel,
}: {
  result: DiscoverConnectionResponse;
  onClose: () => void;
  closeLabel: string;
}) {
  const { t } = useTranslation("connections");
  const message = t("dialog.discover.noResults");
  const colorClass = "border-destructive/30 bg-destructive/10 text-destructive";

  // Each row in the details list: field label, displayed value, confidence chip,
  // evidence string. We show a row for every probed field, including ones that
  // came back empty — that's the diagnostic information users need when an
  // endpoint partially responds.
  const inferredRows: Array<{
    key: string;
    label: string;
    value: string;
    confidence: string;
    evidence: string;
  }> = [
    {
      key: "serverKind",
      label: t("dialog.fields.serverKind"),
      value: result.inferred.serverKind.value ?? t("dialog.discover.noValue"),
      confidence: result.inferred.serverKind.confidence,
      evidence: result.inferred.serverKind.evidence,
    },
    {
      key: "models",
      label: t("dialog.fields.model"),
      value:
        result.inferred.models.values.length > 0
          ? result.inferred.models.values.join(", ")
          : t("dialog.discover.noValue"),
      confidence: result.inferred.models.confidence,
      evidence: result.inferred.models.evidence,
    },
    {
      key: "category",
      label: t("dialog.fields.category"),
      value: result.inferred.category.value
        ? t(`dialog.categoryOptions.${result.inferred.category.value}`)
        : t("dialog.discover.noValue"),
      confidence: result.inferred.category.confidence,
      evidence: result.inferred.category.evidence,
    },
    {
      key: "tags",
      label: t("dialog.fields.tags"),
      value:
        result.inferred.suggestedTags.values.length > 0
          ? result.inferred.suggestedTags.values.join(", ")
          : t("dialog.discover.noValue"),
      confidence: result.inferred.suggestedTags.confidence,
      evidence: result.inferred.suggestedTags.evidence,
    },
    {
      key: "prometheusUrl",
      label: t("dialog.fields.prometheusUrl"),
      value: result.inferred.prometheusUrl.value ?? t("dialog.discover.noValue"),
      confidence: result.inferred.prometheusUrl.confidence,
      evidence: result.inferred.prometheusUrl.evidence,
    },
  ];

  return (
    <div className={`rounded-md border p-3 text-sm ${colorClass}`}>
      <div className="flex items-start justify-between gap-3">
        <span className="flex-1">{message}</span>
        <button
          type="button"
          onClick={onClose}
          aria-label={closeLabel}
          className="opacity-70 hover:opacity-100"
        >
          <XIcon className="h-4 w-4" />
        </button>
      </div>
      <details className="mt-2 text-xs" open>
        <summary className="cursor-pointer select-none opacity-80 hover:opacity-100">
          {t("dialog.discover.showDetails")}
        </summary>
        <div className="mt-3 space-y-3">
          <section>
            <div className="mb-1.5 font-medium opacity-80">
              {t("dialog.discover.inferredHeading")}
            </div>
            {/*
              Flat 4-column grid: label | value | confidence chip | evidence.
              `max-content` for the first three keeps them tight; evidence
              takes the remaining `1fr` and wraps if long. `items-baseline`
              keeps text on a shared baseline even when the chip is taller.
            */}
            <dl className="grid grid-cols-[max-content_max-content_max-content_1fr] items-baseline gap-x-3 gap-y-1.5">
              {inferredRows.map((row) => (
                <Fragment key={row.key}>
                  <dt className="font-medium opacity-80">{row.label}:</dt>
                  <dd className="break-all font-mono">{row.value}</dd>
                  <dd>
                    <span className="rounded-full border border-current/30 px-1.5 py-px text-[10px] uppercase tracking-wide opacity-70">
                      {t(`dialog.discover.confidence.${row.confidence}`)}
                    </span>
                  </dd>
                  <dd className="text-[11px] opacity-70">{row.evidence}</dd>
                </Fragment>
              ))}
            </dl>
          </section>
          {result.health.probesFailed.length > 0 ? (
            <section>
              <div className="mb-1 font-medium opacity-80">
                {t("dialog.discover.failedProbesHeading")}
              </div>
              <ul className="space-y-0.5 font-mono text-[11px]">
                {result.health.probesFailed.map((p) => (
                  <li key={`${p.probe}-${p.reason}`}>
                    {p.probe}: {p.reason}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
          {result.health.warnings.length > 0 ? (
            <section>
              <div className="mb-1 font-medium opacity-80">
                {t("dialog.discover.warningsTitle")}
              </div>
              <ul className="space-y-0.5 text-[11px]">
                {result.health.warnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>
      </details>
    </div>
  );
}
