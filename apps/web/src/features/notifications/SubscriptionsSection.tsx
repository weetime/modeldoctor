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
import type { Subscription } from "@modeldoctor/contracts";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useDeleteSubscription, useSubscriptions } from "./queries";
import { SubscriptionDialog } from "./SubscriptionDialog";

export function SubscriptionsSection(): JSX.Element {
  const { t } = useTranslation("notifications");
  const { t: tc } = useTranslation("common");
  const { data = [] } = useSubscriptions();
  const del = useDeleteSubscription();
  const [creating, setCreating] = useState(false);
  const [toDelete, setToDelete] = useState<Subscription | null>(null);

  return (
    <FormSection title={t("subscription.sectionTitle")}>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t("subscription.columns.channel")}</TableHead>
            <TableHead>{t("subscription.columns.eventType")}</TableHead>
            <TableHead>{t("subscription.columns.filter")}</TableHead>
            <TableHead className="text-right">
              {t("subscription.columns.actions")}
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.map((s) => (
            <TableRow key={s.id}>
              <TableCell>{s.channelName}</TableCell>
              <TableCell>{t(`subscription.form.events.${s.eventType}`)}</TableCell>
              <TableCell>
                {s.connectionId
                  ? t("subscription.filter.specific", { name: s.connectionId })
                  : t("subscription.filter.anyConnection")}
              </TableCell>
              <TableCell className="text-right">
                <Button size="sm" variant="ghost" onClick={() => setToDelete(s)}>
                  {t("subscription.deleteButton")}
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <div className="mt-3">
        <Button onClick={() => setCreating(true)}>{t("subscription.newButton")}</Button>
      </div>

      <SubscriptionDialog open={creating} onOpenChange={setCreating} />

      <AlertDialog open={!!toDelete} onOpenChange={(open) => !open && setToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("delete.subscriptionTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("delete.subscriptionDescription")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tc("actions.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={async () => {
                if (toDelete) await del.mutateAsync(toDelete.id);
                setToDelete(null);
              }}
            >
              {t("subscription.deleteButton")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </FormSection>
  );
}
