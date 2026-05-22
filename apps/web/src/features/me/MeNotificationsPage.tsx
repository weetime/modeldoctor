import type { Channel } from "@modeldoctor/contracts";
import { Pencil, Trash2 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
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
import { ChannelSheet } from "@/features/notifications/ChannelSheet";
import { useChannels, useDeleteChannel, useTestChannel } from "@/features/notifications/queries";

export function MeNotificationsPage(): JSX.Element {
  const { t: tMe } = useTranslation("me");
  const { t: tn } = useTranslation("notifications");
  const { t: tc } = useTranslation("common");
  const { data = [] } = useChannels();
  const del = useDeleteChannel();
  const testCh = useTestChannel();
  const [editing, setEditing] = useState<Channel | null | undefined>(undefined);
  const [toDelete, setToDelete] = useState<Channel | null>(null);

  const onTest = async (c: Channel) => {
    const res = await testCh.mutateAsync(c.id);
    if (res.ok) toast.success(tn("channel.testSuccess"));
    else toast.error(tn("channel.testFailure", { error: res.error ?? "" }));
  };

  return (
    <>
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            {tMe("notifications.page.title")}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">{tMe("notifications.page.subtitle")}</p>
        </div>
        <Button size="sm" onClick={() => setEditing(null)}>
          {tn("channel.newButton")}
        </Button>
      </div>

      <div className="rounded-lg border border-border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{tn("channel.columns.name")}</TableHead>
              <TableHead>{tn("channel.columns.type")}</TableHead>
              <TableHead>{tn("channel.columns.createdAt")}</TableHead>
              <TableHead className="w-[160px] text-right">
                {tn("channel.columns.actions")}
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.map((c) => (
              <TableRow key={c.id}>
                <TableCell>
                  <button
                    type="button"
                    className="font-medium text-foreground hover:underline"
                    onClick={() => setEditing(c)}
                  >
                    {c.name}
                  </button>
                </TableCell>
                <TableCell className="text-muted-foreground">{c.type}</TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {new Date(c.createdAt).toLocaleString()}
                </TableCell>
                <TableCell className="text-right">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => onTest(c)}
                    disabled={testCh.isPending}
                  >
                    {tn("channel.testButton")}
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={tn("channel.editButton")}
                    onClick={() => setEditing(c)}
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={tn("channel.deleteButton")}
                    onClick={() => setToDelete(c)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <ChannelSheet
        open={editing !== undefined}
        onOpenChange={(open) => !open && setEditing(undefined)}
        channel={editing ?? null}
      />

      <AlertDialog open={!!toDelete} onOpenChange={(open) => !open && setToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{tn("delete.channelTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{tn("delete.channelDescription")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tc("actions.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={async () => {
                if (toDelete) await del.mutateAsync(toDelete.id);
                setToDelete(null);
              }}
            >
              {tn("channel.deleteButton")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
