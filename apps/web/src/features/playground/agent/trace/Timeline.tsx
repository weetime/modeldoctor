import { ChevronDown, ChevronRight } from "lucide-react";
import { useEffect, useRef, useState } from "react";
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
 * A reasoning model's chain-of-thought, shown above the answer as a
 * collapsible block (`<details>`-style). Auto-expanded while the model is
 * still thinking (`thinking` — reasoning streaming, no answer yet), then
 * auto-collapsed the moment the answer begins, so the finished bubble reads
 * as a clean answer with the thinking tucked behind a toggle. Mirrors the
 * mainstream reasoning-model UX (ChatGPT / DeepSeek / Claude).
 */
function ReasoningBlock({ reasoning, thinking }: { reasoning: string; thinking: boolean }) {
  const { t } = useTranslation("playground");
  // Expanded while actively thinking (live stream), collapsed-by-default for
  // an already-finished turn (history restore / re-render) — matches the
  // mainstream "Thought for Xs ▸" collapsed default.
  const [open, setOpen] = useState(thinking);
  const wasThinking = useRef(thinking);
  useEffect(() => {
    // Collapse once thinking finishes (the answer has started streaming).
    if (wasThinking.current && !thinking) setOpen(false);
    wasThinking.current = thinking;
  }, [thinking]);

  return (
    <div className="mb-2 rounded-md border border-border/60 bg-muted/30">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-1.5 px-2.5 py-1.5 text-left text-xs font-medium text-muted-foreground"
      >
        {open ? (
          <ChevronDown className="size-3.5 shrink-0" aria-hidden="true" />
        ) : (
          <ChevronRight className="size-3.5 shrink-0" aria-hidden="true" />
        )}
        <span aria-hidden="true">💭</span>
        {thinking ? t("agent.trace.reasoningActive") : t("agent.trace.reasoning")}
      </button>
      {open ? (
        <div className="border-t border-border/60 px-2.5 py-2 text-xs text-muted-foreground">
          <TraceMarkdown>{reasoning || " "}</TraceMarkdown>
        </div>
      ) : null}
    </div>
  );
}

/**
 * A streaming/complete assistant reply — the "chat bubble" rendering of an
 * `assistant_text` timeline item. With no tools armed, the ENTIRE timeline is
 * a sequence of these — that's what makes a no-tools run read as plain chat
 * rather than an agent trace. A reasoning model's
 * chain-of-thought (`reasoning`) renders as a collapsible block above the
 * answer; `thinking` is true only while reasoning is still streaming with no
 * answer text yet.
 */
function AssistantBubble({
  content,
  reasoning,
  thinking,
}: {
  content: string;
  reasoning?: string;
  thinking: boolean;
}) {
  return (
    <div
      data-testid="assistant-bubble"
      className="rounded-md border border-border bg-card px-3 py-2 text-sm"
    >
      {reasoning ? <ReasoningBlock reasoning={reasoning} thinking={thinking} /> : null}
      {content ? <TraceMarkdown>{content}</TraceMarkdown> : null}
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
        if (item.kind === "user_message") {
          return (
            <div
              // biome-ignore lint/suspicious/noArrayIndexKey: append-only timeline list
              key={idx}
              data-testid="user-bubble"
              className="ml-auto max-w-[85%] whitespace-pre-wrap break-words rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground"
            >
              {item.content}
            </div>
          );
        }
        if (item.kind === "assistant_text") {
          return (
            <AssistantBubble
              // biome-ignore lint/suspicious/noArrayIndexKey: append-only timeline list
              key={idx}
              content={item.content}
              reasoning={item.reasoning}
              // Still thinking = reasoning has streamed but no answer text yet
              // and the turn isn't closed.
              thinking={Boolean(item.reasoning) && item.content.length === 0 && !item.closed}
            />
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
