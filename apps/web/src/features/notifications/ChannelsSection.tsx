import { FormSection } from "@/components/common/form-section";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { Channel } from "@modeldoctor/contracts";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { ChannelSheet } from "./ChannelSheet";
import { useChannels, useDeleteChannel, useTestChannel } from "./queries";

export function ChannelsSection(): JSX.Element {
  const { t } = useTranslation("notifications");
  const { t: tc } = useTranslation("common");
  const { data = [] } = useChannels();
  const del = useDeleteChannel();
  const testCh = useTestChannel();
  // `undefined` = closed; `null` = new; Channel = edit
  const [editing, setEditing] = useState<Channel | null | undefined>(undefined);
  const [toDelete, setToDelete] = useState<Channel | null>(null);

  const onTest = async (c: Channel) => {
    const res = await testCh.mutateAsync(c.id);
    if (res.ok) toast.success(t("channel.testSuccess"));
    else toast.error(t("channel.testFailure", { error: res.error ?? "" }));
  };

  return (
    <FormSection title={t("channel.sectionTitle")}>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t("channel.columns.name")}</TableHead>
            <TableHead>{t("channel.columns.type")}</TableHead>
            <TableHead>{t("channel.columns.createdAt")}</TableHead>
            <TableHead className="text-right">{t("channel.columns.actions")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.map((c) => (
            <TableRow key={c.id}>
              <TableCell>{c.name}</TableCell>
              <TableCell>{c.type}</TableCell>
              <TableCell>{new Date(c.createdAt).toLocaleString()}</TableCell>
              <TableCell className="text-right space-x-2">
                <Button size="sm" variant="ghost" onClick={() => setEditing(c)}>
                  {t("channel.editButton")}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => onTest(c)}
                  disabled={testCh.isPending}
                >
                  {t("channel.testButton")}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setToDelete(c)}>
                  {t("channel.deleteButton")}
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <div className="mt-3">
        <Button onClick={() => setEditing(null)}>{t("channel.newButton")}</Button>
      </div>

      <ChannelSheet
        open={editing !== undefined}
        onOpenChange={(open) => !open && setEditing(undefined)}
        channel={editing ?? null}
      />

      <AlertDialog open={!!toDelete} onOpenChange={(open) => !open && setToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("delete.channelTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{t("delete.channelDescription")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tc("actions.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={async () => {
                if (toDelete) await del.mutateAsync(toDelete.id);
                setToDelete(null);
              }}
            >
              {t("channel.deleteButton")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </FormSection>
  );
}
