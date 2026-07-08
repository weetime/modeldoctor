import { zodResolver } from "@hookform/resolvers/zod";
import type { CreateMcpServer, McpServerPublic, UpdateMcpServer } from "@modeldoctor/contracts";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { z } from "zod";
import { FormActions } from "@/components/common/form-actions";
import { FormSection } from "@/components/common/form-section";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { useCreateMcpServer, useUpdateMcpServer } from "./queries";

export type McpServerSheetMode = { kind: "create" } | { kind: "edit"; existing: McpServerPublic };

interface McpServerSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: McpServerSheetMode;
}

interface McpServerInput {
  name: string;
  description: string;
  url: string;
  authToken: string;
  headers: string;
}

const empty: McpServerInput = {
  name: "",
  description: "",
  url: "",
  authToken: "",
  headers: "",
};

/**
 * Form-level schema — `authToken` is optional on both create AND edit (mirrors
 * `createMcpServerSchema`'s `.optional()`; unlike Connection's `apiKey`,
 * not every MCP server requires auth), so a single schema covers both modes.
 * In edit mode, "keep the saved token" is enforced by the UI (disabled input
 * + reset toggle), not by the schema.
 */
const formSchema = z.object({
  name: z
    .string()
    .transform((v) => v.trim())
    .pipe(z.string().min(1).max(120)),
  description: z.string().default(""),
  url: z.string().url(),
  authToken: z
    .string()
    .default("")
    .refine((v) => v === "" || !/\p{Cc}/u.test(v), { message: "validation.apiKeyControlChar" })
    .refine((v) => v === "" || v === v.trim(), { message: "validation.apiKeyTrim" }),
  headers: z.string().default(""),
});

/** McpServerPublic → form-shape default values (authToken never leaves the server). */
function existingToFormValues(s: McpServerPublic): McpServerInput {
  return {
    name: s.name,
    description: s.description ?? "",
    url: s.url,
    authToken: "", // never sent in PATCH unless the reset toggle is on
    headers: s.headers,
  };
}

export function McpServerSheet({ open, onOpenChange, mode }: McpServerSheetProps) {
  const { t } = useTranslation("mcp-servers");
  const { t: tc } = useTranslation("common");
  const createMut = useCreateMcpServer();
  const updateMut = useUpdateMcpServer();

  const isEdit = mode.kind === "edit";
  const existing = mode.kind === "edit" ? mode.existing : null;

  const [resetAuthToken, setResetAuthToken] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const form = useForm<McpServerInput>({
    resolver: zodResolver(formSchema),
    mode: "onTouched",
    defaultValues: empty,
  });

  // biome-ignore lint/correctness/useExhaustiveDependencies: form reference is stable; we intentionally re-reset on mode/existing change
  useEffect(() => {
    if (!open) return;
    form.reset(existing ? existingToFormValues(existing) : empty);
    setSubmitError(null);
    setResetAuthToken(false);
  }, [open, existing]);

  const onSubmit = form.handleSubmit(async (values) => {
    setSubmitError(null);
    try {
      if (existing) {
        const body: UpdateMcpServer = {
          name: values.name,
          description: values.description,
          url: values.url,
          headers: values.headers,
        };
        if (resetAuthToken) {
          if (values.authToken.trim().length === 0) {
            setSubmitError(t("sheet.resetAuthTokenRequired"));
            return;
          }
          body.authToken = values.authToken;
        }
        await updateMut.mutateAsync({ id: existing.id, body });
        toast.success(t("toast.updateSuccess"));
      } else {
        const trimmedToken = values.authToken.trim();
        const body: CreateMcpServer = {
          name: values.name,
          description: values.description,
          url: values.url,
          headers: values.headers,
          // Only "http" transport is supported today (stdio is a later addition).
          transport: "http",
          ...(trimmedToken ? { authToken: trimmedToken } : {}),
        };
        await createMut.mutateAsync(body);
        toast.success(t("toast.createSuccess"));
      }
      onOpenChange(false);
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : tc("errors.unknown"));
    }
  });

  const authTokenDisabled = isEdit && !resetAuthToken;
  const authTokenPlaceholder = isEdit
    ? (existing?.authTokenPreview ?? t("sheet.fields.authToken.placeholder"))
    : t("sheet.fields.authToken.placeholder");

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-[560px]">
        <SheetHeader>
          <SheetTitle>{isEdit ? t("sheet.editTitle") : t("sheet.createTitle")}</SheetTitle>
        </SheetHeader>

        <Form {...form}>
          <form
            onSubmit={onSubmit}
            autoComplete="off"
            className="flex min-h-0 flex-1 flex-col gap-4"
          >
            <div className="flex-1 space-y-4 overflow-y-auto pr-1">
              <FormSection>
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <FormField
                    control={form.control}
                    name="name"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel required>{t("sheet.fields.name.label")}</FormLabel>
                        <FormControl>
                          <Input
                            autoComplete="off"
                            placeholder={t("sheet.fields.name.placeholder")}
                            {...field}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="url"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel required>{t("sheet.fields.url.label")}</FormLabel>
                        <FormControl>
                          <Input
                            type="url"
                            autoComplete="off"
                            placeholder={t("sheet.fields.url.placeholder")}
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
                  name="description"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("sheet.fields.description.label")}</FormLabel>
                      <FormControl>
                        <Textarea
                          rows={2}
                          placeholder={t("sheet.fields.description.placeholder")}
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="headers"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("sheet.fields.headers.label")}</FormLabel>
                      <FormControl>
                        <Textarea
                          rows={3}
                          placeholder={t("sheet.fields.headers.placeholder")}
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="authToken"
                  render={({ field }) => (
                    <FormItem>
                      <div className="flex items-center justify-between">
                        <FormLabel>{t("sheet.fields.authToken.label")}</FormLabel>
                        {isEdit ? (
                          <label className="flex items-center gap-1 text-xs text-muted-foreground">
                            <input
                              type="checkbox"
                              checked={resetAuthToken}
                              onChange={(e) => {
                                const next = e.target.checked;
                                setResetAuthToken(next);
                                if (!next) form.setValue("authToken", "");
                              }}
                              aria-label={t("sheet.resetAuthToken")}
                            />
                            {t("sheet.resetAuthToken")}
                          </label>
                        ) : null}
                      </div>
                      <FormControl>
                        <Input
                          autoComplete="new-password"
                          type="password"
                          placeholder={authTokenPlaceholder}
                          disabled={authTokenDisabled}
                          {...field}
                        />
                      </FormControl>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {t("sheet.fields.authToken.help")}
                      </p>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                {submitError ? <p className="text-sm text-destructive">{submitError}</p> : null}
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
