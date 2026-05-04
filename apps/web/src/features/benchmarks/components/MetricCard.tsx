import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export interface MetricRow {
  label: string;
  value: string | number | null | undefined;
}

export interface MetricCardProps {
  title: string;
  rows: MetricRow[];
}

function fmt(v: MetricRow["value"]): string {
  if (v === null || v === undefined) return "—";
  return String(v);
}

export function MetricCard({ title, rows }: MetricCardProps) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-1 pt-0">
        {rows.map((r) => (
          <div key={r.label} className="flex justify-between text-sm">
            <span className="text-muted-foreground">{r.label}</span>
            <span className="font-medium tabular-nums">{fmt(r.value)}</span>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
