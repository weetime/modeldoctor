import { FormActions } from "@/components/common/form-actions";
import { FormSection } from "@/components/common/form-section";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useCreateTemplate } from "@/features/benchmark-templates/queries";
import type { Benchmark } from "@modeldoctor/contracts";
import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { z } from "zod";

const formSchema = z.object({
  name: z.string().trim().min(1).max(100),
  description: z.string().trim().max(2048).optional(),
  tagsInput: z.string().optional(),
});

type FormValues = z.infer<typeof formSchema>;

export interface SaveAsTemplateDialogProps {
  /** When null the dialog is closed; pass the benchmark to open. */
  benchmark: Benchmark | null;
  onOpenChange: (open: boolean) => void;
}

function defaultName(benchmarkName: string): string {
  // Schema caps name at 100. " (template)" is 11 chars; reserve 89 for the source name.
  const trimmed = benchmarkName.length > 89 ? benchmarkName.slice(0, 89) : benchmarkName;
  return `${trimmed} (template)`;
}

export function SaveAsTemplateDialog({ benchmark, onOpenChange }: SaveAsTemplateDialogProps) {
  const { t } = useTranslation("benchmarks");
  const create = useCreateTemplate();
  const [submitError, setSubmitError] = useState<string | null>(null);

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    mode: "onTouched",
    defaultValues: { name: "", description: undefined, tagsInput: "" },
  });

  // Re-seed defaults whenever the dialog re-opens with a (possibly different) benchmark.
  // biome-ignore lint/correctness/useExhaustiveDependencies: form ref is stable
  useEffect(() => {
    if (benchmark) {
      form.reset({
        name: defaultName(benchmark.name),
        description: benchmark.description ?? undefined,
        tagsInput: "",
      });
      setSubmitError(null);
    }
  }, [benchmark?.id]);

  const onSubmit = form.handleSubmit(async (values) => {
    if (!benchmark) return;
    const tags = (values.tagsInput ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    setSubmitError(null);
    try {
      const next = await create.mutateAsync({
        name: values.name,
        ...(values.description ? { description: values.description } : {}),
        scenario: benchmark.scenario,
        tool: benchmark.tool,
        config: benchmark.params as Record<string, unknown>,
        tags,
        isOfficial: false,
      });
      toast.success(t("rowActions.saveAsTemplate.success", { name: next.name }));
      onOpenChange(false);
    } catch {
      setSubmitError(t("rowActions.saveAsTemplate.errors.generic"));
    }
  });

  return (
    <Dialog open={benchmark !== null} onOpenChange={onOpenChange}>
      <DialogContent>
        <Form {...form}>
          <form onSubmit={onSubmit} className="space-y-4">
            <DialogHeader>
              <DialogTitle>{t("detail.saveAsTemplate.button")}</DialogTitle>
              <DialogDescription>
                {t("rowActions.saveAsTemplate.label")}
              </DialogDescription>
            </DialogHeader>

            {submitError && (
              <Alert variant="destructive">
                <AlertDescription>{submitError}</AlertDescription>
              </Alert>
            )}

            <FormSection>
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel required>
                      {t("benchmark-templates:create.fields.name", { defaultValue: "Template name" })}
                    </FormLabel>
                    <FormControl>
                      <Input maxLength={100} {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="description"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      {t("benchmark-templates:create.fields.description", { defaultValue: "Description" })}
                    </FormLabel>
                    <FormControl>
                      <Textarea
                        rows={2}
                        {...field}
                        value={field.value ?? ""}
                        onChange={(e) =>
                          field.onChange(e.target.value === "" ? undefined : e.target.value)
                        }
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="tagsInput"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      {t("benchmark-templates:create.fields.tags", { defaultValue: "Tags" })}
                    </FormLabel>
                    <FormControl>
                      <Input
                        placeholder={t("detail.baseline.dialog.tagsLabel", { defaultValue: "" })}
                        {...field}
                        value={field.value ?? ""}
                      />
                    </FormControl>
                  </FormItem>
                )}
              />
            </FormSection>

            <DialogFooter>
              <FormActions
                onCancel={() => onOpenChange(false)}
                cancelLabel={t("detail.baseline.dialog.cancel")}
                submitLabel={t("detail.baseline.dialog.submit")}
                disabled={!form.formState.isValid}
                pending={create.isPending}
              />
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
