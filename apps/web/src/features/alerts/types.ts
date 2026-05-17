// Local types — alerts contract not yet promoted to @modeldoctor/contracts.
// Will move there if/when MCP tools land.

export interface AlertExplanationDto {
  narrative: string;
  recommendations: string[];
  aiSeverity: "critical" | "warning" | "info";
  generatedAt: string;
}

export interface AlertEventDto {
  id: string;
  fingerprint: string;
  status: "firing" | "resolved";
  severity: "critical" | "warning" | "info" | string;
  scenario: string | null;
  alertName: string;
  connectionId: string | null;
  modelName: string | null;
  engine: string | null;
  instance: string | null;
  labels: Record<string, string>;
  annotations: Record<string, string>;
  startsAt: string;
  endsAt: string | null;
  receivedAt: string;
  explanation: AlertExplanationDto | null;
}

export interface ListAlertsQuery {
  connectionId?: string;
  status?: "firing" | "resolved";
  severity?: "critical" | "warning" | "info";
}
