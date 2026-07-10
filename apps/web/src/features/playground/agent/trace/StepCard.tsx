import type { AgentStep, AgentVerdict } from "@modeldoctor/contracts";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { PendingInlineTool, PendingMcpApproval } from "../store";
import { TraceMarkdown } from "./TraceMarkdown";

const KIND_ICON: Record<AgentStep["kind"], string> = {
  plan: "🧠",
  tool_call: "🔧",
  tool_result: "📥",
  assistant: "💬",
  error: "⚠️",
};

const KIND_STYLE: Record<AgentStep["kind"], string> = {
  plan: "border-border bg-card",
  tool_call: "border-border bg-card",
  tool_result: "border-border bg-card",
  assistant: "border-border bg-card",
  error: "border-destructive/40 bg-destructive/10",
};

const MCP_PREFIX = "mcp__";

/** A parsed tool name: the clean tool label + its source (MCP server id, or "builtin"). */
export interface ToolLabel {
  toolName: string;
  serverId?: string;
}

/** `mcp__<serverId>__list_tenants` → { toolName: "list_tenants", serverId }. Plain names pass through. */
export function parseToolLabel(name: string): ToolLabel {
  if (!name.startsWith(MCP_PREFIX)) return { toolName: name };
  const rest = name.slice(MCP_PREFIX.length);
  const sep = rest.indexOf("__");
  if (sep < 0) return { toolName: rest };
  return { serverId: rest.slice(0, sep), toolName: rest.slice(sep + 2) };
}

/** Cumulative elapsed ms since run start → "1.2s" (≥1s) or "840ms". */
export function formatElapsed(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`;
}

/** Pretty-print a tool-result string as JSON when possible; else return as-is. */
function prettyMaybeJson(raw: string): { pretty: string; summary: string } {
  try {
    const parsed = JSON.parse(raw);
    const pretty = JSON.stringify(parsed, null, 2);
    let summary: string;
    if (Array.isArray(parsed)) summary = `[] · ${parsed.length}`;
    else if (parsed && typeof parsed === "object") summary = `{} · ${Object.keys(parsed).length}`;
    else summary = String(parsed).slice(0, 60);
    return { pretty, summary };
  } catch {
    return { pretty: raw, summary: raw.replace(/\s+/g, " ").slice(0, 60) };
  }
}

/** Collapsed-by-default block for a (usually large, JSON) tool result. */
function ResultBlock({ content }: { content: string }) {
  const { t } = useTranslation("playground");
  const [open, setOpen] = useState(false);
  const { pretty, summary } = prettyMaybeJson(content);
  const sizeKb = (new Blob([content]).size / 1024).toFixed(1);
  return (
    <div className="mt-1">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-1.5 text-left text-xs text-muted-foreground hover:text-foreground"
      >
        <span aria-hidden="true">{open ? "▾" : "▸"}</span>
        <span className="font-mono">{summary}</span>
        <span className="ml-auto shrink-0">{t("agent.trace.resultSize", { kb: sizeKb })}</span>
      </button>
      {open ? (
        <pre className="mt-1 max-h-72 overflow-auto rounded bg-muted p-2 font-mono text-xs text-muted-foreground">
          {pretty}
        </pre>
      ) : null}
    </div>
  );
}

export interface StepCardProps {
  step: AgentStep;
  /** 1-based index shown in the timeline rail. */
  index: number;
  /** Map of MCP server id → display name, for the server badge on MCP tool steps. */
  mcpServerNames?: Record<string, string>;
  /**
   * Cumulative elapsed ms of the PREVIOUS step (0 for the first). The card
   * shows this step's own duration (`step.tMs - prevTMs`) — more useful than
   * the raw cumulative for spotting which step was slow — with the cumulative
   * elapsed available on hover.
   */
  prevTMs?: number;
}

/**
 * Renders one AgentStep: a numbered timeline dot, a clean tool label (the
 * `mcp__<id>__` prefix stripped, source shown as a badge), elapsed time, and a
 * kind-specific body — markdown for assistant/plan, a collapsible pretty-JSON
 * block for tool results, small pretty args for tool calls.
 */
export function StepCard({ step, index, mcpServerNames, prevTMs = 0 }: StepCardProps) {
  const { t } = useTranslation("playground");
  const label = step.name ? parseToolLabel(step.name) : null;
  const serverName = label?.serverId ? (mcpServerNames?.[label.serverId] ?? "MCP") : null;
  const stepMs = Math.max(0, step.tMs - prevTMs);

  return (
    <div className="flex gap-3">
      {/* Timeline rail: numbered dot + connecting line. */}
      <div className="flex flex-col items-center">
        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-border bg-card text-[10px] text-muted-foreground">
          {index}
        </span>
        <span className="mt-1 w-px flex-1 bg-border" />
      </div>
      <div
        data-testid={`step-${step.kind}`}
        className={`mb-1 flex-1 rounded-md border px-3 py-2 text-sm ${KIND_STYLE[step.kind]}`}
      >
        <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
          <span className="flex flex-wrap items-center gap-1.5 font-medium text-foreground">
            <span aria-hidden="true">{KIND_ICON[step.kind]}</span>
            {t(`agent.steps.${step.kind}`)}
            {label ? (
              <span className="font-mono font-normal text-foreground">{label.toolName}</span>
            ) : null}
            {serverName ? (
              <span className="rounded-full border border-border bg-muted px-1.5 py-0.5 text-[10px] font-normal text-muted-foreground">
                {serverName}
              </span>
            ) : null}
          </span>
          <span
            className="shrink-0"
            title={t("agent.trace.elapsedTitle", { elapsed: formatElapsed(step.tMs) })}
          >
            {formatElapsed(stepMs)}
          </span>
        </div>
        {step.kind === "tool_call" ? (
          <pre className="mt-1 whitespace-pre-wrap break-all font-mono text-xs text-muted-foreground">
            {JSON.stringify(step.args ?? {}, null, 2)}
          </pre>
        ) : step.kind === "tool_result" && step.content ? (
          <ResultBlock content={step.content} />
        ) : step.content ? (
          <div className="mt-1">
            <TraceMarkdown>{step.content}</TraceMarkdown>
          </div>
        ) : null}
      </div>
    </div>
  );
}

export interface PendingToolCardProps {
  tool: PendingInlineTool;
  onSubmit: (resultContent: string) => void;
  submitting?: boolean;
}

/**
 * Rendered at the end of the trace when the loop emitted
 * `tool_result_needed` for a hand-authored inline tool (no server-side
 * executor). The user pastes/types the tool's result and submits it, which
 * triggers a continuation `POST /api/playground/agent` request.
 */
export function PendingToolCard({ tool, onSubmit, submitting }: PendingToolCardProps) {
  const { t } = useTranslation("playground");
  const [value, setValue] = useState("");

  return (
    <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm">
      <div className="flex items-center gap-1.5 text-xs font-medium text-foreground">
        <span aria-hidden="true">🧩</span>
        {t("agent.pendingTool.title", { name: tool.name })}
      </div>
      <pre className="mt-1 whitespace-pre-wrap break-all font-mono text-xs text-muted-foreground">
        {JSON.stringify(tool.args ?? {}, null, 2)}
      </pre>
      <Textarea
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={t("agent.pendingTool.placeholder")}
        className="mt-2 h-20 font-mono text-xs"
      />
      <Button
        type="button"
        size="sm"
        className="mt-2"
        disabled={submitting || value.trim().length === 0}
        onClick={() => onSubmit(value)}
      >
        {t("agent.pendingTool.submit")}
      </Button>
    </div>
  );
}

export interface ApprovalCardProps {
  approval: PendingMcpApproval;
  onApprove: () => void;
  onReject: () => void;
}

/**
 * Rendered at the end of the trace when the loop emitted `tool_approval`
 * for an MCP tool call (`AgentRunRequest.autoRunMcp` not set — Task 11).
 * Approve re-runs the request with `autoRunMcp: true` so the loop executes the
 * tool in-request; Reject just clears the pending card (the run already ended
 * via `done`, nothing further happens).
 */
export function ApprovalCard({ approval, onApprove, onReject }: ApprovalCardProps) {
  const { t } = useTranslation("playground");

  return (
    <div
      data-testid="mcp-approval-card"
      className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm"
    >
      <div className="flex items-center gap-1.5 text-xs font-medium text-foreground">
        <span aria-hidden="true">🔐</span>
        {t("agent.approval.title", { server: approval.server.name, name: approval.name })}
      </div>
      <pre className="mt-1 whitespace-pre-wrap break-all font-mono text-xs text-muted-foreground">
        {JSON.stringify(approval.args ?? {}, null, 2)}
      </pre>
      <div className="mt-2 flex gap-2">
        <Button type="button" size="sm" onClick={onApprove}>
          {t("agent.approval.approve")}
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={onReject}>
          {t("agent.approval.reject")}
        </Button>
      </div>
    </div>
  );
}

export interface VerdictCardProps {
  verdict: AgentVerdict;
}

/**
 * The Agent Playground's "capability test" payoff card (Task 13): renders the
 * lightweight trajectory judge's verdict at the end of a completed run.
 * Only ever present when the workspace has a default LLM-judge provider
 * configured AND the run actually completed (see `AgentSseEvent`'s
 * `verdict` event doc) — absent on a pause, an upstream error, or when no
 * judge is configured.
 */
export function VerdictCard({ verdict }: VerdictCardProps) {
  const { t } = useTranslation("playground");

  return (
    <div
      data-testid="agent-verdict-card"
      className="rounded-md border border-border bg-card px-3 py-2 text-sm"
    >
      <div className="flex items-center gap-1.5 text-xs font-medium text-foreground">
        <span aria-hidden="true">🏁</span>
        {t("agent.verdict.title")}
      </div>
      <div className="mt-2 flex flex-wrap gap-3 text-xs">
        <span className="flex items-center gap-1">
          <span aria-hidden="true">{verdict.taskCompleted ? "✅" : "❌"}</span>
          {t("agent.verdict.taskCompleted")}
        </span>
        <span className="flex items-center gap-1">
          <span aria-hidden="true">{verdict.toolUseCorrect ? "✅" : "❌"}</span>
          {t("agent.verdict.toolUseCorrect")}
        </span>
        <span className="text-muted-foreground">
          {t("agent.verdict.extraSteps", { count: verdict.extraSteps })}
        </span>
      </div>
      <p className="mt-1.5 whitespace-pre-wrap break-words text-foreground">
        {verdict.oneLineVerdict}
      </p>
    </div>
  );
}
