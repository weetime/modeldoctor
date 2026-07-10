import { ArrowDown, ChevronDown, ChevronRight, Pencil } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { PendingInlineTool, PendingMcpApproval } from "../store";
import type { TimelineItem, TurnUsage } from "../timeline";
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
  /**
   * Edit + resend the Nth user turn (0-indexed by user-message order). Called
   * from the inline editor on a user bubble; the parent truncates everything
   * after that turn and re-sends the edited text. Absent → bubbles aren't
   * editable (e.g. while a run is in flight).
   */
  onEditUserMessage?: (userOrdinal: number, text: string) => void;
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
  usage,
  tMs,
}: {
  content: string;
  reasoning?: string;
  thinking: boolean;
  usage?: TurnUsage;
  tMs?: number;
}) {
  const { t } = useTranslation("playground");
  // Per-turn metadata footer: tokens (↑ prompt · ↓ completion) + latency.
  const metaParts: string[] = [];
  if (usage?.promptTokens != null || usage?.completionTokens != null) {
    metaParts.push(
      t("agent.trace.tokens", {
        prompt: usage?.promptTokens ?? 0,
        completion: usage?.completionTokens ?? 0,
      }),
    );
  }
  if (tMs != null) metaParts.push(formatElapsed(tMs));

  return (
    <div
      data-testid="assistant-bubble"
      className="rounded-md border border-border bg-card px-3 py-2 text-sm"
    >
      {reasoning ? <ReasoningBlock reasoning={reasoning} thinking={thinking} /> : null}
      {content ? <TraceMarkdown>{content}</TraceMarkdown> : null}
      {metaParts.length > 0 ? (
        <div
          data-testid="turn-meta"
          className="mt-1.5 border-t border-border/50 pt-1 text-[11px] text-muted-foreground"
        >
          {metaParts.join(" · ")}
        </div>
      ) : null}
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
  onEditUserMessage,
}: TimelineProps) {
  const { t } = useTranslation("playground");

  // Inline user-message edit state: which user turn (ordinal) is being edited
  // and its working draft.
  const [editing, setEditing] = useState<{ ordinal: number; draft: string } | null>(null);

  // Auto-follow the newest content as it streams — but ONLY while the user is
  // already near the bottom. If they scroll up to read earlier turns, don't
  // yank them back down; a jump-to-bottom button appears instead.
  const scrollRef = useRef<HTMLDivElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const [atBottom, setAtBottom] = useState(true);
  // Ref mirror so the auto-follow effect reads the latest value without
  // re-subscribing on every scroll.
  const atBottomRef = useRef(true);
  const NEAR_BOTTOM_PX = 80;
  const updateAtBottom = () => {
    const el = scrollRef.current;
    if (!el) return;
    const near = el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX;
    atBottomRef.current = near;
    setAtBottom(near);
  };
  // Depends on the whole `timeline` array (a new ref on every streamed delta,
  // since `reduceEvent` is immutable) so streaming text follows smoothly.
  // biome-ignore lint/correctness/useExhaustiveDependencies: follow on any timeline/pending change; atBottom is read via ref
  useEffect(() => {
    if (atBottomRef.current) endRef.current?.scrollIntoView({ block: "end" });
  }, [timeline, pendingInlineTool, pendingApproval]);
  const scrollToBottom = () => {
    endRef.current?.scrollIntoView({ block: "end", behavior: "smooth" });
    atBottomRef.current = true;
    setAtBottom(true);
  };

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

  // Map each user_message timeline index → its 0-based ordinal among user
  // turns, so the inline editor can tell the parent which turn to resend.
  const userOrdinalByIndex = new Map<number, number>();
  {
    let n = 0;
    timeline.forEach((it, i) => {
      if (it.kind === "user_message") {
        userOrdinalByIndex.set(i, n);
        n += 1;
      }
    });
  }

  return (
    <div className="relative h-full">
      <div
        ref={scrollRef}
        onScroll={updateAtBottom}
        className="flex h-full flex-col gap-2 overflow-y-auto px-6 py-4"
      >
        {planItem?.step.content ? <PlanStrip content={planItem.step.content} /> : null}
        {hasTrace ? <RunSummary stepItems={stepItems} assistantTurns={assistantTurns} /> : null}
        {timeline.map((item, idx) => {
          if (item === planItem) return null;
          if (item.kind === "user_message") {
            const ordinal = userOrdinalByIndex.get(idx) ?? 0;
            const bubbleContent = item.content;
            if (editing?.ordinal === ordinal) {
              return (
                // biome-ignore lint/suspicious/noArrayIndexKey: append-only timeline list
                <div key={idx} className="ml-auto w-full max-w-[85%] space-y-1.5">
                  <Textarea
                    data-testid="user-edit-textarea"
                    value={editing.draft}
                    onChange={(e) => setEditing({ ordinal, draft: e.target.value })}
                    rows={3}
                    className="text-sm"
                    autoFocus
                  />
                  <div className="flex justify-end gap-2">
                    <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>
                      {t("agent.trace.cancelEdit")}
                    </Button>
                    <Button
                      size="sm"
                      disabled={editing.draft.trim().length === 0}
                      onClick={() => {
                        onEditUserMessage?.(ordinal, editing.draft);
                        setEditing(null);
                      }}
                    >
                      {t("agent.trace.resend")}
                    </Button>
                  </div>
                </div>
              );
            }
            return (
              // biome-ignore lint/suspicious/noArrayIndexKey: append-only timeline list
              <div key={idx} className="group ml-auto flex max-w-[85%] items-start gap-1.5">
                {onEditUserMessage ? (
                  <button
                    type="button"
                    onClick={() => setEditing({ ordinal, draft: bubbleContent })}
                    aria-label={t("agent.trace.editMessage")}
                    className="mt-1 shrink-0 text-muted-foreground opacity-0 transition group-hover:opacity-100 hover:text-foreground"
                  >
                    <Pencil className="size-3.5" aria-hidden="true" />
                  </button>
                ) : null}
                <div
                  data-testid="user-bubble"
                  className="whitespace-pre-wrap break-words rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground"
                >
                  {bubbleContent}
                </div>
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
                usage={item.usage}
                tMs={item.tMs}
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
          <ApprovalCard
            approval={pendingApproval}
            onApprove={onApproveMcp}
            onReject={onRejectMcp}
          />
        ) : null}
        <div ref={endRef} />
      </div>
      {!atBottom ? (
        <button
          type="button"
          onClick={scrollToBottom}
          aria-label={t("agent.trace.scrollToBottom")}
          className="absolute bottom-3 right-4 flex size-8 items-center justify-center rounded-full border border-border bg-background/90 text-muted-foreground shadow-sm backdrop-blur transition hover:text-foreground"
        >
          <ArrowDown className="size-4" aria-hidden="true" />
        </button>
      ) : null}
    </div>
  );
}
