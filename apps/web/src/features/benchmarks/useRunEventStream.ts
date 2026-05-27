import { useEffect, useRef, useState } from "react";
import { useAuthStore } from "@/stores/auth-store";

export type LogEvent = { kind: "log"; level: "info" | "warn" | "error"; line: string };

const MAX_LINES = 2000;

/**
 * Opens an EventSource to /api/benchmarks/:id/events and collects log lines
 * while the benchmark is in flight. Closes automatically when `enabled`
 * becomes false (i.e. the benchmark reaches a terminal status).
 *
 * Auth: JWT is passed as `?token=` because EventSource cannot set headers.
 * The server's JwtStrategy accepts it via fromExtractors.
 */
export function useRunEventStream(runId: string | undefined, enabled: boolean): LogEvent[] {
  const [lines, setLines] = useState<LogEvent[]>([]);
  const token = useAuthStore((s) => s.accessToken);
  const esRef = useRef<EventSource | null>(null);

  // Reset lines when switching to a different run
  useEffect(() => {
    setLines([]);
  }, [runId]);

  useEffect(() => {
    if (!runId || !enabled || !token) {
      esRef.current?.close();
      esRef.current = null;
      return;
    }

    const url = `/api/benchmarks/${encodeURIComponent(runId)}/events?token=${encodeURIComponent(token)}`;
    const es = new EventSource(url);
    esRef.current = es;

    es.onmessage = (e) => {
      try {
        const evt = JSON.parse(e.data as string) as {
          kind?: string;
          level?: string;
          line?: string;
        };
        if (evt.kind === "log" && typeof evt.line === "string") {
          setLines((prev) => {
            const next = [...prev, evt as LogEvent];
            return next.length > MAX_LINES ? next.slice(next.length - MAX_LINES) : next;
          });
        }
      } catch {
        // ignore malformed frames
      }
    };

    return () => {
      es.close();
      esRef.current = null;
    };
  }, [runId, enabled, token]);

  return lines;
}
