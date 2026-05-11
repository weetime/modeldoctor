import { FormActions } from "@/components/common/form-actions";
import { FormSection } from "@/components/common/form-section";
import { Button } from "@/components/ui/button";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { useConnections } from "@/features/connections/queries";
import { zodResolver } from "@hookform/resolvers/zod";
import type { Channel } from "@modeldoctor/contracts";
import { useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  useCreateChannel,
  useCreateSubscription,
  useDeleteSubscription,
  useSubscriptions,
  useTestChannel,
  useUpdateChannel,
} from "./queries";
import { type ChannelForm, channelFormCreateSchema, channelFormEditSchema } from "./schemas";

const EVENTS = ["benchmark.completed", "benchmark.failed", "diagnostics.failed"] as const;
type EventType = (typeof EVENTS)[number];

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  channel: Channel | null;
}

/** A subscription's identity for diff purposes: (channelId implicit, connectionId-or-null, eventType). */
interface SubKey {
  /** null when applyToAll (i.e. `filter.connectionId` is null in the backend row). */
  connectionId: string | null;
  eventType: EventType;
}

function keyOf(k: SubKey): string {
  return `${k.connectionId ?? "*"}::${k.eventType}`;
}

export function ChannelSheet({ open, onOpenChange, channel }: Props): JSX.Element {
  const { t } = useTranslation("notifications");
  const { t: tc } = useTranslation("common");
  const create = useCreateChannel();
  const update = useUpdateChannel();
  const testCh = useTestChannel();
  const createSub = useCreateSubscription();
  const delSub = useDeleteSubscription();
  const { data: subscriptions = [] } = useSubscriptions();
  const { data: connections = [] } = useConnections();
  const [submitError, setSubmitError] = useState<string | null>(null);

  const form = useForm<ChannelForm>({
    mode: "onTouched",
    resolver: zodResolver(channel ? channelFormEditSchema : channelFormCreateSchema),
    defaultValues: {
      type: "slack",
      name: "",
      url: "",
      connectionIds: [],
      applyToAll: false,
      events: [],
    },
  });

  const currentType = form.watch("type");
  const needsKeywordTip = currentType === "feishu" || currentType === "dingtalk";
  const showWebhookTip = currentType === "webhook";
  const applyToAll = form.watch("applyToAll");
  const selectedConnIds = form.watch("connectionIds");
  const selectedEvents = form.watch("events");

  // Subscriptions backing THIS channel (only meaningful in edit mode).
  const existingSubs = useMemo(
    () => (channel ? subscriptions.filter((s) => s.channelId === channel.id) : []),
    [subscriptions, channel],
  );

  // Reset form when the sheet opens. In edit mode, derive selectors from
  // existing subscription rows.
  useEffect(() => {
    if (!open) return;
    setSubmitError(null);
    if (!channel) {
      form.reset({
        type: "slack",
        name: "",
        url: "",
        connectionIds: [],
        applyToAll: false,
        events: [],
      });
      return;
    }
    const hasGlobalRow = existingSubs.some((s) => !s.connectionId);
    const connIds = Array.from(
      new Set(existingSubs.filter((s) => s.connectionId).map((s) => s.connectionId as string)),
    );
    const events = Array.from(new Set(existingSubs.map((s) => s.eventType))) as EventType[];
    form.reset({
      type: channel.type,
      name: channel.name,
      url: "",
      applyToAll: hasGlobalRow,
      connectionIds: hasGlobalRow ? [] : connIds,
      events,
    });
  }, [open, channel, existingSubs, form]);

  /** Compute the set of subscription keys the user wants. */
  const intendedKeys = useMemo<SubKey[]>(() => {
    if (selectedEvents.length === 0) return [];
    if (applyToAll) {
      return selectedEvents.map((ev) => ({ connectionId: null, eventType: ev as EventType }));
    }
    return selectedConnIds.flatMap((cid) =>
      selectedEvents.map((ev) => ({ connectionId: cid, eventType: ev as EventType })),
    );
  }, [applyToAll, selectedConnIds, selectedEvents]);

  const onSubmit = form.handleSubmit(async (values) => {
    setSubmitError(null);
    try {
      // 1. Create or update the channel itself.
      let channelId: string;
      if (channel) {
        await update.mutateAsync({
          id: channel.id,
          body: { name: values.name, url: values.url || undefined },
        });
        channelId = channel.id;
      } else {
        const created = await create.mutateAsync({
          type: values.type,
          name: values.name,
          url: values.url,
        });
        channelId = created.id;
      }

      // 2. Diff subscriptions and apply.
      const want = new Map<string, SubKey>();
      for (const k of intendedKeys) want.set(keyOf(k), k);
      const have = new Map<string, string>(); // key → subscription.id
      for (const s of existingSubs) {
        have.set(
          keyOf({
            connectionId: s.connectionId ?? null,
            eventType: s.eventType as EventType,
          }),
          s.id,
        );
      }
      for (const [k, sub] of want) {
        if (!have.has(k)) {
          await createSub.mutateAsync({
            channelId,
            eventType: sub.eventType,
            connectionId: sub.connectionId ?? undefined,
          });
        }
      }
      for (const [k, id] of have) {
        if (!want.has(k)) {
          await delSub.mutateAsync(id);
        }
      }

      onOpenChange(false);
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : tc("errors.unknown"));
    }
  });

  const toggleConn = (id: string, checked: boolean) => {
    const current = form.getValues("connectionIds");
    form.setValue(
      "connectionIds",
      checked ? Array.from(new Set([...current, id])) : current.filter((c) => c !== id),
      { shouldValidate: true },
    );
  };

  const toggleEvent = (ev: EventType, checked: boolean) => {
    const current = form.getValues("events");
    form.setValue(
      "events",
      checked ? Array.from(new Set([...current, ev])) : current.filter((e) => e !== ev),
      { shouldValidate: true },
    );
  };

  const submitPending =
    create.isPending || update.isPending || createSub.isPending || delSub.isPending;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-[720px]">
        <SheetHeader>
          <SheetTitle>{channel ? t("channel.editButton") : t("channel.newButton")}</SheetTitle>
        </SheetHeader>
        <Form {...form}>
          <form onSubmit={onSubmit} autoComplete="off" className="mt-4 space-y-6">
            <FormSection title={t("channel.form.basicSection")}>
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
                        placeholder={channel?.urlMasked ?? t("channel.form.urlPlaceholder")}
                        autoComplete="off"
                        data-1p-ignore
                        data-lpignore="true"
                      />
                    </FormControl>
                    {channel ? (
                      <p className="text-xs text-muted-foreground">
                        {t("channel.form.urlEditHint")}
                      </p>
                    ) : null}
                    <FormMessage />
                  </FormItem>
                )}
              />

              {needsKeywordTip ? (
                <div className="rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                  {t("channel.form.keywordTip")}
                </div>
              ) : null}

              {showWebhookTip ? (
                <div className="space-y-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                  <div>{t("channel.form.webhookTip")}</div>
                  <div className="font-mono text-[11px]">
                    {t("channel.form.webhookPayloadHint")}
                  </div>
                  <pre className="overflow-x-auto rounded bg-background/60 p-2 font-mono text-[11px] leading-relaxed">{`{
  "eventType": "benchmark.completed",
  "payload": {
    "benchmarkId": "ckxxx...",
    "name": "...",
    "status": "completed",
    "scenario": "inference",
    "tool": "guidellm",
    "connectionId": "ckyyy...",
    "summaryMetrics": { ... }
  }
}`}</pre>
                </div>
              ) : null}
            </FormSection>

            <FormSection
              title={t("channel.form.subscriptionsSection")}
              description={t("channel.form.subscriptionsHint")}
            >
              <FormField
                control={form.control}
                name="events"
                render={() => (
                  <FormItem>
                    <FormLabel>{t("channel.form.events")}</FormLabel>
                    <div className="space-y-2">
                      {EVENTS.map((ev) => (
                        <label
                          key={ev}
                          htmlFor={`channel-event-${ev}`}
                          className="flex items-center gap-2"
                        >
                          <Checkbox
                            id={`channel-event-${ev}`}
                            checked={selectedEvents.includes(ev)}
                            onCheckedChange={(c) => toggleEvent(ev, !!c)}
                          />
                          <span className="text-sm">{t(`channel.form.eventOptions.${ev}`)}</span>
                        </label>
                      ))}
                    </div>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="applyToAll"
                render={({ field }) => (
                  <FormItem className="flex items-center justify-between rounded-md border border-border bg-muted/30 px-3 py-2">
                    <div className="space-y-0.5">
                      <FormLabel className="text-sm">{t("channel.form.applyToAll")}</FormLabel>
                      <div className="text-xs text-muted-foreground">
                        {t("channel.form.applyToAllHint")}
                      </div>
                    </div>
                    <FormControl>
                      <Switch checked={field.value} onCheckedChange={field.onChange} />
                    </FormControl>
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="connectionIds"
                render={() => (
                  <FormItem>
                    <FormLabel>{t("channel.form.connections")}</FormLabel>
                    {applyToAll ? (
                      <div className="rounded-md border border-dashed border-border bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
                        {t("channel.form.connectionsDisabled")}
                      </div>
                    ) : connections.length === 0 ? (
                      <div className="rounded-md border border-dashed border-border bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
                        {t("channel.form.connectionsEmpty")}
                      </div>
                    ) : (
                      <div className="max-h-56 space-y-1 overflow-y-auto rounded-md border border-border bg-background/40 px-3 py-2">
                        {connections.map((c) => (
                          <label
                            key={c.id}
                            htmlFor={`channel-conn-${c.id}`}
                            className="flex items-center gap-2"
                          >
                            <Checkbox
                              id={`channel-conn-${c.id}`}
                              checked={selectedConnIds.includes(c.id)}
                              onCheckedChange={(checked) => toggleConn(c.id, !!checked)}
                            />
                            <span className="text-sm">
                              {c.name}
                              <span className="ml-2 text-xs text-muted-foreground">{c.model}</span>
                            </span>
                          </label>
                        ))}
                      </div>
                    )}
                    <FormMessage />
                  </FormItem>
                )}
              />
            </FormSection>

            {submitError ? (
              <div className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {submitError}
              </div>
            ) : null}

            <FormActions
              onCancel={() => onOpenChange(false)}
              cancelLabel={tc("actions.cancel")}
              submitLabel={tc(channel ? "actions.save" : "actions.create")}
              pending={submitPending}
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
