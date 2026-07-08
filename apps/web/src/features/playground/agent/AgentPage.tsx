import { zodResolver } from "@hookform/resolvers/zod";
import type {
  AgentRunRequest,
  ChatMessage,
  CreateSkill,
  ToolDef,
} from "@modeldoctor/contracts";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { z } from "zod";
import { FormActions } from "@/components/common/form-actions";
import { FormSection } from "@/components/common/form-section";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useMcpServers } from "@/features/mcp-servers/queries";
import { useCreateSkill, useSkills } from "@/features/skills/queries";
import { CategoryEndpointSelector } from "../CategoryEndpointSelector";
import { PlaygroundShell } from "../PlaygroundShell";
import { AGENT_BUILTIN_TOOL_NAMES, appendToolResultMessage, runAgentSse } from "./api";
import { type PendingInlineTool, useAgentStore } from "./store";
import { TraceTimeline } from "./trace/TraceTimeline";

const NO_SKILL = "__none__";
const INLINE_TOOL_ITEM_CLASS =
  "flex items-center justify-between gap-2 rounded border border-border px-2 py-1 text-xs";

/** Kicks off (or continues) one agent run. Exported for direct testing. */
export async function startAgentRun(
  t: (key: string, opts?: Record<string, unknown>) => string,
  continuation?: { messages: ChatMessage[] },
) {
  const fresh = useAgentStore.getState();
  if (!fresh.selectedConnectionId) return;
  if (!continuation && fresh.task.trim().length === 0) return;

  if (!continuation) fresh.clearSteps();
  fresh.setPendingInlineTool(null);
  fresh.setPendingApproval(null);
  fresh.setError(null);
  fresh.setRunning(true);

  const body: AgentRunRequest = {
    connectionId: fresh.selectedConnectionId,
    task: fresh.task,
    systemPrompt: fresh.systemPrompt.trim() || undefined,
    // A continuation resumes the loop at turn 0 again — force planFirst off
    // so the first assistant turn of the continuation isn't mislabeled "plan".
    planFirst: continuation ? false : fresh.planFirst,
    maxSteps: fresh.maxSteps,
    inlineTools: fresh.inlineTools.length > 0 ? fresh.inlineTools : undefined,
    builtinTools: fresh.builtinTools.length > 0 ? fresh.builtinTools : undefined,
    mcpServerIds: fresh.selectedMcpServerIds.length > 0 ? fresh.selectedMcpServerIds : undefined,
    autoRunMcp: fresh.autoRunMcp,
    messages: continuation?.messages,
  };

  const ac = new AbortController();
  fresh.setAbortController(ac);
  try {
    await runAgentSse(body, ac.signal, (evt) => {
      const s = useAgentStore.getState();
      if (evt.type === "step") {
        s.appendStep(evt.step);
      } else if (evt.type === "tool_result_needed") {
        s.setPendingInlineTool({ toolCallId: evt.toolCallId, name: evt.name, args: evt.args });
      } else if (evt.type === "tool_approval") {
        s.setPendingApproval({
          toolCallId: evt.toolCallId,
          server: evt.server,
          name: evt.name,
          args: evt.args,
        });
      } else if (evt.type === "verdict") {
        // Task 13: lightweight trajectory judge — only emitted right before
        // a TRUE-completion `done` (never on a pausing one), so it's safe
        // to just set it here and let it ride until the next `clearSteps()`.
        s.setVerdict(evt.verdict);
      } else if (evt.type === "done") {
        // Full-transcript continuation (Task 11 fix pass): `messages` is
        // populated only when the server is pausing for a
        // `tool_result_needed`/`tool_approval` continuation — stash it so
        // the resend (submit/approve) can hand it straight back verbatim.
        // A normal (non-pausing) `done` clears any stale value.
        s.setContinuationMessages(evt.messages ?? null);
      }
      // running flips false in `finally`.
    });
  } catch (e) {
    if (!(e instanceof DOMException && e.name === "AbortError")) {
      const msg = e instanceof Error ? e.message : "stream failed";
      useAgentStore.getState().setError(msg);
      toast.error(t("agent.errors.run", { message: msg }));
    }
  } finally {
    const s = useAgentStore.getState();
    s.setRunning(false);
    s.setAbortController(null);
  }
}

function InlineToolEditor() {
  const { t } = useTranslation("playground");
  const slice = useAgentStore();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [params, setParams] = useState("{}");

  const onAdd = () => {
    if (name.trim().length === 0) return;
    let parameters: Record<string, unknown>;
    try {
      const parsed = JSON.parse(params || "{}");
      if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("not an object");
      }
      parameters = parsed as Record<string, unknown>;
    } catch {
      toast.error(t("agent.inlineTools.invalidParams"));
      return;
    }
    const tool: ToolDef = {
      type: "function",
      function: { name: name.trim(), description: description.trim() || undefined, parameters },
    };
    slice.addInlineTool(tool);
    setName("");
    setDescription("");
    setParams("{}");
  };

  return (
    <div className="space-y-2">
      <h4 className="text-xs font-semibold text-muted-foreground">
        {t("agent.inlineTools.title")}
      </h4>
      {slice.inlineTools.length === 0 ? (
        <p className="text-xs text-muted-foreground">{t("agent.inlineTools.empty")}</p>
      ) : (
        <ul className="space-y-1">
          {slice.inlineTools.map((tool, idx) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: append/remove-only local list
            <li key={idx} className={INLINE_TOOL_ITEM_CLASS}>
              <span className="truncate font-mono">{tool.function.name}</span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-6 px-2"
                onClick={() => slice.removeInlineTool(idx)}
              >
                {t("agent.inlineTools.remove")}
              </Button>
            </li>
          ))}
        </ul>
      )}
      <div className="space-y-1.5 rounded border border-dashed border-border p-2">
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t("agent.inlineTools.namePlaceholder")}
          className="h-8 text-xs"
        />
        <Input
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder={t("agent.inlineTools.descriptionPlaceholder")}
          className="h-8 text-xs"
        />
        <Textarea
          value={params}
          onChange={(e) => setParams(e.target.value)}
          placeholder={t("agent.inlineTools.paramsPlaceholder")}
          className="h-16 font-mono text-xs"
        />
        <Button type="button" size="sm" variant="secondary" onClick={onAdd} className="w-full">
          {t("agent.inlineTools.add")}
        </Button>
      </div>
    </div>
  );
}

interface SaveAsSkillFormValues {
  name: string;
  description: string;
}

const saveAsSkillSchema = z.object({
  name: z
    .string()
    .transform((v) => v.trim())
    .pipe(z.string().min(1).max(120)),
  description: z.string().default(""),
});

/**
 * "存为 skill" dialog: takes name + optional description, then POSTs the
 * CURRENT agent-store config (system prompt, plan/max-steps knobs, inline
 * tools, selected MCP servers, selected connection) as a new Skill. Reads
 * the store via `getState()` at submit time (not a render-time snapshot) so
 * it always saves what's on screen, mirroring `startAgentRun`'s pattern.
 */
function SaveAsSkillDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation("playground");
  const { t: tc } = useTranslation("common");
  const createMut = useCreateSkill();

  const form = useForm<SaveAsSkillFormValues>({
    resolver: zodResolver(saveAsSkillSchema),
    mode: "onTouched",
    defaultValues: { name: "", description: "" },
  });

  // biome-ignore lint/correctness/useExhaustiveDependencies: form reference is stable; reset only when the dialog (re)opens
  useEffect(() => {
    if (open) form.reset({ name: "", description: "" });
  }, [open]);

  const onSubmit = form.handleSubmit(async (values) => {
    const s = useAgentStore.getState();
    const body: CreateSkill = {
      name: values.name,
      description: values.description.trim() || undefined,
      systemPrompt: s.systemPrompt.trim() || undefined,
      modelConnectionId: s.selectedConnectionId ?? undefined,
      mcpServerIds: s.selectedMcpServerIds,
      inlineTools: s.inlineTools.length > 0 ? s.inlineTools : undefined,
      planFirst: s.planFirst,
      maxSteps: s.maxSteps,
    };
    try {
      await createMut.mutateAsync(body);
      toast.success(t("agent.skill.saveSuccess"));
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("agent.skill.saveError"));
    }
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <Form {...form}>
          <form onSubmit={onSubmit} className="space-y-4">
            <DialogHeader>
              <DialogTitle>{t("agent.skill.saveAsTitle")}</DialogTitle>
              <DialogDescription>{t("agent.skill.saveAsDescription")}</DialogDescription>
            </DialogHeader>

            <FormSection>
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel required>{t("agent.skill.saveAsFields.name")}</FormLabel>
                    <FormControl>
                      <Input autoComplete="off" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="description"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("agent.skill.saveAsFields.description")}</FormLabel>
                    <FormControl>
                      <Textarea rows={2} {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </FormSection>

            <DialogFooter>
              <FormActions
                onCancel={() => onOpenChange(false)}
                cancelLabel={tc("actions.cancel")}
                submitLabel={tc("actions.save")}
                pending={createMut.isPending}
              />
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

function AgentConfigPanel() {
  const { t } = useTranslation("playground");
  const slice = useAgentStore();
  const { data: mcpServers } = useMcpServers();
  const { data: skills } = useSkills();
  const [selectedSkillId, setSelectedSkillId] = useState<string>(NO_SKILL);
  const [saveAsOpen, setSaveAsOpen] = useState(false);

  /**
   * Applying a Skill loads it as a preset into the store: systemPrompt,
   * planFirst, maxSteps, inlineTools, selectedMcpServerIds (=
   * skill.mcpServerIds), and selectedConnectionId (= skill.modelConnectionId,
   * if the skill has one). `builtinTools` isn't part of the Skill schema, so
   * it's left untouched.
   */
  const applySkill = (skillId: string) => {
    setSelectedSkillId(skillId);
    if (skillId === NO_SKILL) return;
    const skill = (skills ?? []).find((sk) => sk.id === skillId);
    if (!skill) return;
    slice.setSystemPrompt(skill.systemPrompt ?? "");
    slice.setPlanFirst(skill.planFirst);
    slice.setMaxSteps(skill.maxSteps);
    slice.setInlineTools(skill.inlineTools ?? []);
    slice.setSelectedMcpServerIds(skill.mcpServerIds);
    if (skill.modelConnectionId) slice.setSelectedConnectionId(skill.modelConnectionId);
  };

  return (
    <div className="space-y-4">
      <CategoryEndpointSelector
        category="chat"
        selectedConnectionId={slice.selectedConnectionId}
        onSelect={slice.setSelectedConnectionId}
      />

      <div className="space-y-1.5">
        <Label className="text-xs text-muted-foreground">{t("agent.task.label")}</Label>
        <Textarea
          value={slice.task}
          onChange={(e) => slice.setTask(e.target.value)}
          placeholder={t("agent.task.placeholder")}
          className="h-20 text-xs"
        />
      </div>

      <div className="space-y-1.5">
        <Label className="text-xs text-muted-foreground">{t("agent.systemPrompt.label")}</Label>
        <Textarea
          value={slice.systemPrompt}
          onChange={(e) => slice.setSystemPrompt(e.target.value)}
          placeholder={t("agent.systemPrompt.placeholder")}
          className="h-16 text-xs"
        />
      </div>

      <div className="flex items-center justify-between">
        <Label className="text-xs text-muted-foreground" htmlFor="agent-plan-first">
          {t("agent.planFirst")}
        </Label>
        <Switch
          id="agent-plan-first"
          checked={slice.planFirst}
          onCheckedChange={(b) => slice.setPlanFirst(b)}
        />
      </div>

      <div className="space-y-1.5">
        <Label className="text-xs text-muted-foreground" htmlFor="agent-max-steps">
          {t("agent.maxSteps")}
        </Label>
        <Input
          id="agent-max-steps"
          type="number"
          min={1}
          max={50}
          value={slice.maxSteps}
          onChange={(e) => slice.setMaxSteps(Number(e.target.value) || 1)}
          className="h-8 w-24 text-xs"
        />
      </div>

      <div className="space-y-1.5">
        <h4 className="text-xs font-semibold text-muted-foreground">
          {t("agent.builtinTools.title")}
        </h4>
        {AGENT_BUILTIN_TOOL_NAMES.map((name) => {
          const checkboxId = `agent-builtin-${name}`;
          return (
            <label key={name} htmlFor={checkboxId} className="flex items-start gap-2 text-xs">
              <Checkbox
                id={checkboxId}
                checked={slice.builtinTools.includes(name)}
                onCheckedChange={(checked) => slice.toggleBuiltinTool(name, Boolean(checked))}
                className="mt-0.5"
              />
              <span>
                <span className="font-medium">{t(`agent.builtinTools.${name}.label`)}</span>
                <span className="block text-muted-foreground">
                  {t(`agent.builtinTools.${name}.description`)}
                </span>
              </span>
            </label>
          );
        })}
      </div>

      <InlineToolEditor />

      <div className="space-y-1.5">
        <h4 className="text-xs font-semibold text-muted-foreground">
          {t("agent.mcpServers.title")}
        </h4>
        {mcpServers && mcpServers.length > 0 ? (
          <ul className="space-y-1">
            {mcpServers.map((server) => {
              const checkboxId = `agent-mcp-${server.id}`;
              return (
                <li key={server.id}>
                  <label htmlFor={checkboxId} className="flex items-center gap-2 text-xs">
                    <Checkbox
                      id={checkboxId}
                      checked={slice.selectedMcpServerIds.includes(server.id)}
                      onCheckedChange={(checked) =>
                        slice.toggleMcpServer(server.id, Boolean(checked))
                      }
                    />
                    <span className="truncate">{server.name}</span>
                  </label>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-xs text-muted-foreground">{t("agent.mcpServers.empty")}</p>
        )}
        <div className="flex items-center justify-between">
          <Label className="text-xs text-muted-foreground" htmlFor="agent-auto-run-mcp">
            {t("agent.mcpServers.autoRun")}
          </Label>
          <Switch
            id="agent-auto-run-mcp"
            checked={slice.autoRunMcp}
            onCheckedChange={(b) => slice.setAutoRunMcp(b)}
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label className="text-xs text-muted-foreground">{t("agent.skill.title")}</Label>
        <div className="flex items-center gap-2">
          <Select value={selectedSkillId} onValueChange={applySkill}>
            <SelectTrigger className="w-full text-xs">
              <SelectValue placeholder={t("agent.skill.placeholder")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NO_SKILL}>{t("agent.skill.none")}</SelectItem>
              {(skills ?? []).map((skill) => (
                <SelectItem key={skill.id} value={skill.id}>
                  {skill.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="shrink-0 text-xs"
            onClick={() => setSaveAsOpen(true)}
          >
            {t("agent.skill.saveAs")}
          </Button>
        </div>
      </div>

      <SaveAsSkillDialog open={saveAsOpen} onOpenChange={setSaveAsOpen} />
    </div>
  );
}

export function AgentPage() {
  const { t } = useTranslation("playground");
  const slice = useAgentStore();

  const canRun = !!slice.selectedConnectionId && slice.task.trim().length > 0 && !slice.running;
  const disabledReason = !slice.selectedConnectionId
    ? t("agent.needConnection")
    : slice.task.trim().length === 0
      ? t("agent.needTask")
      : undefined;

  const onRun = () => {
    void startAgentRun(t);
  };

  const onStop = () => {
    useAgentStore.getState().abortController?.abort();
  };

  const onReset = () => {
    useAgentStore.getState().reset();
  };

  // Full-transcript continuation (Task 11 fix pass): resend the exact
  // `continuationMessages` transcript the server handed back on `done` (see
  // `AgentSseEvent`'s `done.messages` doc), plus one more `role: "tool"`
  // entry for the user-supplied result. The server resumes from where it
  // paused instead of restarting the task from turn 0.
  const onSubmitToolResult = (resultContent: string) => {
    const fresh = useAgentStore.getState();
    const pending: PendingInlineTool | null = fresh.pendingInlineTool;
    if (!pending || !fresh.continuationMessages) return;
    const messages = appendToolResultMessage(fresh.continuationMessages, pending.toolCallId, resultContent);
    void startAgentRun(t, { messages });
  };

  // "Approve" resends the same paused transcript with `autoRunMcp: true` —
  // the server's resume path (`AgentLoopService.run`'s unanswered-tool-call
  // check) executes ONLY the newly-approved MCP tool_call; any builtin (or
  // other already-run MCP call) from the same paused turn is already in
  // `continuationMessages` as a `role: "tool"` entry and is never re-run.
  // Passing `{ messages }` as `continuation` also keeps `startAgentRun` from
  // calling `clearSteps()` — the trace is appended to, not restarted.
  const onApproveMcp = () => {
    const fresh = useAgentStore.getState();
    if (!fresh.continuationMessages) return;
    fresh.setPendingApproval(null);
    fresh.setAutoRunMcp(true);
    void startAgentRun(t, { messages: fresh.continuationMessages });
  };

  const onRejectMcp = () => {
    useAgentStore.getState().setPendingApproval(null);
  };

  return (
    <PlaygroundShell
      category="chat"
      title={t("agent.title")}
      subtitle={t("agent.subtitle")}
      paramsSlot={<AgentConfigPanel />}
    >
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex items-center justify-between border-b border-border px-6 py-3">
          <div className="flex items-center gap-2">
            {slice.running ? (
              <Button type="button" variant="destructive" size="sm" onClick={onStop}>
                {t("agent.stop")}
              </Button>
            ) : (
              <Button
                type="button"
                size="sm"
                onClick={onRun}
                disabled={!canRun}
                title={disabledReason}
              >
                {t("agent.run")}
              </Button>
            )}
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onReset}
              disabled={slice.running}
            >
              {t("agent.reset")}
            </Button>
          </div>
          {slice.running ? (
            <span className="text-xs text-muted-foreground">{t("agent.running")}</span>
          ) : null}
        </div>
        {slice.error ? (
          <div className="mx-6 mt-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {slice.error}
          </div>
        ) : null}
        <div className="min-h-0 flex-1 overflow-y-auto">
          <TraceTimeline
            steps={slice.steps}
            pendingInlineTool={slice.pendingInlineTool}
            onSubmitToolResult={onSubmitToolResult}
            submittingToolResult={slice.running}
            pendingApproval={slice.pendingApproval}
            onApproveMcp={onApproveMcp}
            onRejectMcp={onRejectMcp}
            verdict={slice.verdict}
          />
        </div>
      </div>
    </PlaygroundShell>
  );
}
