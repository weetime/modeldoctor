import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useConnection, useConnections } from "@/features/connections/queries";
import type { ConnectionPublic } from "@modeldoctor/contracts";
import { useId } from "react";
import { Controller, useFormContext } from "react-hook-form";
import { useTranslation } from "react-i18next";
import type { CreateBenchmarkRequest } from "./schemas";

/**
 * Connection picker + read-only endpoint metadata for the benchmark create
 * dialog. After Phase 5, the form only carries `connectionId`; the API
 * resolves baseUrl / apiKey / model server-side. We still display the
 * connection's metadata read-only as feedback for the user.
 */
export function BenchmarkEndpointFields({
  connectionMissing = false,
}: {
  /** True when duplicating a run whose original connection has been deleted. */
  connectionMissing?: boolean;
}) {
  const { t } = useTranslation("benchmark");
  const { t: tConn } = useTranslation("connections");
  const { control, watch, formState } = useFormContext<CreateBenchmarkRequest>();
  const apiTypeId = useId();
  const connId = useId();

  const listQuery = useConnections();
  const conns: ConnectionPublic[] = listQuery.data ?? [];
  const selectedId = watch("connectionId");
  const { data: selectedConn } = useConnection(selectedId || null);

  const errors = formState.errors;

  return (
    <div className="rounded-md border border-dashed border-border bg-muted/30 p-3 space-y-3">
      <div>
        <Label htmlFor={connId}>{t("create.loadFromConnection")}</Label>
        <Controller
          name="connectionId"
          control={control}
          render={({ field }) => (
            <Select value={field.value ?? ""} onValueChange={field.onChange}>
              <SelectTrigger id={connId} aria-invalid={!!errors.connectionId}>
                <SelectValue placeholder="—" />
              </SelectTrigger>
              <SelectContent>
                {conns.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        />
        {connectionMissing ? (
          <p className="mt-1 text-xs text-destructive">{tConn("dialog.savedConnectionMissing")}</p>
        ) : null}
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div className="col-span-1">
          <Label htmlFor={apiTypeId}>{t("create.fields.apiType")}</Label>
          <Controller
            name="apiType"
            control={control}
            render={({ field }) => (
              <Select value={field.value} onValueChange={field.onChange}>
                <SelectTrigger id={apiTypeId}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="chat">chat</SelectItem>
                  <SelectItem value="completion">completion</SelectItem>
                </SelectContent>
              </Select>
            )}
          />
        </div>
      </div>

      {selectedConn ? (
        <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
          <div>
            <div className="font-semibold">{t("create.fields.apiBaseUrl")}</div>
            <div className="font-mono break-all">{selectedConn.baseUrl}</div>
          </div>
          <div>
            <div className="font-semibold">{t("create.fields.model")}</div>
            <div className="font-mono break-all">{selectedConn.model}</div>
          </div>
          <div>
            <div className="font-semibold">{t("create.fields.apiKey")}</div>
            <div className="font-mono">{selectedConn.apiKeyPreview}</div>
          </div>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">{t("create.pickConnectionHint")}</p>
      )}
    </div>
  );
}
