import type { AgentStep, AgentVerdict } from "@modeldoctor/contracts";
import { useTranslation } from "react-i18next";
import type { PendingInlineTool, PendingMcpApproval } from "../store";
import { ApprovalCard, PendingToolCard, StepCard, VerdictCard } from "./StepCard";

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
}: TraceTimelineProps) {
  const { t } = useTranslation("playground");

  if (steps.length === 0 && !pendingInlineTool && !pendingApproval && !verdict) {
    return (
      <div className="flex h-full items-center justify-center px-6 text-sm text-muted-foreground">
        {t("agent.trace.empty")}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 overflow-y-auto px-6 py-4">
      {steps.map((step, idx) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: append-only trace list
        <StepCard key={idx} step={step} />
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
    </div>
  );
}
