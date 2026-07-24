import type { Store } from "@emulators/core";
import type {
  AnthropicMessage,
  ContentBlock,
  ResponseMatcher,
  StopReason,
} from "./entities.js";
import { getAnthropicStore, getResponseMatchers } from "./store.js";
import {
  applyMaxTokens,
  applyStopSequences,
  buildMessage,
  estimateInputTokens,
  lastUserText,
  makeUsage,
  outputTokensFromContent,
  textBlock,
  thinkingBlock,
  toolUseBlock,
} from "./helpers.js";

export interface MessageRequestParams {
  model: string;
  max_tokens: number;
  messages: Array<Record<string, unknown>>;
  system?: unknown;
  tools?: Array<Record<string, unknown>>;
  tool_choice?: { type?: string; name?: string } | string;
  temperature?: number;
  top_p?: number;
  top_k?: number;
  stop_sequences?: string[];
  stream?: boolean;
  metadata?: unknown;
  thinking?: { type?: string; budget_tokens?: number };
}

export function resolveModelId(store: Store, modelId: string): string | null {
  const as = getAnthropicStore(store);
  const direct = as.models.findOneBy("model_id", modelId);
  if (direct) {
    return direct.alias_of ?? direct.model_id;
  }
  return null;
}

export function findMatcher(
  matchers: ResponseMatcher[],
  model: string,
  userText: string,
): ResponseMatcher | undefined {
  for (const matcher of matchers) {
    const m = matcher.match ?? {};
    if (m.model && m.model !== model) continue;
    if (m.content_contains && !userText.includes(m.content_contains)) continue;
    return matcher;
  }
  return undefined;
}

function toolChoiceType(toolChoice: MessageRequestParams["tool_choice"]): string | undefined {
  if (!toolChoice) return undefined;
  if (typeof toolChoice === "string") return toolChoice;
  return toolChoice.type;
}

function toolChoiceName(toolChoice: MessageRequestParams["tool_choice"]): string | undefined {
  if (!toolChoice || typeof toolChoice === "string") return undefined;
  return toolChoice.name;
}

export function generateAssistantMessage(store: Store, params: MessageRequestParams): AnthropicMessage {
  const resolvedModel = resolveModelId(store, params.model) ?? params.model;
  const userText = lastUserText(params.messages);
  const matchers = getResponseMatchers(store);
  const matcher = findMatcher(matchers, params.model, userText) ?? findMatcher(matchers, resolvedModel, userText);

  const inputTokens = estimateInputTokens({
    model: params.model,
    messages: params.messages,
    system: params.system,
    tools: params.tools,
  });

  const content: ContentBlock[] = [];
  const thinkingEnabled = params.thinking?.type === "enabled";
  if (thinkingEnabled) {
    content.push(
      thinkingBlock(
        `Considering the request: ${userText.slice(0, 120) || "empty prompt"}`,
      ),
    );
  }

  const choiceType = toolChoiceType(params.tool_choice);
  const tools = params.tools ?? [];
  const shouldToolUse =
    tools.length > 0 &&
    choiceType !== "none" &&
    (Boolean(matcher?.tool_call) || choiceType === "any" || choiceType === "tool");

  if (shouldToolUse) {
    let toolName = matcher?.tool_call?.name;
    let toolInput = matcher?.tool_call?.input ?? {};

    if (choiceType === "tool") {
      toolName = toolChoiceName(params.tool_choice) ?? toolName ?? String(tools[0]?.name ?? "tool");
    } else if (!toolName) {
      toolName = String(tools[0]?.name ?? "tool");
    }

    if (!matcher?.tool_call) {
      toolInput = { query: userText.slice(0, 200) };
    }

    content.push(toolUseBlock(toolName, toolInput));
    const usage = makeUsage(inputTokens, outputTokensFromContent(content));
    return buildMessage({
      model: resolvedModel,
      content,
      stopReason: "tool_use",
      stopSequence: null,
      usage,
    });
  }

  let reply = matcher?.reply;
  if (reply == null) {
    reply = userText ? `Emulated response to: ${userText}` : "Emulated response.";
  }

  let stopReason: StopReason = "end_turn";
  let stopSequence: string | null = null;

  const stopped = applyStopSequences(reply, params.stop_sequences);
  reply = stopped.text;
  stopReason = stopped.stopReason;
  stopSequence = stopped.stopSequence;

  const capped = applyMaxTokens(reply, params.max_tokens, stopReason, stopSequence);
  reply = capped.text;
  stopReason = capped.stopReason;
  stopSequence = capped.stopSequence;

  content.push(textBlock(reply));
  const usage = makeUsage(inputTokens, outputTokensFromContent(content));
  return buildMessage({
    model: resolvedModel,
    content,
    stopReason,
    stopSequence,
    usage,
  });
}

export function validateMessagesRequest(
  body: Record<string, unknown>,
): { ok: true; params: MessageRequestParams } | { ok: false; message: string; status?: number; type?: "invalid_request_error" | "not_found_error" } {
  if (body.model == null || body.model === "") {
    return { ok: false, message: "model: Field required" };
  }
  if (body.max_tokens == null) {
    return { ok: false, message: "max_tokens: Field required" };
  }
  if (typeof body.max_tokens !== "number" || !Number.isFinite(body.max_tokens)) {
    return { ok: false, message: "max_tokens: Input should be a valid integer" };
  }
  if (body.messages == null) {
    return { ok: false, message: "messages: Field required" };
  }
  if (!Array.isArray(body.messages)) {
    return { ok: false, message: "messages: Input should be a valid list" };
  }
  if (body.messages.length === 0) {
    return { ok: false, message: "messages: Input should be a valid list" };
  }

  const messages = body.messages as Array<Record<string, unknown>>;
  if (messages[0]?.role !== "user") {
    return {
      ok: false,
      message: 'messages: first message must use the "user" role',
    };
  }

  let expected: "user" | "assistant" = "user";
  for (let i = 0; i < messages.length; i++) {
    const role = messages[i]?.role;
    if (role !== "user" && role !== "assistant") {
      return { ok: false, message: `messages.${i}.role: Input should be 'user' or 'assistant'` };
    }
    if (role !== expected) {
      return {
        ok: false,
        message: 'messages: roles must alternate between "user" and "assistant", and start with "user"',
      };
    }
    expected = expected === "user" ? "assistant" : "user";
  }

  return {
    ok: true,
    params: {
      model: String(body.model),
      max_tokens: body.max_tokens as number,
      messages,
      system: body.system,
      tools: body.tools as Array<Record<string, unknown>> | undefined,
      tool_choice: body.tool_choice as MessageRequestParams["tool_choice"],
      temperature: body.temperature as number | undefined,
      top_p: body.top_p as number | undefined,
      top_k: body.top_k as number | undefined,
      stop_sequences: body.stop_sequences as string[] | undefined,
      stream: Boolean(body.stream),
      metadata: body.metadata,
      thinking: body.thinking as MessageRequestParams["thinking"],
    },
  };
}
