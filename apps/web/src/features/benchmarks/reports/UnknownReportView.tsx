import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

export interface UnknownReportViewProps {
  raw: unknown;
  reason: string;
}

export function UnknownReportView({ raw, reason }: UnknownReportViewProps) {
  return (
    <Alert className="border-amber-300 bg-amber-50/50 dark:bg-amber-950/20">
      <AlertTitle>Report shape not recognized</AlertTitle>
      <AlertDescription className="space-y-2">
        <div className="text-xs text-muted-foreground">{reason}</div>
        <pre className="overflow-x-auto rounded bg-muted/50 p-2 text-xs">
          {JSON.stringify(raw, null, 2)}
        </pre>
      </AlertDescription>
    </Alert>
  );
}
