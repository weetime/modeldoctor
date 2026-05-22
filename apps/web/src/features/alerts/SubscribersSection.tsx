import { Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { FormSection } from "@/components/common/form-section";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useChannels } from "@/features/notifications/queries";
import { useCreateSubscriber, useDeleteSubscriber, useSubscribers } from "./queries";
import type { Severity } from "./types";

function severityVariant(s: Severity): "destructive" | "warning" | "outline" {
  switch (s) {
    case "critical":
      return "destructive";
    case "warning":
      return "warning";
    case "info":
      return "outline";
  }
}

interface Props {
  connectionId: string;
}

export function SubscribersSection({ connectionId }: Props) {
  const { t } = useTranslation("alerts");
  const { data: subscribers = [], isLoading } = useSubscribers(connectionId);
  const { data: channels = [] } = useChannels();
  const createMut = useCreateSubscriber(connectionId);
  const deleteMut = useDeleteSubscriber(connectionId);

  const [adding, setAdding] = useState(false);
  const [draftChannelId, setDraftChannelId] = useState<string>("");
  const [draftSeverity, setDraftSeverity] = useState<Severity>("warning");

  // Hide channels the user has already subscribed to under this connection.
  const usedChannelIds = new Set(subscribers.map((s) => s.channelId));
  const availableChannels = channels.filter((c) => !usedChannelIds.has(c.id));

  const submit = async () => {
    if (!draftChannelId) return;
    try {
      await createMut.mutateAsync({
        channelId: draftChannelId,
        minSeverity: draftSeverity,
      });
      setAdding(false);
      setDraftChannelId("");
      setDraftSeverity("warning");
    } catch (e) {
      toast.error(t("subscribers.errorCreate"), {
        description: (e as Error).message,
      });
    }
  };

  const remove = async (subscriberId: string) => {
    try {
      await deleteMut.mutateAsync(subscriberId);
    } catch (e) {
      toast.error(t("subscribers.errorDelete"), {
        description: (e as Error).message,
      });
    }
  };

  return (
    <FormSection title={t("subscribers.title")} description={t("subscribers.description")}>
      {isLoading ? (
        <div className="h-10 w-full animate-pulse rounded bg-muted" />
      ) : subscribers.length === 0 && !adding ? (
        <div className="text-sm text-muted-foreground">{t("subscribers.empty")}</div>
      ) : (
        <ul className="space-y-2">
          {subscribers.map((s) => (
            <li
              key={s.id}
              className="flex items-center gap-3 rounded-md border border-border bg-card px-3 py-2"
            >
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate">
                  {s.user.displayName ?? s.user.email}
                </div>
                <div className="text-xs text-muted-foreground truncate">
                  {s.channel.name} · {s.channel.type}
                </div>
              </div>
              <Badge variant={severityVariant(s.minSeverity)}>≥ {s.minSeverity}</Badge>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => remove(s.id)}
                disabled={deleteMut.isPending}
                aria-label={t("subscribers.remove")}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </li>
          ))}
        </ul>
      )}

      {adding ? (
        <div className="space-y-3 rounded-md border border-dashed border-border p-3">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div>
              <label
                className="mb-1 block text-xs font-medium text-muted-foreground"
                htmlFor="sub-channel"
              >
                {t("subscribers.channel")}
              </label>
              <Select value={draftChannelId} onValueChange={setDraftChannelId}>
                <SelectTrigger id="sub-channel">
                  <SelectValue placeholder={t("subscribers.channelPlaceholder")} />
                </SelectTrigger>
                <SelectContent>
                  {availableChannels.length === 0 ? (
                    <div className="px-3 py-2 text-sm text-muted-foreground">
                      {t("subscribers.noChannelsLeft")}
                    </div>
                  ) : (
                    availableChannels.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name} ({c.type})
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label
                className="mb-1 block text-xs font-medium text-muted-foreground"
                htmlFor="sub-severity"
              >
                {t("subscribers.minSeverity")}
              </label>
              <Select value={draftSeverity} onValueChange={(v) => setDraftSeverity(v as Severity)}>
                <SelectTrigger id="sub-severity">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="info">info</SelectItem>
                  <SelectItem value="warning">warning</SelectItem>
                  <SelectItem value="critical">critical</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                setAdding(false);
                setDraftChannelId("");
                setDraftSeverity("warning");
              }}
            >
              {t("subscribers.cancel")}
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={submit}
              disabled={!draftChannelId || createMut.isPending}
            >
              {t("subscribers.confirm")}
            </Button>
          </div>
        </div>
      ) : (
        <div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setAdding(true)}
            disabled={channels.length === 0}
            title={channels.length === 0 ? t("subscribers.noChannels") : undefined}
          >
            <Plus className="mr-2 h-4 w-4" />
            {t("subscribers.add")}
          </Button>
          {channels.length === 0 && (
            <p className="mt-2 text-xs text-muted-foreground">{t("subscribers.noChannels")}</p>
          )}
        </div>
      )}
    </FormSection>
  );
}
