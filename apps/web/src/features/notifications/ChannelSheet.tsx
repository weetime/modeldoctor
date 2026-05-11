import { FormActions } from "@/components/common/form-actions";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { zodResolver } from "@hookform/resolvers/zod";
import type { Channel } from "@modeldoctor/contracts";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { useCreateChannel, useTestChannel, useUpdateChannel } from "./queries";
import { type ChannelForm, channelFormSchema } from "./schemas";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  channel: Channel | null;
}

export function ChannelSheet({ open, onOpenChange, channel }: Props): JSX.Element {
  const { t } = useTranslation("notifications");
  const { t: tc } = useTranslation("common");
  const create = useCreateChannel();
  const update = useUpdateChannel();
  const testCh = useTestChannel();
  const [submitError, setSubmitError] = useState<string | null>(null);

  const form = useForm<ChannelForm>({
    mode: "onTouched",
    resolver: zodResolver(channelFormSchema),
    defaultValues: { type: "slack", name: "", url: "" },
  });

  const currentType = form.watch("type");
  const needsKeywordTip = currentType === "feishu" || currentType === "dingtalk";

  useEffect(() => {
    if (open) {
      setSubmitError(null);
      form.reset({
        type: channel?.type ?? "slack",
        name: channel?.name ?? "",
        url: "",
      });
    }
  }, [open, channel, form]);

  const onSubmit = form.handleSubmit(async (values) => {
    setSubmitError(null);
    try {
      if (channel) {
        await update.mutateAsync({
          id: channel.id,
          body: { name: values.name, url: values.url || undefined },
        });
      } else {
        await create.mutateAsync(values);
      }
      onOpenChange(false);
    } catch (e) {
      const msg = e instanceof Error ? e.message : tc("errors.unknown");
      setSubmitError(msg);
    }
  });

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-[640px]">
        <SheetHeader>
          <SheetTitle>{channel ? t("channel.editButton") : t("channel.newButton")}</SheetTitle>
        </SheetHeader>
        <Form {...form}>
          <form onSubmit={onSubmit} autoComplete="off" className="mt-4 space-y-4">
            <FormField
              control={form.control}
              name="type"
              render={({ field }) => (
                <FormItem>
                  <FormLabel required>{t("channel.form.type")}</FormLabel>
                  <FormControl>
                    <Select value={field.value} onValueChange={field.onChange} disabled={!!channel}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="slack">{t("channel.form.typeSlack")}</SelectItem>
                        <SelectItem value="feishu">{t("channel.form.typeFeishu")}</SelectItem>
                        <SelectItem value="dingtalk">{t("channel.form.typeDingtalk")}</SelectItem>
                        <SelectItem value="webhook">{t("channel.form.typeWebhook")}</SelectItem>
                      </SelectContent>
                    </Select>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel required>{t("channel.form.name")}</FormLabel>
                  <FormControl>
                    <Input {...field} autoComplete="off" data-1p-ignore data-lpignore="true" />
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
                  <FormLabel required={!channel}>{t("channel.form.url")}</FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      placeholder={t("channel.form.urlPlaceholder")}
                      autoComplete="off"
                      data-1p-ignore
                      data-lpignore="true"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {needsKeywordTip ? (
              <div className="rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                {t("channel.form.keywordTip")}
              </div>
            ) : null}

            {submitError ? (
              <div className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {submitError}
              </div>
            ) : null}

            <FormActions
              onCancel={() => onOpenChange(false)}
              cancelLabel={tc("actions.cancel")}
              submitLabel={tc(channel ? "actions.save" : "actions.create")}
              pending={create.isPending || update.isPending}
              leading={
                channel ? (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={async () => {
                      const res = await testCh.mutateAsync(channel.id);
                      if (res.ok) toast.success(t("channel.testSuccess"));
                      else toast.error(t("channel.testFailure", { error: res.error ?? "" }));
                    }}
                    disabled={testCh.isPending}
                  >
                    {t("channel.testButton")}
                  </Button>
                ) : null
              }
            />
          </form>
        </Form>
      </SheetContent>
    </Sheet>
  );
}
