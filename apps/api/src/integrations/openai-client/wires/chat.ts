import type { ChatMessage, ChatParams, ToolCall } from "@modeldoctor/contracts";

export interface BuildPlaygroundChatBodyInput {
  model: string;
  messages: ChatMessage[];
  params: ChatParams;
}

export function buildPlaygroundChatBody({
  model,
  messages,
  params,
}: BuildPlaygroundChatBodyInput): Record<string, unknown> {
  const body: Record<string, unknown> = { model, messages };
  if (params.temperature !== undefined) body.temperature = params.temperature;
  if (params.maxTokens !== undefined) body.max_tokens = params.maxTokens;
  if (params.topP !== undefined) body.top_p = params.topP;
  if (params.frequencyPenalty !== undefined) body.frequency_penalty = params.frequencyPenalty;
  if (params.presencePenalty !== undefined) body.presence_penalty = params.presencePenalty;
  if (params.seed !== undefined) body.seed = params.seed;
  if (params.stop !== undefined) body.stop = params.stop;
  if (params.stream !== undefined) body.stream = params.stream;
  if (params.tools) {
    body.tools = params.tools;
    if (params.tool_choice !== undefined) body.tool_choice = params.tool_choice;
  }
  return body;
}

export interface ParsedPlaygroundChatResponse {
  content: string;
  usage: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } | undefined;
  tool_calls: ToolCall[] | undefined;
}

export function parsePlaygroundChatResponse(json: unknown): ParsedPlaygroundChatResponse {
  const j = (json ?? {}) as {
    choices?: Array<{ message?: { content?: string; tool_calls?: ToolCall[] } }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
  };
  return {
    content: j.choices?.[0]?.message?.content ?? "",
    usage: j.usage,
    tool_calls: j.choices?.[0]?.message?.tool_calls,
  };
}
