import { z } from "zod";

// Alertmanager webhook payload v4. Spec:
// https://prometheus.io/docs/alerting/latest/configuration/#webhook_config
// One POST may carry multiple alerts (groupKey-bundled).
export const alertmanagerAlertSchema = z.object({
  status: z.enum(["firing", "resolved"]),
  labels: z.record(z.string()),
  annotations: z.record(z.string()),
  startsAt: z.string().datetime({ offset: true }),
  endsAt: z.string().datetime({ offset: true }).optional(),
  generatorURL: z.string().optional(),
  fingerprint: z.string().min(1),
});

export const alertmanagerPayloadSchema = z.object({
  version: z.string(),
  groupKey: z.string(),
  // optional: truncatedAlerts, receiver, status (group-level), groupLabels,
  // commonLabels, commonAnnotations, externalURL — we accept and ignore.
  alerts: z.array(alertmanagerAlertSchema).min(1),
});

export type AlertmanagerPayload = z.infer<typeof alertmanagerPayloadSchema>;
export type AlertmanagerAlert = z.infer<typeof alertmanagerAlertSchema>;

export const listAlertsQuerySchema = z.object({
  connectionId: z.string().optional(),
  status: z.enum(["firing", "resolved"]).optional(),
  severity: z.enum(["critical", "warning", "info"]).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().optional(),
});

export type ListAlertsQuery = z.infer<typeof listAlertsQuerySchema>;
