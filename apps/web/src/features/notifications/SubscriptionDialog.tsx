import { FormActions } from "@/components/common/form-actions";
import { ConnectionPicker } from "@/components/connection/ConnectionPicker";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { useChannels, useCreateSubscription } from "./queries";
import { type SubscriptionForm, subscriptionFormSchema } from "./schemas";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}

export function SubscriptionDialog({ open, onOpenChange }: Props): JSX.Element {
  const { t } = useTranslation("notifications");
  const { t: tc } = useTranslation("common");
  const { data: channels = [] } = useChannels();
  const create = useCreateSubscription();

  const form = useForm<SubscriptionForm>({
    mode: "onTouched",
    resolver: zodResolver(subscriptionFormSchema),
    defaultValues: { channelId: "", eventType: "benchmark.completed", connectionId: undefined },
  });

  useEffect(() => {
    if (open) {
      form.reset({
        channelId: "",
        eventType: "benchmark.completed",
        connectionId: undefined,
      });
    }
  }, [open, form]);

  const onSubmit = form.handleSubmit(async (values) => {
    await create.mutateAsync({
      channelId: values.channelId,
      eventType: values.eventType,
      connectionId: values.connectionId || undefined,
    });
    onOpenChange(false);
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("subscription.newButton")}</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={onSubmit} className="space-y-4">
            <FormField
              control={form.control}
              name="channelId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel required>{t("subscription.form.channel")}</FormLabel>
                  <FormControl>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {channels.map((c) => (
                          <SelectItem key={c.id} value={c.id}>
                            {c.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="eventType"
              render={({ field }) => (
                <FormItem>
                  <FormLabel required>{t("subscription.form.eventType")}</FormLabel>
                  <FormControl>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="benchmark.completed">
                          {t("subscription.form.events.benchmark.completed")}
                        </SelectItem>
                        <SelectItem value="benchmark.failed">
                          {t("subscription.form.events.benchmark.failed")}
                        </SelectItem>
                        <SelectItem value="diagnostics.failed">
                          {t("subscription.form.events.diagnostics.failed")}
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
              name="connectionId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("subscription.form.connection")}</FormLabel>
                  <FormControl>
                    <ConnectionPicker
                      selectedConnectionId={field.value ?? null}
                      onSelect={(id) => field.onChange(id ?? undefined)}
                      allowManual={false}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormActions
              onCancel={() => onOpenChange(false)}
              cancelLabel={tc("actions.cancel")}
              submitLabel={tc("actions.create")}
              pending={create.isPending}
            />
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
