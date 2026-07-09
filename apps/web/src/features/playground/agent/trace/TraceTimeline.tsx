import type { AgentStep, AgentVerdict } from "@modeldoctor/contracts";
import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import type { PendingInlineTool, PendingMcpApproval } from "../store";
import { ApprovalCard, formatElapsed, PendingToolCard, StepCard, VerdictCard } from "./StepCard";

export interface TraceTimelineProps {
  steps: AgentStep[];
  pendingInlineTool: PendingInlineTool | null;
  onSubmitToolResult: (resultContent: string) => void;
  submittingToolResult?: boolean;
  pendingApproval: PendingMcpApproval | null;
  onApproveMcp: () => void;
  onRejectMcp: () => void;
  /** Set only on a true run completion when a judge provider is configured (Task 13). */
  verdict?: AgentVerdict | null;
  /** Map of MCP server id → display name, for server badges on MCP tool steps. */
  mcpServerNames?: Record<string, string>;
}

/** A compact "N tools · M turns · X.Xs" summary bar above the trace. */
function RunSummary({ steps }: { steps: AgentStep[] }) {
  const { t } = useTranslation("playground");
  const toolCalls = steps.filter((s) => s.kind === "tool_call").length;
  const turns = steps.filter((s) => s.kind === "assistant" || s.kind === "plan").length;
  const errors = steps.filter((s) => s.kind === "error").length;
  const totalMs = steps.reduce((max, s) => Math.max(max, s.tMs), 0);
  return (
    <div className="mb-1 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-border bg-muted/40 px-3 py-1.5 text-xs text-muted-foreground">
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
 * Vertical list of `StepCard`s, plus the pending inline-tool card and/or the
 * pending MCP approval card at the end (both can't be pending at once — the
 * loop returns after the first one it encounters in a turn), and — on a run
 * that actually completed with a judge configured — the `VerdictCard` last
 * of all.
 */
export function TraceTimeline({
  steps,
  pendingInlineTool,
  onSubmitToolResult,
  submittingToolResult,
  pendingApproval,
  onApproveMcp,
  onRejectMcp,
  verdict,
  mcpServerNames,
}: TraceTimelineProps) {
  const { t } = useTranslation("playground");

  // Keep the newest step/card in view as the trace streams in.
  const endRef = useRef<HTMLDivElement>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll on any trace growth — step count, a pending card appearing, or the verdict landing
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  }, [steps.length, pendingInlineTool, pendingApproval, verdict]);

  if (steps.length === 0 && !pendingInlineTool && !pendingApproval && !verdict) {
    return (
      <div className="flex h-full items-center justify-center px-6 text-sm text-muted-foreground">
        {t("agent.trace.empty")}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 overflow-y-auto px-6 py-4">
      {steps.length > 0 ? <RunSummary steps={steps} /> : null}
      {steps.map((step, idx) => (
        <StepCard
          // biome-ignore lint/suspicious/noArrayIndexKey: append-only trace list
          key={idx}
          step={step}
          index={idx + 1}
          prevTMs={idx > 0 ? steps[idx - 1].tMs : 0}
          mcpServerNames={mcpServerNames}
        />
      ))}
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
      {verdict ? <VerdictCard verdict={verdict} /> : null}
      <div ref={endRef} />
    </div>
  );
}
