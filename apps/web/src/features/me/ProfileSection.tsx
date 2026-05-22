import { zodResolver } from "@hookform/resolvers/zod";
import { type UpdateProfileRequest, UpdateProfileRequestSchema } from "@modeldoctor/contracts";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
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
import { useAuthStore } from "@/stores/auth-store";
import { AvatarUpload } from "./AvatarUpload";
import { useUpdateProfile } from "./queries";

export function ProfileSection() {
  const { t } = useTranslation("me");
  const user = useAuthStore((s) => s.user);
  const update = useUpdateProfile();
  const [avatarUrl, setAvatarUrl] = useState<string | null>(user?.avatarUrl ?? null);

  const form = useForm<UpdateProfileRequest>({
    mode: "onTouched",
    resolver: zodResolver(UpdateProfileRequestSchema),
    defaultValues: { displayName: user?.displayName ?? "" },
  });

  if (!user) return null;

  async function onSubmit(values: UpdateProfileRequest) {
    await update.mutateAsync({
      displayName: values.displayName?.trim() ? values.displayName.trim() : null,
      avatarUrl,
    });
    toast.success(t("profile.saveSuccess"));
  }

  return (
    <FormSection title={t("profile.title")} description={t("profile.description")}>
      <div className="space-y-4">
        <div>
          <div className="text-sm font-medium">{t("profile.email")}</div>
          <div className="text-sm text-muted-foreground">{user.email}</div>
        </div>
        <AvatarUpload
          email={user.email}
          displayName={user.displayName}
          avatarUrl={avatarUrl}
          onChange={setAvatarUrl}
          pending={update.isPending}
        />
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="displayName"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("profile.displayName")}</FormLabel>
                  <FormControl>
                    <Input
                      placeholder={t("profile.displayNamePlaceholder")}
                      value={field.value ?? ""}
                      onChange={field.onChange}
                      className="max-w-md"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <Button type="submit" disabled={update.isPending}>
              {t("profile.save")}
            </Button>
          </form>
        </Form>
      </div>
    </FormSection>
  );
}
