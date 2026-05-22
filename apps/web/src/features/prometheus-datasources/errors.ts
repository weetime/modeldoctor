import { toast } from "sonner";
import { ApiError } from "@/lib/api-client";

/**
 * Per-code i18n mapper for ConflictException errors raised by
 * /api/prometheus-datasources/{POST,PATCH,DELETE,set-default}. The api
 * surfaces these via `ApiError.code` (see api-client.ts), so we branch on
 * the known code strings; everything else falls back to a generic toast.
 *
 * `t` is the i18next `t` bound to the "prometheus-datasources" namespace.
 */
export function toastDatasourceError(
  t: (key: string, opts?: Record<string, unknown>) => string,
  e: unknown,
): void {
  const code = e instanceof ApiError ? e.code : undefined;
  if (code === "PROMETHEUS_DATASOURCE_NAME_TAKEN") {
    toast.error(t("toast.errors.nameTaken"));
    return;
  }
  if (code === "PROMETHEUS_DATASOURCE_BASEURL_TAKEN") {
    toast.error(t("toast.errors.baseUrlTaken"));
    return;
  }
  const message = e instanceof Error ? e.message : "";
  toast.error(t("toast.errors.generic", { message }));
}
