import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import type { PendingInlineTool, PendingMcpApproval } from "../store";
import type { TimelineItem } from "../timeline";
import { PlanStrip } from "./PlanStrip";
import { ApprovalCard, formatElapsed, PendingToolCard, StepCard, VerdictCard } from "./StepCard";
import { TraceMarkdown } from "./TraceMarkdown";

export interface TimelineProps {
  timeline: TimelineItem[];
  pendingInlineTool: PendingInlineTool | null;
  onSubmitToolResult: (resultContent: string) => void;
  submittingToolResult?: boolean;
  pendingApproval: PendingMcpApproval | null;
  onApproveMcp: () => void;
  onRejectMcp: () => void;
  /** Map of MCP server id → display name, for server badges on MCP tool steps. */
  mcpServerNames?: Record<string, string>;
}

/** The subset of `TimelineItem` that wraps a full `AgentStep` (the trace-card kinds). */
type StepItem = Extract<TimelineItem, { kind: "tool_call" | "tool_result" | "plan" | "error" }>;

/** A compact "N tools · M turns · X.Xs" summary bar above the timeline. */
function RunSummary({
  stepItems,
  assistantTurns,
}: {
  stepItems: StepItem[];
  assistantTurns: number;
}) {
  const { t } = useTranslation("playground");
  const toolCalls = stepItems.filter((i) => i.kind === "tool_call").length;
  const planTurns = stepItems.filter((i) => i.kind === "plan").length;
  const errors = stepItems.filter((i) => i.kind === "error").length;
  const totalMs = stepItems.reduce((max, i) => Math.max(max, i.step.tMs), 0);
  const turns = assistantTurns + planTurns;
  return (
    <div
      data-testid="run-summary"
      className="mb-1 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-border bg-muted/40 px-3 py-1.5 text-xs text-muted-foreground"
    >
      <span className="flex items-center gap-1">
        <span aria-hidden="true">🔧</span>
        {t("agent.trace.summaryTools", { count: toolCalls })}
      </span>
      <span className="flex items-center gap-1">
        <span aria-hidden="true">💬</span>
        {t("agent.trace.summaryTurns", { count: turns })}
      </span>
      <span className="flex items-center gap-1">
        <span aria-hidden="true">⏱</span>
        {formatElapsed(totalMs)}
      </span>
      {errors > 0 ? (
        <span className="flex items-center gap-1 text-destructive">
          <span aria-hidden="true">⚠️</span>
          {t("agent.trace.summaryErrors", { count: errors })}
        </span>
      ) : null}
    </div>
  );
}

/**
 * A streaming/complete assistant reply — the "chat bubble" rendering of an
 * `assistant_text` timeline item. When `toolsEnabled` is off, the ENTIRE
 * timeline is a sequence of these — that's what makes a tools-off run read
 * as plain chat rather than an agent trace.
 */
function AssistantBubble({ content }: { content: string }) {
  return (
    <div
      data-testid="assistant-bubble"
      className="rounded-md border border-border bg-card px-3 py-2 text-sm"
    >
      <TraceMarkdown>{content || " "}</TraceMarkdown>
    </div>
  );
}

/**
 * Renders the unified playground's `timeline: TimelineItem[]` (Task 5's
 * `reduceEvent` output) — successor to the legacy `TraceTimeline`, which
 * rendered the `AgentStep[]`-only `steps` list. `assistant_text` items become
 * markdown chat bubbles; `tool_call`/`tool_result`/`error` become
 * `StepCard`s; the first `plan` item is pinned as a `PlanStrip` (mirroring
 * `TraceTimeline`'s plan-pinning); `verdict` becomes a `VerdictCard`.
 * Tools-off runs only ever produce `assistant_text` items, so this renders as
 * plain streaming chat; tools-on runs interleave bubbles with trace cards.
 */
export function Timeline({
  timeline,
  pendingInlineTool,
  onSubmitToolResult,
  submittingToolResult,
  pendingApproval,
  onApproveMcp,
  onRejectMcp,
  mcpServerNames,
}: TimelineProps) {
  const { t } = useTranslation("playground");

  // Keep the newest bubble/card in view as the timeline streams in.
  const endRef = useRef<HTMLDivElement>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll on any timeline growth or a pending card appearing
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  }, [timeline.length, pendingInlineTool, pendingApproval]);

  if (timeline.length === 0 && !pendingInlineTool && !pendingApproval) {
    return (
      <div className="flex h-full items-center justify-center px-6 text-sm text-muted-foreground">
        {t("agent.trace.empty")}
      </div>
    );
  }

  // The first `plan` item (emitted on turn 0 when "Plan first" is on) is
  // surfaced as a pinned checklist strip at the top instead of inline, so it
  // stays visible as the timeline scrolls. It's filtered from the inline list
  // below to avoid duplication; original step-item positions are kept so
  // step numbers and per-step durations stay correct (mirrors the legacy
  // `TraceTimeline`'s plan-pinning behavior).
  const stepItems = timeline.filter(
    (i): i is StepItem =>
      i.kind === "tool_call" || i.kind === "tool_result" || i.kind === "plan" || i.kind === "error",
  );
  const planItem = stepItems.find((i) => i.kind === "plan");
  const assistantTurns = timeline.filter((i) => i.kind === "assistant_text").length;
  // A tools-off run's timeline is nothing but `assistant_text` bubbles — no
  // actual agent trace to summarize. Only show the summary bar once there's
  // at least one tool/plan/error step item, so tools-off keeps reading as
  // plain chat (see the module doc comment above).
  const hasTrace = stepItems.length > 0;

  return (
    <div className="flex flex-col gap-2 overflow-y-auto px-6 py-4">
      {planItem?.step.content ? <PlanStrip content={planItem.step.content} /> : null}
      {hasTrace ? <RunSummary stepItems={stepItems} assistantTurns={assistantTurns} /> : null}
      {timeline.map((item, idx) => {
        if (item === planItem) return null;
        if (item.kind === "assistant_text") {
          return (
            // biome-ignore lint/suspicious/noArrayIndexKey: append-only timeline list
            <AssistantBubble key={idx} content={item.content} />
          );
        }
        if (item.kind === "verdict") {
          // biome-ignore lint/suspicious/noArrayIndexKey: append-only timeline list
          return <VerdictCard key={idx} verdict={item.verdict} />;
        }
        const stepIdx = stepItems.indexOf(item);
        const prevTMs = stepIdx > 0 ? stepItems[stepIdx - 1].step.tMs : 0;
        return (
          <StepCard
            // biome-ignore lint/suspicious/noArrayIndexKey: append-only timeline list
            key={idx}
            step={item.step}
            index={stepIdx + 1}
            prevTMs={prevTMs}
            mcpServerNames={mcpServerNames}
          />
        );
      })}
      {pendingInlineTool ? (
        <PendingToolCard
          tool={pendingInlineTool}
          onSubmit={onSubmitToolResult}
          submitting={submittingToolResult}
        />
      ) : null}
      {pendingApproval ? (
        <ApprovalCard approval={pendingApproval} onApprove={onApproveMcp} onReject={onRejectMcp} />
      ) : null}
      <div ref={endRef} />
    </div>
  );
}
