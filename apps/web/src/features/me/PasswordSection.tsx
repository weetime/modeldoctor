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
import { FormSection } from "@/components/common/form-section";
import { zodResolver } from "@hookform/resolvers/zod";
import { ChangePasswordRequestSchema } from "@modeldoctor/contracts";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { z } from "zod";
import { useChangePassword } from "./queries";

const FormSchema = ChangePasswordRequestSchema.extend({
  confirmPassword: z.string().min(8).max(200),
}).refine((v) => v.newPassword === v.confirmPassword, {
  message: "errorMismatch",
  path: ["confirmPassword"],
});
type FormValues = z.infer<typeof FormSchema>;

export function PasswordSection() {
  const { t } = useTranslation("me");
  const change = useChangePassword();
  const form = useForm<FormValues>({
    mode: "onTouched",
    resolver: zodResolver(FormSchema),
    defaultValues: { currentPassword: "", newPassword: "", confirmPassword: "" },
  });

  async function onSubmit(values: FormValues) {
    try {
      await change.mutateAsync({
        currentPassword: values.currentPassword,
        newPassword: values.newPassword,
      });
      toast.success(t("password.success"));
      form.reset();
    } catch (e: any) {
      const status = e?.status ?? e?.response?.status;
      if (status === 401) toast.error(t("password.errorWrong"));
      else if (status === 400) toast.error(t("password.errorSame"));
      else toast.error(String(e?.message ?? e));
    }
  }

  return (
    <FormSection title={t("password.title")} description={t("password.description")}>
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 max-w-md">
          <FormField
            control={form.control}
            name="currentPassword"
            render={({ field }) => (
              <FormItem>
                <FormLabel required>{t("password.current")}</FormLabel>
                <FormControl>
                  <Input type="password" autoComplete="current-password" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="newPassword"
            render={({ field }) => (
              <FormItem>
                <FormLabel required>{t("password.next")}</FormLabel>
                <FormControl>
                  <Input type="password" autoComplete="new-password" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="confirmPassword"
            render={({ field }) => (
              <FormItem>
                <FormLabel required>{t("password.confirm")}</FormLabel>
                <FormControl>
                  <Input type="password" autoComplete="new-password" {...field} />
                </FormControl>
                {form.formState.errors.confirmPassword ? (
                  <p className="text-[0.8rem] font-medium text-destructive">
                    {form.formState.errors.confirmPassword.message === "errorMismatch"
                      ? t("password.errorMismatch")
                      : form.formState.errors.confirmPassword.message}
                  </p>
                ) : null}
              </FormItem>
            )}
          />
          <Button type="submit" disabled={change.isPending}>
            {t("password.submit")}
          </Button>
        </form>
      </Form>
    </FormSection>
  );
}
