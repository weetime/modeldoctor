import { zodResolver } from "@hookform/resolvers/zod";
import type {
  AgentRunRequest,
  ChatMessage,
  ChatParams as ChatParamsType,
  CreateSkill,
  ToolDef,
} from "@modeldoctor/contracts";
import { RotateCcw } from "lucide-react";
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
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
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
import { type AttachedFile, buildContentParts } from "../chat/attachments";
import { ChatParams } from "../chat/ChatParams";
import { MessageComposer } from "../chat/MessageComposer";
import { HistoryDrawer } from "../history/HistoryDrawer";
import { PlaygroundShell } from "../PlaygroundShell";
import { AGENT_BUILTIN_TOOL_NAMES, appendToolResultMessage, runAgentSse } from "./api";
import { type AgentHistorySnapshot, useAgentHistoryStore } from "./history";
import { hasToolsSelected, type PendingInlineTool, useAgentStore } from "./store";
import { Timeline } from "./trace/Timeline";

const NO_SKILL = "__none__";
const INLINE_TOOL_ITEM_CLASS =
  "flex items-center justify-between gap-2 rounded border border-border px-2 py-1 text-xs";

/**
 * Placeholder `AgentRunRequest.task` sent on a continuation request (inline-tool
 * result submit / MCP approve). The schema requires `task` to be non-empty
 * even on a continuation, but the loop ignores it in favor of `messages` once
 * that's present (see `AgentRunRequestSchema`'s doc) — this value is never
 * seen by the model.
 */
const CONTINUATION_TASK_PLACEHOLDER = "continue";

export type StartRunArgs =
  | { text: string; attachments: AttachedFile[] }
  | { continuation: { messages: ChatMessage[]; autoRunMcpOverride?: boolean } }
  | { regenerate: true };

/**
 * Kicks off (or continues) one unified-playground run. Exported for direct
 * testing. A fresh run builds `task` from the composer's text + multimodal
 * attachments (`buildContentParts`); a continuation resends the paused
 * transcript instead (see `appendToolResultMessage`/`onApproveMcp` doc
 * comments in `AgentPage` below).
 *
 * Tool-related fields (`builtinTools`/`inlineTools`/`mcpServerIds`/
 * `autoRunMcp`/`planFirst`/`maxSteps`) are included ONLY when the chat is
 * armed with at least one tool (`hasToolsSelected`) — omitting them entirely
 * when none is picked is what makes the request an equivalent streaming-chat
 * call (no-tools = pure `text_delta*→assistant_end→done`, per the
 * unified-playground design doc). There is no "agent mode" toggle: a run is a
 * plain chat until you select a tool, then the SAME conversation can call it.
 */
export async function startRun(
  t: (key: string, opts?: Record<string, unknown>) => string,
  args: StartRunArgs,
): Promise<void> {
  const fresh = useAgentStore.getState();
  if (!fresh.selectedConnectionId) return;

  const isContinuation = "continuation" in args;
  const isRegenerate = "regenerate" in args;
  // The current user turn's content (multimodal-capable) and — for the 2nd+
  // turn of a conversation, or a regenerate — the full transcript to resend
  // as context.
  let userContent: AgentRunRequest["task"] | undefined;
  let freshMessages: ChatMessage[] | undefined;
  if (isRegenerate) {
    // Retry the last answer: the caller (`onRegenerate`) already trimmed the
    // previous assistant reply off `conversation` + the timeline, so the
    // transcript now ends at the last user turn. Resend it verbatim (system
    // prepended) so the model answers that same turn afresh.
    const convo = useAgentStore.getState().conversation;
    if (convo.length === 0) return;
    fresh.setContinuationMessages(null);
    const sys = fresh.systemPrompt.trim();
    freshMessages = sys ? [{ role: "system", content: sys }, ...convo] : [...convo];
  } else if (!isContinuation) {
    if (args.text.trim().length === 0 && args.attachments.length === 0) return;
    // Stashed for history preview + as the (ignored) `task` placeholder on a
    // later continuation request — see `CONTINUATION_TASK_PLACEHOLDER`.
    fresh.setTask(args.text);
    // Multi-turn chat: do NOT wipe the timeline — this is a running
    // conversation, not a one-shot task. Just clear the previous run's
    // mid-turn tool-pause state, then append this user turn to both the
    // visible timeline (a user bubble) and the transcript.
    fresh.setContinuationMessages(null);
    userContent = buildContentParts(args.text, args.attachments);
    fresh.pushUserMessage(args.text);
    fresh.appendConversation([{ role: "user", content: userContent }]);
    // First turn → plain `task` path (keeps plan-first working). 2nd+ turn →
    // resend the whole transcript (system prepended) as `messages` so the
    // model actually remembers the prior conversation.
    const convo = useAgentStore.getState().conversation;
    if (convo.length > 1) {
      const sys = fresh.systemPrompt.trim();
      freshMessages = sys ? [{ role: "system", content: sys }, ...convo] : [...convo];
    }
  }
  fresh.setPendingInlineTool(null);
  fresh.setPendingApproval(null);
  fresh.setError(null);
  fresh.setRunning(true);

  const toolFields = hasToolsSelected(fresh)
    ? {
        builtinTools: fresh.builtinTools.length > 0 ? fresh.builtinTools : undefined,
        inlineTools: fresh.inlineTools.length > 0 ? fresh.inlineTools : undefined,
        mcpServerIds:
          fresh.selectedMcpServerIds.length > 0 ? fresh.selectedMcpServerIds : undefined,
        // A continuation/regenerate resends `messages` (server resumes at turn
        // 0) — force planFirst off so the resent turn isn't mislabeled "plan".
        planFirst: isContinuation || isRegenerate ? false : fresh.planFirst,
        // Approve is a PER-CONTINUATION override (`autoRunMcpOverride`), not a
        // mutation of the persistent `autoRunMcp` toggle — see `onApproveMcp`'s
        // doc comment. Only this one resume request runs with the gate open;
        // the store's toggle (and thus the NEXT fresh run) is unaffected.
        autoRunMcp: isContinuation
          ? (args.continuation.autoRunMcpOverride ?? fresh.autoRunMcp)
          : fresh.autoRunMcp,
      }
    : {};

  const body: AgentRunRequest = {
    connectionId: fresh.selectedConnectionId,
    task: isContinuation
      ? fresh.task.trim() || CONTINUATION_TASK_PLACEHOLDER
      : (userContent ?? CONTINUATION_TASK_PLACEHOLDER),
    systemPrompt: fresh.systemPrompt.trim() || undefined,
    // Always present (contract's `maxSteps` has a default, so the inferred
    // request type requires it). Harmless for a tools-off run — with no tools
    // the loop never iterates past the single streaming turn anyway.
    maxSteps: fresh.maxSteps,
    // `messages` is sent for: (a) a tool-pause continuation (verbatim from the
    // server's `done`), or (b) the 2nd+ turn of a conversation (the running
    // transcript, so the model has prior-turn context). A first turn omits it
    // and uses `task` (which keeps plan-first working — see `freshMessages`).
    messages: isContinuation ? args.continuation.messages : freshMessages,
    // Sampling params (temperature/maxTokens/topP/...) apply to BOTH chat
    // and agent runs — model sampling is always relevant, unlike the
    // tool-only fields above. Sent whenever the store has at least one
    // param set; omitted (not `{}`) otherwise so a tools-off run still reads
    // as an equivalent plain streaming-chat call on the wire.
    params:
      Object.keys(fresh.params).length > 0
        ? (fresh.params as AgentRunRequest["params"])
        : undefined,
    ...toolFields,
  };

  const ac = new AbortController();
  fresh.setAbortController(ac);
  try {
    await runAgentSse(body, ac.signal, (evt) => {
      const s = useAgentStore.getState();
      // Every event folds into the renderable timeline first...
      s.appendEvent(evt);
      // ...then side effects for the events the timeline doesn't fully own.
      if (evt.type === "tool_result_needed") {
        s.setPendingInlineTool({ toolCallId: evt.toolCallId, name: evt.name, args: evt.args });
      } else if (evt.type === "tool_approval") {
        s.setPendingApproval({
          toolCallId: evt.toolCallId,
          server: evt.server,
          name: evt.name,
          args: evt.args,
        });
      } else if (evt.type === "verdict") {
        // Single-source-of-render decision: `appendEvent` above already
        // pushed a `{kind:"verdict"}` timeline item, which is what
        // `Timeline` renders — this call is ONLY for history persistence
        // (`AgentHistorySnapshot.verdict`), never a second render source.
        // Do NOT also pass `store.verdict` into `Timeline` — that would
        // render the verdict card twice.
        s.setVerdict(evt.verdict);
      } else if (evt.type === "done") {
        // Full-transcript continuation (Task 11 fix pass): `messages` is
        // populated only when the server is pausing for a
        // `tool_result_needed`/`tool_approval` continuation — stash it so
        // the resend (submit/approve) can hand it straight back verbatim.
        // A normal (non-pausing) `done` clears any stale value.
        s.setContinuationMessages(evt.messages ?? null);
        // Multi-turn: on a true completion (not a tool pause), fold the
        // assistant's final answer into the transcript so the NEXT user turn
        // resends it as context. Uses the last closed assistant bubble's text.
        if (!evt.messages) {
          const lastAssistant = [...s.timeline].reverse().find((i) => i.kind === "assistant_text");
          if (lastAssistant?.kind === "assistant_text" && lastAssistant.content.length > 0) {
            s.appendConversation([{ role: "assistant", content: lastAssistant.content }]);
          }
        }
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
 * "Save as skill" dialog: takes name + optional description, then POSTs the
 * CURRENT agent-store config (system prompt, plan/max-steps knobs, inline
 * tools, selected MCP servers, selected connection) as a new Skill. Reads
 * the store via `getState()` at submit time (not a render-time snapshot) so
 * it always saves what's on screen, mirroring `startRun`'s pattern.
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

/**
 * Composer-row controls for "what this chat is armed with": Skill preset,
 * tools (builtin + hand-authored inline), and MCP servers. Always rendered
 * below the composer (see `AgentPage`) — there's no tools-mode toggle; picking
 * any of these arms the SAME conversation (see `hasToolsSelected`). Owns the
 * Skill/save-as state and the `applySkill` preset-loader.
 */
function AgentComposerControls() {
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

  const mcpServerCount = slice.selectedMcpServerIds.length;

  return (
    // Locked while a run is in flight — config changes wouldn't take effect
    // until the next run and are misleading mid-run. ALSO locked while a
    // continuation is pending (inline-tool result / MCP approval): `running`
    // already flipped false on the pausing `done`, but deselecting a tool /
    // MCP server here would make `startRun`'s `toolFields` omit it from the
    // resume request, corrupting the continuation (this is the guard the
    // removed tools toggle used to carry). Stop/Reset live outside this
    // fieldset. `disabled` on a fieldset cascades to every control inside (the
    // Radix Select/Popover all render as buttons).
    <fieldset
      data-testid="agent-tool-controls"
      disabled={slice.running || slice.pendingInlineTool !== null || slice.pendingApproval !== null}
      className="m-0 flex min-w-0 flex-wrap items-center gap-2 border-0 p-0 disabled:opacity-60"
    >
      <Select value={selectedSkillId} onValueChange={applySkill}>
        <SelectTrigger className="h-8 w-48 text-xs">
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

      <Popover>
        <PopoverTrigger asChild>
          <Button type="button" variant="outline" size="sm" className="h-8 text-xs">
            {t("agent.toolsMenu.title")} ({slice.builtinTools.length + slice.inlineTools.length})
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-80 space-y-3">
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
          {/* Hand-authored inline tools live in the same "Tools" menu so every
              tool source is reachable from the always-visible bar (avoids the
              chicken-and-egg of gating the inline editor behind having a tool). */}
          <div className="border-t border-border pt-3">
            <InlineToolEditor />
          </div>
        </PopoverContent>
      </Popover>

      <Popover>
        <PopoverTrigger asChild>
          <Button type="button" variant="outline" size="sm" className="h-8 text-xs">
            {t("agent.mcpServers.title")} ({mcpServerCount})
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-80 space-y-1.5">
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
          <div className="flex items-center justify-between border-t border-border pt-1.5">
            <Label className="text-xs text-muted-foreground" htmlFor="agent-auto-run-mcp">
              {t("agent.mcpServers.autoRun")}
            </Label>
            <Switch
              id="agent-auto-run-mcp"
              checked={slice.autoRunMcp}
              onCheckedChange={(b) => slice.setAutoRunMcp(b)}
            />
          </div>
        </PopoverContent>
      </Popover>

      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-8 text-xs"
        onClick={() => setSaveAsOpen(true)}
      >
        {t("agent.skill.saveAs")}
      </Button>

      <SaveAsSkillDialog open={saveAsOpen} onOpenChange={setSaveAsOpen} />
    </fieldset>
  );
}

/**
 * Right-side config panel: the connection picker + sampling params (always
 * active — model sampling is always relevant) plus the agent-loop knobs
 * (plan-first, max-steps), which are only meaningful — and only rendered —
 * once the chat is armed with a tool (`hasToolsSelected`). The tool selectors
 * themselves live in the always-visible composer bar (`AgentComposerControls`),
 * not here.
 */
function AgentConfigPanel() {
  const { t } = useTranslation("playground");
  const slice = useAgentStore();
  const showAgentKnobs = hasToolsSelected(slice);

  return (
    <div className="space-y-4">
      <fieldset
        disabled={slice.running}
        className="m-0 min-w-0 space-y-4 border-0 p-0 disabled:opacity-60"
      >
        <CategoryEndpointSelector
          category="chat"
          selectedConnectionId={slice.selectedConnectionId}
          onSelect={slice.setSelectedConnectionId}
        />
        <ChatParams value={slice.params as ChatParamsType} onChange={slice.patchParams} />
      </fieldset>

      {showAgentKnobs ? (
        <fieldset
          disabled={slice.running}
          className="m-0 min-w-0 space-y-4 border-0 p-0 disabled:opacity-60"
        >
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
        </fieldset>
      ) : null}
    </div>
  );
}

export function AgentPage() {
  const { t } = useTranslation("playground");
  const slice = useAgentStore();
  const { data: mcpServers } = useMcpServers();
  const mcpServerNames: Record<string, string> = {};
  for (const s of mcpServers ?? []) mcpServerNames[s.id] = s.name;

  const onSend = (text: string, attachments: AttachedFile[]) => {
    void startRun(t, { text, attachments });
  };

  const onStop = () => {
    useAgentStore.getState().abortController?.abort();
  };

  const onReset = () => {
    useAgentStore.getState().reset();
  };

  // Retry the last answer ("Regenerate"): drop the previous assistant reply
  // from both the transcript and the visible timeline (back to the last user
  // bubble), then re-run that same user turn so the model answers afresh.
  const onRegenerate = () => {
    const s = useAgentStore.getState();
    if (s.running || s.pendingInlineTool || s.pendingApproval) return;
    // Trim trailing assistant turn(s) off the transcript so it ends at the
    // last user turn.
    const convo = [...s.conversation];
    while (convo.length > 0 && convo[convo.length - 1].role !== "user") convo.pop();
    if (convo.length === 0) return;
    s.setConversation(convo);
    // Trim the timeline back to (and including) the last user bubble.
    const tl = s.timeline;
    let lastUserIdx = -1;
    for (let i = tl.length - 1; i >= 0; i--) {
      if (tl[i].kind === "user_message") {
        lastUserIdx = i;
        break;
      }
    }
    if (lastUserIdx >= 0) s.setTimeline(tl.slice(0, lastUserIdx + 1));
    void startRun(t, { regenerate: true });
  };

  // Regenerate is available once there's a completed answer to retry and
  // nothing is in flight.
  const canRegenerate =
    !slice.running &&
    !slice.pendingInlineTool &&
    !slice.pendingApproval &&
    slice.conversation.some((m) => m.role === "assistant");

  // Edit the Nth user turn and resend: truncate the transcript + timeline to
  // BEFORE that turn, then fire a fresh send with the edited text — which
  // re-appends the (edited) user turn and drops everything that came after.
  const onEditUserMessage = (userOrdinal: number, newText: string) => {
    const s = useAgentStore.getState();
    if (s.running || s.pendingInlineTool || s.pendingApproval) return;
    if (newText.trim().length === 0) return;
    // Cut the transcript before the ordinal-th user message.
    const userMsgIdxs = s.conversation
      .map((m, i) => (m.role === "user" ? i : -1))
      .filter((i) => i >= 0);
    if (userOrdinal >= userMsgIdxs.length) return;
    s.setConversation(s.conversation.slice(0, userMsgIdxs[userOrdinal]));
    // Cut the timeline before the ordinal-th user bubble.
    let seen = -1;
    let cutIdx = -1;
    for (let i = 0; i < s.timeline.length; i += 1) {
      if (s.timeline[i].kind === "user_message") {
        seen += 1;
        if (seen === userOrdinal) {
          cutIdx = i;
          break;
        }
      }
    }
    if (cutIdx >= 0) s.setTimeline(s.timeline.slice(0, cutIdx));
    void startRun(t, { text: newText, attachments: [] });
  };
  const canEdit = !slice.running && !slice.pendingInlineTool && !slice.pendingApproval;

  // Full-transcript continuation (Task 11 fix pass): resend the exact
  // `continuationMessages` transcript the server handed back on `done` (see
  // `AgentSseEvent`'s `done.messages` doc), plus one more `role: "tool"`
  // entry for the user-supplied result. The server resumes from where it
  // paused instead of restarting the task from turn 0.
  const onSubmitToolResult = (resultContent: string) => {
    const fresh = useAgentStore.getState();
    const pending: PendingInlineTool | null = fresh.pendingInlineTool;
    if (!pending || !fresh.continuationMessages) return;
    const messages = appendToolResultMessage(
      fresh.continuationMessages,
      pending.toolCallId,
      resultContent,
    );
    void startRun(t, { continuation: { messages } });
  };

  // "Approve" resends the same paused transcript with `autoRunMcp: true` —
  // the server's resume path (`AgentLoopService.run`'s unanswered-tool-call
  // check) executes ONLY the newly-approved MCP tool_call; any builtin (or
  // other already-run MCP call) from the same paused turn is already in
  // `continuationMessages` as a `role: "tool"` entry and is never re-run.
  // Passing `{ continuation: { messages, autoRunMcpOverride: true } }` also
  // keeps `startRun` from calling `clearSteps()` — the timeline is appended
  // to, not restarted.
  //
  // Security note (final-review fix, carried over): this is a
  // PER-CONTINUATION override (`autoRunMcpOverride: true`), NOT
  // `fresh.setAutoRunMcp(true)`. Mutating the shared store flag would
  // silently disable the approval gate for the NEXT fresh run too. Approving
  // one tool call once must never leave the gate open for a future unrelated
  // run; the user's persistent toggle only changes via the explicit Switch in
  // `AgentComposerControls`.
  const onApproveMcp = () => {
    const fresh = useAgentStore.getState();
    if (!fresh.continuationMessages) return;
    fresh.setPendingApproval(null);
    void startRun(t, {
      continuation: { messages: fresh.continuationMessages, autoRunMcpOverride: true },
    });
  };

  const onRejectMcp = () => {
    useAgentStore.getState().setPendingApproval(null);
  };

  // Restore a history entry's snapshot into the live agent store. Agent
  // trajectories are plain JSON (see `AgentHistorySnapshot`'s doc on why
  // there's no blob layer here, unlike `ChatPage`'s `restoreSnap`), so this
  // is a single synchronous pass — no async rehydration step.
  const restoreSnap = (snap: AgentHistorySnapshot) => {
    const s = useAgentStore.getState();
    s.reset();
    s.setSelectedConnectionId(snap.selectedConnectionId);
    s.setInput(snap.input ?? "");
    s.setTask(snap.task ?? "");
    s.setSystemPrompt(snap.systemPrompt);
    s.patchParams(snap.params);
    // `snap.toolsEnabled` is intentionally ignored — tool-presence is derived
    // from the restored tool arrays below (see `hasToolsSelected`), not a flag.
    s.setPlanFirst(snap.planFirst);
    s.setMaxSteps(snap.maxSteps);
    s.setInlineTools(snap.inlineTools);
    s.setBuiltinTools(snap.builtinTools);
    s.setSelectedMcpServerIds(snap.selectedMcpServerIds);
    s.setAutoRunMcp(snap.autoRunMcp);
    // `timeline` is missing on pre-unified-shape IDB entries (the old
    // `steps`-based snapshot never had it) — the shared history-store
    // `version` wasn't bumped for this migration (that's hardcoded in
    // `createHistoryStore` and would wipe ALL modalities' history), so those
    // old rows are still restorable. Fall back to `[]` like the other
    // newly-optional fields above (`input`/`task`) instead of handing
    // `Timeline` an `undefined` it can't `.length`/iterate.
    s.setTimeline(snap.timeline ?? []);
    // Restore the multi-turn transcript so the conversation keeps its memory
    // (missing on pre-multi-turn entries → empty, like `timeline` above).
    s.setConversation(snap.conversation ?? []);
    s.setVerdict(snap.verdict);
  };

  const historyCurrentId = useAgentHistoryStore((h) => h.currentId);
  const historyRestoreVersion = useAgentHistoryStore((h) => h.restoreVersion);
  // biome-ignore lint/correctness/useExhaustiveDependencies: deps are intentional — restoreVersion handles in-place snapshot replacement (newSession / restore) without re-firing on routine save/scheduleAutoSave
  useEffect(() => {
    const entry = useAgentHistoryStore.getState().list.find((e) => e.id === historyCurrentId);
    if (entry) restoreSnap(entry.snapshot);
  }, [historyCurrentId, historyRestoreVersion]);

  // Auto-save the current agent run (config + timeline + verdict) into the
  // current history entry — debounced 1500ms inside the store. Persists
  // `timeline` (the unified renderable trace), not `steps` — see
  // `AgentHistorySnapshot`'s doc for why `steps` is no longer the live
  // source of truth.
  useEffect(() => {
    const snap: AgentHistorySnapshot = {
      selectedConnectionId: slice.selectedConnectionId,
      input: slice.input,
      task: slice.task,
      systemPrompt: slice.systemPrompt,
      params: slice.params,
      // Derived (back-compat only): the manual mode flag is gone; persist what
      // the tool arrays imply so old readers still see a sane value. Pass the
      // specific arrays (not `slice`) so this effect's deps stay field-precise.
      toolsEnabled: hasToolsSelected({
        builtinTools: slice.builtinTools,
        inlineTools: slice.inlineTools,
        selectedMcpServerIds: slice.selectedMcpServerIds,
      }),
      planFirst: slice.planFirst,
      maxSteps: slice.maxSteps,
      inlineTools: slice.inlineTools,
      builtinTools: slice.builtinTools,
      selectedMcpServerIds: slice.selectedMcpServerIds,
      autoRunMcp: slice.autoRunMcp,
      timeline: slice.timeline,
      conversation: slice.conversation,
      verdict: slice.verdict,
    };
    useAgentHistoryStore.getState().scheduleAutoSave(snap);
  }, [
    slice.selectedConnectionId,
    slice.input,
    slice.task,
    slice.systemPrompt,
    slice.params,
    slice.planFirst,
    slice.maxSteps,
    slice.inlineTools,
    slice.builtinTools,
    slice.selectedMcpServerIds,
    slice.autoRunMcp,
    slice.timeline,
    slice.conversation,
    slice.verdict,
  ]);

  return (
    <PlaygroundShell
      category="chat"
      // One unified "Chat" surface: plain streaming chat by default, and the
      // SAME conversation gains tool-calling the moment you arm it with a
      // Skill / builtin tool / MCP server. The i18n VALUES say "Chat" (no
      // "Agent" / "mode" framing); KEYS are unchanged to avoid churn.
      title={t("agent.title")}
      subtitle={t("agent.subtitle")}
      historySlot={<HistoryDrawer useHistoryStore={useAgentHistoryStore} />}
      paramsSlot={<AgentConfigPanel />}
    >
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="min-h-0 flex-1">
          <Timeline
            timeline={slice.timeline}
            pendingInlineTool={slice.pendingInlineTool}
            onSubmitToolResult={onSubmitToolResult}
            submittingToolResult={slice.running}
            pendingApproval={slice.pendingApproval}
            onApproveMcp={onApproveMcp}
            onRejectMcp={onRejectMcp}
            mcpServerNames={mcpServerNames}
            onEditUserMessage={canEdit ? onEditUserMessage : undefined}
          />
        </div>
        {slice.error ? (
          <div className="mx-6 mb-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {slice.error}
          </div>
        ) : null}
        <MessageComposer
          systemMessage={slice.systemPrompt}
          onSystemMessageChange={slice.setSystemPrompt}
          onSend={onSend}
          onStop={onStop}
          sending={slice.running}
          streaming={slice.running}
          disabled={!slice.selectedConnectionId}
          disabledReason={t("agent.needConnection")}
        />
        {/* Tool bar sits BELOW the composer (mainstream chat layout — the input
            is the primary affordance). The Skill / Tools / MCP selectors are
            ALWAYS visible: picking any of them arms this same chat with tools;
            picking none leaves it a plain streaming chat. No "agent mode". */}
        <div className="flex flex-wrap items-center gap-3 px-6 pb-2 pt-1">
          <AgentComposerControls />
          {canRegenerate ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="ml-auto shrink-0 gap-1.5"
              onClick={onRegenerate}
            >
              <RotateCcw className="size-3.5" aria-hidden="true" />
              {t("agent.regenerate")}
            </Button>
          ) : null}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className={canRegenerate ? "shrink-0" : "ml-auto shrink-0"}
            onClick={onReset}
            disabled={slice.running}
          >
            {t("agent.reset")}
          </Button>
        </div>
      </div>
    </PlaygroundShell>
  );
}
