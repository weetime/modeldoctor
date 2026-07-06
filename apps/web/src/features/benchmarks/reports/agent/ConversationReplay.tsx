import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import type { Tau3Message, Tau3Simulation } from "./queries";
import { useTrajectory } from "./queries";

export interface ConversationReplayProps {
  benchmarkId: string;
  simId: string;
  domain: string;
  variant: "success" | "failure";
}

function stringifyArgs(args: Record<string, unknown> | string | undefined): string {
  if (args == null) return "";
  if (typeof args === "string") return args;
  try {
    return JSON.stringify(args);
  } catch {
    return String(args);
  }
}

/**
 * Turn indices in `sim` that should be highlighted as "the faulty turn" when
 * `variant === "failure"`. Prefers `reward_info.action_checks` entries with
 * `action_match === false` — matched to the assistant message(s) whose
 * `tool_calls` include that action's name. Falls back to the last assistant
 * turn when no action_checks are present (or none failed), since a task can
 * also fail without a mismatched tool call (e.g. missing final answer).
 */
function computeFaultyIndices(sim: Tau3Simulation): Set<number> {
  const failedActionNames = new Set(
    (sim.reward_info?.action_checks ?? [])
      .filter((c) => c.action_match === false)
      .map((c) => c.action?.name)
      .filter((name): name is string => Boolean(name)),
  );

  const indices = new Set<number>();
  if (failedActionNames.size > 0) {
    sim.messages.forEach((m, idx) => {
      if (m.role !== "assistant") return;
      const calls = m.tool_calls ?? [];
      if (calls.some((tc) => failedActionNames.has(tc.name))) indices.add(idx);
    });
  }

  if (indices.size === 0) {
    for (let i = sim.messages.length - 1; i >= 0; i -= 1) {
      if (sim.messages[i]?.role === "assistant") {
        indices.add(i);
        break;
      }
    }
  }

  return indices;
}

function MessageBubble({
  message,
  isFaulty,
}: {
  message: Tau3Message;
  isFaulty: boolean;
}) {
  const { t } = useTranslation("benchmarks");
  return (
    <div
      data-testid={isFaulty ? "faulty-turn" : undefined}
      className={cn(
        "rounded-md border p-3",
        isFaulty ? "border-destructive bg-destructive/5" : "border-border bg-card",
      )}
    >
      <div className="mb-1 flex items-center gap-2 text-xs font-semibold text-muted-foreground">
        <span>{t(`reports.agent.replay.roles.${message.role}`)}</span>
        {isFaulty ? (
          <span className="rounded-full border border-destructive/30 bg-destructive/10 px-2 py-0.5 text-destructive">
            {t("reports.agent.replay.faultyTurn")}
          </span>
        ) : null}
      </div>
      {message.content ? (
        <div className="whitespace-pre-wrap text-sm">{message.content}</div>
      ) : null}
      {(message.tool_calls ?? []).map((tc, idx) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: append-only tool-call list within a single message
        <div key={idx} className="mt-2 rounded border border-border bg-muted/40 p-2 font-mono text-xs">
          <span className="font-semibold">{tc.name}</span>
          <span className="text-muted-foreground">({stringifyArgs(tc.arguments)})</span>
        </div>
      ))}
    </div>
  );
}

/**
 * τ²-bench conversation replay: renders a single simulation's `messages[]`
 * as chat bubbles (mirroring `playground/chat/MessageList`'s bubble style),
 * with a task-picker to switch to any other sim in the same domain. When
 * `variant === "failure"`, the faulty turn (derived from `reward_info
 * .action_checks`, or the last assistant turn as fallback) is highlighted.
 *
 * Standalone for Task 12 — Task 13 mounts this into `AgentReport`'s
 * `agent-report-replay-slot` placeholder.
 */
export function ConversationReplay({ benchmarkId, simId, domain, variant }: ConversationReplayProps) {
  const { t } = useTranslation("benchmarks");
  const { data, simsById, isLoading, isError } = useTrajectory(benchmarkId, domain);
  const [selectedSimId, setSelectedSimId] = useState(simId);

  // Re-sync when the caller points us at a different sim (e.g. success vs.
  // failure highlight toggled elsewhere) — but don't clobber the user's own
  // picker choice on every unrelated re-render.
  useEffect(() => {
    setSelectedSimId(simId);
  }, [simId]);

  if (isLoading) {
    return (
      <div className="p-6 text-center text-sm text-muted-foreground">
        {t("reports.agent.replay.loading")}
      </div>
    );
  }
  if (isError) {
    return (
      <div className="p-6 text-center text-sm text-destructive">
        {t("reports.agent.replay.error")}
      </div>
    );
  }

  const sim = simsById.get(selectedSimId);
  const allSims = data?.simulations ?? [];

  if (!sim) {
    return (
      <div className="p-6 text-center text-sm text-muted-foreground">
        {t("reports.agent.replay.notFound")}
      </div>
    );
  }

  const faultyIndices = variant === "failure" ? computeFaultyIndices(sim) : new Set<number>();

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <span className="text-xs font-medium text-muted-foreground">
          {t("reports.agent.replay.taskPicker")}
        </span>
        <Select value={selectedSimId} onValueChange={setSelectedSimId}>
          <SelectTrigger className="w-64">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {allSims.map((s) => (
              <SelectItem key={s.id} value={s.id}>
                {s.task_id} (trial {s.trial})
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex flex-col gap-3">
        {sim.messages.map((m, idx) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: append-only chat list
          <MessageBubble key={idx} message={m} isFaulty={faultyIndices.has(idx)} />
        ))}
      </div>
    </div>
  );
}
