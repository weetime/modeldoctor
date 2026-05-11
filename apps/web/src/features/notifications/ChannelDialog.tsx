import { FormActions } from "@/components/common/form-actions";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { zodResolver } from "@hookform/resolvers/zod";
import type { Channel } from "@modeldoctor/contracts";
import { useEffect } from "react";
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

export function ChannelDialog({ open, onOpenChange, channel }: Props): JSX.Element {
  const { t } = useTranslation("notifications");
  const { t: tc } = useTranslation("common");
  const create = useCreateChannel();
  const update = useUpdateChannel();
  const testCh = useTestChannel();

  const form = useForm<ChannelForm>({
    mode: "onTouched",
    resolver: zodResolver(channelFormSchema),
    defaultValues: { type: "slack", name: "", url: "" },
  });

  // Reset form when the channel being edited changes (or new channel mode).
  useEffect(() => {
    if (open) {
      form.reset({
        type: channel?.type ?? "slack",
        name: channel?.name ?? "",
        url: "",
      });
    }
  }, [open, channel, form]);

  const onSubmit = form.handleSubmit(async (values) => {
    if (channel) {
      await update.mutateAsync({
        id: channel.id,
        body: { name: values.name, url: values.url || undefined },
      });
    } else {
      await create.mutateAsync(values);
    }
    onOpenChange(false);
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {channel ? t("channel.editButton") : t("channel.newButton")}
          </DialogTitle>
          <DialogDescription>{t("channel.form.url")}</DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={onSubmit} className="space-y-4">
            <FormField
              control={form.control}
              name="type"
              render={({ field }) => (
                <FormItem>
                  <FormLabel required>{t("channel.form.type")}</FormLabel>
                  <FormControl>
                    <Select
                      value={field.value}
                      onValueChange={field.onChange}
                      disabled={!!channel}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="slack">
                          {t("channel.form.typeSlack")}
                        </SelectItem>
                        <SelectItem value="webhook">
                          {t("channel.form.typeWebhook")}
                        </SelectItem>
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
                    <Input {...field} />
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
                    <Input {...field} placeholder={t("channel.form.urlPlaceholder")} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
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
      </DialogContent>
    </Dialog>
  );
}
