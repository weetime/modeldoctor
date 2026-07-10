import { zodResolver } from "@hookform/resolvers/zod";
import type { CreateSkill, SkillPublic, UpdateSkill } from "@modeldoctor/contracts";
import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { z } from "zod";
import { FormActions } from "@/components/common/form-actions";
import { FormSection } from "@/components/common/form-section";
import { Checkbox } from "@/components/ui/checkbox";
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
import { numberField } from "@/features/benchmarks/forms/_shared/numberField";
import { useCreateSkill, useUpdateSkill } from "./queries";

export type SkillSheetMode = { kind: "create" } | { kind: "edit"; existing: SkillPublic };

interface SkillSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: SkillSheetMode;
}

interface SkillInput {
  name: string;
  description: string;
  systemPrompt: string;
  planFirst: boolean;
  maxSteps: number;
}

const empty: SkillInput = {
  name: "",
  description: "",
  systemPrompt: "",
  planFirst: false,
  maxSteps: 12,
};

/**
 * Form-level schema for the BASIC fields only. `mcpServerIds` / `inlineTools`
 * / `modelConnectionId` are NOT edited here — those references are managed
 * from the Agent playground "save as skill" flow (Task 12); this sheet only
 * covers name/description/systemPrompt/planFirst/maxSteps CRUD.
 */
const formSchema = z.object({
  name: z
    .string()
    .transform((v) => v.trim())
    .pipe(z.string().min(1).max(120)),
  description: z.string().default(""),
  systemPrompt: z.string().default(""),
  planFirst: z.boolean().default(false),
  maxSteps: z.number().int().min(1).max(50),
});

/** SkillPublic → form-shape default values. */
function existingToFormValues(s: SkillPublic): SkillInput {
  return {
    name: s.name,
    description: s.description ?? "",
    systemPrompt: s.systemPrompt ?? "",
    planFirst: s.planFirst,
    maxSteps: s.maxSteps,
  };
}

export function SkillSheet({ open, onOpenChange, mode }: SkillSheetProps) {
  const { t } = useTranslation("skills");
  const { t: tc } = useTranslation("common");
  const createMut = useCreateSkill();
  const updateMut = useUpdateSkill();

  const isEdit = mode.kind === "edit";
  const existing = mode.kind === "edit" ? mode.existing : null;

  const form = useForm<SkillInput>({
    resolver: zodResolver(formSchema),
    mode: "onTouched",
    defaultValues: empty,
  });

  // biome-ignore lint/correctness/useExhaustiveDependencies: form/empty/existingToFormValues are stable; key on `existing?.id` (not the whole object) so a background refetch returning an identical-data NEW reference doesn't re-reset and wipe in-progress edits.
  useEffect(() => {
    if (!open) return;
    form.reset(existing ? existingToFormValues(existing) : empty);
  }, [open, existing?.id]);

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      if (existing) {
        const body: UpdateSkill = {
          name: values.name,
          description: values.description,
          systemPrompt: values.systemPrompt,
          planFirst: values.planFirst,
          maxSteps: values.maxSteps,
        };
        await updateMut.mutateAsync({ id: existing.id, body });
        toast.success(t("toast.updateSuccess"));
      } else {
        const body: CreateSkill = {
          name: values.name,
          description: values.description,
          systemPrompt: values.systemPrompt,
          mcpServerIds: [],
          planFirst: values.planFirst,
          maxSteps: values.maxSteps,
        };
        await createMut.mutateAsync(body);
        toast.success(t("toast.createSuccess"));
      }
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : tc("errors.unknown"));
    }
  });

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
                    name="maxSteps"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel required>{t("sheet.fields.maxSteps.label")}</FormLabel>
                        <FormControl>
                          <Input type="number" min={1} max={50} {...numberField(field)} />
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
                  name="systemPrompt"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("sheet.fields.systemPrompt.label")}</FormLabel>
                      <FormControl>
                        <Textarea
                          rows={5}
                          placeholder={t("sheet.fields.systemPrompt.placeholder")}
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="planFirst"
                  render={({ field }) => (
                    <FormItem>
                      <div className="flex items-start gap-2">
                        <FormControl>
                          <Checkbox
                            id="skill-planFirst"
                            checked={!!field.value}
                            onCheckedChange={(v) => field.onChange(v === true)}
                          />
                        </FormControl>
                        <div className="min-w-0">
                          <label
                            htmlFor="skill-planFirst"
                            className="cursor-pointer text-sm font-medium leading-none"
                          >
                            {t("sheet.fields.planFirst.label")}
                          </label>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {t("sheet.fields.planFirst.help")}
                          </p>
                        </div>
                      </div>
                      <FormMessage />
                    </FormItem>
                  )}
                />
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
