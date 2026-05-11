import { FormActions } from "@/components/common/form-actions";
import { ConnectionPicker } from "@/components/connection/ConnectionPicker";
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
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { useChannels, useCreateSubscription } from "./queries";
import { type SubscriptionForm, subscriptionFormSchema } from "./schemas";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}

export function SubscriptionSheet({ open, onOpenChange }: Props): JSX.Element {
  const { t } = useTranslation("notifications");
  const { t: tc } = useTranslation("common");
  const { data: channels = [] } = useChannels();
  const create = useCreateSubscription();
  const [submitError, setSubmitError] = useState<string | null>(null);

  const form = useForm<SubscriptionForm>({
    mode: "onTouched",
    resolver: zodResolver(subscriptionFormSchema),
    defaultValues: { channelId: "", eventType: "benchmark.completed", connectionId: undefined },
  });

  useEffect(() => {
    if (open) {
      setSubmitError(null);
      form.reset({
        channelId: "",
        eventType: "benchmark.completed",
        connectionId: undefined,
      });
    }
  }, [open, form]);

  const onSubmit = form.handleSubmit(async (values) => {
    setSubmitError(null);
    try {
      await create.mutateAsync({
        channelId: values.channelId,
        eventType: values.eventType,
        connectionId: values.connectionId || undefined,
      });
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
          <SheetTitle>{t("subscription.newButton")}</SheetTitle>
        </SheetHeader>
        <Form {...form}>
          <form onSubmit={onSubmit} className="mt-4 space-y-4">
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

            {submitError ? (
              <div className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {submitError}
              </div>
            ) : null}

            <FormActions
              onCancel={() => onOpenChange(false)}
              cancelLabel={tc("actions.cancel")}
              submitLabel={tc("actions.create")}
              pending={create.isPending}
            />
          </form>
        </Form>
      </SheetContent>
    </Sheet>
  );
}
