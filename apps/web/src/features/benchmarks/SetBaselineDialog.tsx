import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { z } from "zod";
import { FormActions } from "@/components/common/form-actions";
import { FormSection } from "@/components/common/form-section";
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
import { useCreateBaseline } from "@/features/baseline/queries";
import { ApiError } from "@/lib/api-client";

const baselineFormSchema = z.object({
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2048).optional(),
  tagsInput: z.string().optional(),
});

type BaselineFormValues = z.infer<typeof baselineFormSchema>;

export interface SetBaselineDialogProps {
  benchmarkId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
}

export function SetBaselineDialog({
  benchmarkId,
  open,
  onOpenChange,
  onSuccess,
}: SetBaselineDialogProps) {
  const { t } = useTranslation("benchmarks");
  const create = useCreateBaseline();

  const form = useForm<BaselineFormValues>({
    resolver: zodResolver(baselineFormSchema),
    mode: "onTouched",
    defaultValues: { name: "", description: undefined, tagsInput: "" },
  });

  // Reset whenever the dialog re-opens.
  // biome-ignore lint/correctness/useExhaustiveDependencies: form is stable (useForm returns a stable ref)
  useEffect(() => {
    if (open) form.reset({ name: "", description: undefined, tagsInput: "" });
  }, [open]);

  const onSubmit = form.handleSubmit((values) => {
    const tags = (values.tagsInput ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    create.mutate(
      {
        benchmarkId,
        name: values.name,
        ...(values.description ? { description: values.description } : {}),
        tags,
      },
      {
        onSuccess: () => {
          onSuccess?.();
          onOpenChange(false);
        },
        onError: (err) => {
          if (err instanceof ApiError && err.status === 409) {
            toast.error(t("detail.baseline.errors.alreadyExists"));
          } else {
            toast.error(t("detail.baseline.errors.generic"));
          }
        },
      },
    );
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <Form {...form}>
          <form onSubmit={onSubmit} className="space-y-4">
            <DialogHeader>
              <DialogTitle>{t("detail.baseline.dialog.title")}</DialogTitle>
              <DialogDescription>{t("detail.baseline.dialog.body")}</DialogDescription>
            </DialogHeader>

            <FormSection>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <FormField
                  control={form.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel required>{t("detail.baseline.dialog.nameLabel")}</FormLabel>
                      <FormControl>
                        <Input
                          placeholder={t("detail.baseline.dialog.namePlaceholder")}
                          maxLength={200}
                          {...field}
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
                      <FormLabel>{t("detail.baseline.dialog.tagsLabel")}</FormLabel>
                      <FormControl>
                        <Input
                          placeholder="qwen, throughput"
                          {...field}
                          value={field.value ?? ""}
                        />
                      </FormControl>
                    </FormItem>
                  )}
                />
              </div>
              <FormField
                control={form.control}
                name="description"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("detail.baseline.dialog.descriptionLabel")}</FormLabel>
                    <FormControl>
                      <Textarea
                        rows={3}
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
