import { LLMRequest, LLMResponse, LLMRequestType, LLMNextStep, ProviderAccount, ChatMessage, Message, ToolDefinition } from "./types.js";
import { callLLMRaw, parseJSONResponse, cleanResponseContent } from "./llm-client.js";
import { hydratePromptPlaceholders } from "../prompts/message-utils.js";
import { toOpenAITools, executeToolCalls, parseToolCalls, findSubmitToolCall } from "./tools/index.js";

type QueueProcessorState = "idle" | "busy";
type ResponseCallback = (response: LLMResponse) => Promise<void>;
type MessageFetcher = (personaId: string) => ChatMessage[];
type RawMessageFetcher = (personaId: string) => Message[];

/**
 * Superset of ChatMessage that includes OpenAI tool-role fields.
 * Used internally for the tool calling history; cast to ChatMessage[] when passing to callLLMRaw.
 */
export interface LLMHistoryMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_call_id?: string;
  name?: string;
  tool_calls?: unknown[];
}

type EnqueueCallback = (
  request: Omit<LLMRequest, "id" | "created_at" | "attempts" | "state">
) => string;

export interface QueueProcessorStartOptions {
  accounts?: ProviderAccount[];
  messageFetcher?: MessageFetcher;
  rawMessageFetcher?: RawMessageFetcher;
  /** Tools available for this specific request (pre-filtered by runtime and persona assignment). */
  tools?: ToolDefinition[];
  /**
   * Called when the QueueProcessor needs to enqueue a follow-up request (e.g. HandleToolContinuation).
   * Injected by Processor pointing to stateManager.queue_enqueue.
   */
  onEnqueue?: EnqueueCallback;
  /**
   * Called when a tool executor updates its provider config (e.g. Spotify refresh token rotation).
   * Injected by Processor pointing to stateManager.queue_enqueue.
   */
  onProviderConfigUpdate?: (providerId: string, updates: Record<string, string>) => void;
  onUsageUpdate?: (modelId: string, usage: { calls: number; tokens_in: number; tokens_out: number }) => void;
}

export class QueueProcessor {
  private state: QueueProcessorState = "idle";
  private abortController: AbortController | null = null;
  private currentCallback: ResponseCallback | null = null;
  private currentAccounts: ProviderAccount[] | undefined;
  private currentMessageFetcher: MessageFetcher | undefined;
  private currentRawMessageFetcher: RawMessageFetcher | undefined;
  private currentTools: ToolDefinition[] | undefined;
  private currentOnEnqueue: EnqueueCallback | undefined;
  private currentOnProviderConfigUpdate: ((providerId: string, updates: Record<string, string>) => void) | undefined;
  private currentOnUsageUpdate: ((modelId: string, usage: { calls: number; tokens_in: number; tokens_out: number }) => void) | undefined;

  getState(): QueueProcessorState {
    return this.state;
  }

  start(request: LLMRequest, callback: ResponseCallback, options?: QueueProcessorStartOptions): void {
    if (this.state !== "idle") {
      throw new Error("QUEUE_BUSY: QueueProcessor is already processing a request");
    }

    this.state = "busy";
    this.currentCallback = callback;
    this.currentAccounts = options?.accounts;
    this.currentMessageFetcher = options?.messageFetcher;
    this.currentRawMessageFetcher = options?.rawMessageFetcher;
    this.currentTools = options?.tools;
    this.currentOnEnqueue = options?.onEnqueue;
    this.currentOnProviderConfigUpdate = options?.onProviderConfigUpdate;
    this.currentOnUsageUpdate = options?.onUsageUpdate;
    this.abortController = new AbortController();

    this.processRequest(request)
      .then((response) => {
        this.finishWith(response);
      })
      .catch((error) => {
        this.finishWith({
          request,
          success: false,
          content: null,
          error: error instanceof Error ? error.message : String(error),
        });
      });
  }

  abort(): void {
    if (this.abortController) {
      this.abortController.abort();
    }
  }

  private finishWith(response: LLMResponse): void {
    const mortalKombat = this.currentCallback ? this.currentCallback : () => Promise.resolve();
    mortalKombat(response).finally(() => {
      this.state = "idle";
      this.currentCallback = null;
      this.currentAccounts = undefined;
      this.currentMessageFetcher = undefined;
      this.currentRawMessageFetcher = undefined;
      this.currentTools = undefined;
      this.currentOnEnqueue = undefined;
      this.currentOnProviderConfigUpdate = undefined;
      this.abortController = null;
    });
  }

  private async processRequest(request: LLMRequest): Promise<LLMResponse> {
    // =========================================================================
    // Build conversation history (message fetch + placeholder hydration)
    // =========================================================================
    let messages: ChatMessage[] = [];

    const isPersonaResponse = request.next_step === LLMNextStep.HandlePersonaResponse
      || request.next_step === LLMNextStep.HandleRoomResponse
      || request.type === "response" as LLMRequestType;
    const isToolContinuation = request.next_step === LLMNextStep.HandleToolContinuation;

    if (isPersonaResponse || isToolContinuation) {
      const personaId = request.data.personaId as string | undefined;
      const isRoomRequest = !!(request.data.roomId as string | undefined);
      // Room conversation is embedded in the prompt via placeholders — don't inject persona history.
      if (personaId && !isRoomRequest && this.currentMessageFetcher) {
        messages = this.currentMessageFetcher(personaId);
      }
    }

    let hydratedSystem = request.system;
    let hydratedUser = request.user;

    if (this.currentRawMessageFetcher) {
      const personaId = request.data.personaId as string | undefined;
      const roomId = request.data.roomId as string | undefined;
      const fetchId = roomId ? `room:${roomId}` : personaId;
      if (fetchId) {
        const rawMessages = this.currentRawMessageFetcher(fetchId);
        const messageMap = new Map<string, Message>();
        for (const msg of rawMessages) {
          messageMap.set(msg.id, msg);
        }

        const placeholderCount = (request.user.match(/\[mid:[^\]]+\]/g) || []).length;
        console.log(`[QueueProcessor] Hydrating ${placeholderCount} placeholders with ${messageMap.size} messages for ${fetchId}`);

        hydratedSystem = hydratePromptPlaceholders(request.system, messageMap);
        hydratedUser = hydratePromptPlaceholders(request.user, messageMap);

        const hydratedPlaceholderCount = (hydratedUser.match(/\[mid:[^\]]+\]/g) || []).length;
        if (hydratedPlaceholderCount > 0) {
          console.log(`[QueueProcessor] WARNING: ${hydratedPlaceholderCount} placeholders not hydrated!`);
        }
      }
    }

    // =========================================================================
    // For HandleToolContinuation: inject stored tool history and allow another
    // round of tool calls. Loops until LLM stops requesting tools or we hit the
    // hard cap (enforced by executeToolCalls via the shared callCounts/totalCalls).
    // =========================================================================
    if (isToolContinuation) {
      const rawHistory = request.data.toolHistory as LLMHistoryMessage[] | undefined;
      const isRoomContinuation = !!(request.data.roomId as string | undefined);
      if (rawHistory && rawHistory.length > 0) {
        if (isRoomContinuation) {
          // Room: conversation is in hydratedUser (not messages). Place it BEFORE tool history
          // so the LLM sees: context → tool calls → synthesize. Then clear hydratedUser to
          // prevent it from being re-appended at the end by callLLMRaw.
          messages = [
            { role: "user" as const, content: hydratedUser },
            ...rawHistory as ChatMessage[],
          ];
          hydratedUser = "";
        } else {
          messages = [...messages, ...rawHistory] as ChatMessage[];
        }
        console.log(`[QueueProcessor] HandleToolContinuation: injecting ${rawHistory.length} tool history messages`);
      }

      // Restore per-tool call counts carried over from the previous iteration.
      const callCounts = new Map<string, number>(
        (request.data.toolCallCounts as [string, number][] | undefined) ?? []
      );
      const totalCalls = { count: (request.data.totalCallCount as number | undefined) ?? 0 };

      // Restore exhausted tool names from previous iterations and filter them out
      // so the LLM doesn't keep calling tools that have hit their per-interaction limit.
      const priorExhausted = new Set<string>(
        (request.data.exhaustedToolNames as string[] | undefined) ?? []
      );
      const activeTools = (this.currentTools ?? []).filter(t => !priorExhausted.has(t.name));
      const openAITools = activeTools.length > 0 ? toOpenAITools(activeTools) : [];

      const { content, finishReason, rawToolCalls, assistantMessage, thinking } = await callLLMRaw(
        hydratedSystem,
        hydratedUser,
        messages,
        request.model,
        { signal: this.abortController?.signal, tools: openAITools, onUsageUpdate: this.currentOnUsageUpdate },
        this.currentAccounts
      );

      console.log(`[QueueProcessor] HandleToolContinuation LLM call complete, finish_reason="${finishReason}"${thinking ? ` (thinking: ${thinking.length} chars)` : ""}`);
      // TODO(#13): Surface thinking to TUI as 'Beta is thinking...' when streaming is available.

      // If the LLM wants to call more tools, accumulate history and re-enqueue.
      if (finishReason === "tool_calls" && rawToolCalls?.length) {
        const toolCalls = parseToolCalls(rawToolCalls);
        if (toolCalls.length > 0) {
          // Submit tool intercept: if the LLM called submit_response (or any is_submit tool),
          // its arguments ARE the structured response — return immediately without executing.
          const submitCall = findSubmitToolCall(toolCalls, activeTools);
          if (submitCall) {
            const args = submitCall.arguments ?? {};
            if (!args.should_respond && (args.verbal_response || args.action_response)) {
              args.should_respond = true;
            }
            console.log(`[QueueProcessor] submit tool "${submitCall.name}" called — returning arguments as parsed response`);
            return {
              request,
              success: true,
              content: JSON.stringify(args),
              parsed: args,
              finish_reason: "stop",
            };
          }

          const appendedHistory: LLMHistoryMessage[] = [];
          if (assistantMessage) {
            appendedHistory.push(assistantMessage as unknown as LLMHistoryMessage);
          }

          const { results, exhaustedToolNames } = await executeToolCalls(toolCalls, activeTools, callCounts, totalCalls, this.currentOnProviderConfigUpdate);
          for (const result of results) {
            appendedHistory.push({
              role: "tool",
              content: result.result,
              tool_call_id: result.tool_call_id,
              name: result.name,
            });
          }

          const mergedExhausted = new Set([...priorExhausted, ...exhaustedToolNames]);
          const newHistory = [...(rawHistory ?? []), ...appendedHistory];
          console.log(`[QueueProcessor] HandleToolContinuation: ${results.length} more tool result(s). Re-enqueueing.`);

          if (this.currentOnEnqueue) {
            this.currentOnEnqueue({
              type: request.type,
              priority: request.priority,
              system: request.system,
              user: request.user,
              next_step: LLMNextStep.HandleToolContinuation,
              model: request.model,
              data: {
                ...request.data,
                toolHistory: newHistory,
                toolCallCounts: [...callCounts.entries()],
                totalCallCount: totalCalls.count,
                exhaustedToolNames: [...mergedExhausted],
              },
            });
          } else {
            console.warn("[QueueProcessor] No onEnqueue callback — continuation tool results lost!");
          }

          return {
            request,
            success: true,
            content: null,
            finish_reason: "tool_calls_enqueued",
          };
        }
      }

      // LLM stopped — parse and return.
      // If JSON parse fails, attempt a single reformat pass: treat the prose as
      // a tool result and ask the same model to convert it to the required JSON shape.
      const firstAttempt = await this.handleResponseType(request, content ?? "", finishReason);
      if (!firstAttempt.success && content) {
        console.log(`[QueueProcessor] HandleToolContinuation: JSON parse failed — attempting reformat pass`);
        const reformatResult = await this.attemptReformat(request, messages, content);
        if (reformatResult) return reformatResult;
      }
      return firstAttempt;
    }

    // =========================================================================
    // Normal single-shot LLM call (with optional tools offered)
    // =========================================================================
    const activeTools = this.currentTools ?? [];
    const openAITools = activeTools.length > 0 ? toOpenAITools(activeTools) : [];
    const isHeartbeat = request.next_step === LLMNextStep.HandleHeartbeatCheck || request.next_step === LLMNextStep.HandleEiHeartbeat;
    if (isHeartbeat) {
      const personaName = request.data.personaDisplayName as string | undefined ?? 'Ei';
      console.log(`[${personaName} Heartbeat] LLM call - tools offered: ${openAITools.length} (${activeTools.map(t => t.name).join(', ') || 'none'})`);
    } else {
      console.log(`[QueueProcessor] LLM call for ${request.next_step}, tools=${openAITools.length}`);
    }

    const { content, finishReason, rawToolCalls, assistantMessage, thinking } = await callLLMRaw(
      hydratedSystem,
      hydratedUser,
      messages,
      request.model,
      { signal: this.abortController?.signal, tools: openAITools, onUsageUpdate: this.currentOnUsageUpdate },
      this.currentAccounts
    );
    if (thinking) {
      console.log(`[QueueProcessor] Extended thinking on ${request.next_step} (${thinking.length} chars) — TODO(#13): stream to TUI`);
    }

    // =========================================================================
    // Tool call path: execute tools, enqueue HandleToolContinuation, done.
    // =========================================================================
    if (finishReason === "tool_calls" && rawToolCalls?.length) {
      console.log(`[QueueProcessor] finish_reason=tool_calls — executing tools, will enqueue HandleToolContinuation`);

      const toolCalls = parseToolCalls(rawToolCalls);
      if (toolCalls.length === 0) {
        // Malformed tool_calls — treat as stop.
        console.warn("[QueueProcessor] finish_reason=tool_calls but no valid calls parsed — treating as stop");
        return this.handleResponseType(request, content ?? "", finishReason);
      }

      // Submit tool intercept: if the LLM called submit_response (or any is_submit tool),
      // its arguments ARE the structured response — return immediately without executing.
      const submitCall = findSubmitToolCall(toolCalls, activeTools);
      if (submitCall) {
        const args = submitCall.arguments ?? {};
        if (!args.should_respond && (args.verbal_response || args.action_response)) {
          args.should_respond = true;
        }
        console.log(`[QueueProcessor] submit tool "${submitCall.name}" called — returning arguments as parsed response`);
        return {
          request,
          success: true,
          content: JSON.stringify(args),
          parsed: args,
          finish_reason: "stop",
        };
      }

      // Accumulate tool history: assistant message with tool_calls + tool results
      const toolHistory: LLMHistoryMessage[] = [];
      if (assistantMessage) {
        toolHistory.push(assistantMessage as unknown as LLMHistoryMessage);
      }

      const callCounts = new Map<string, number>();
      const totalCalls = { count: 0 };
      const { results } = await executeToolCalls(toolCalls, activeTools, callCounts, totalCalls, this.currentOnProviderConfigUpdate);

      for (const result of results) {
        toolHistory.push({
          role: "tool",
          content: result.result,
          tool_call_id: result.tool_call_id,
          name: result.name,
        });
      }

      console.log(`[QueueProcessor] Tool execution complete: ${results.length} result(s). Enqueueing HandleToolContinuation.`);

      if (this.currentOnEnqueue) {
        this.currentOnEnqueue({
          type: request.type,
          priority: request.priority,
          system: request.system,
          user: request.user,
          next_step: LLMNextStep.HandleToolContinuation,
          model: request.model,
          data: {
            ...request.data,
            toolHistory,
            toolCallCounts: [...callCounts.entries()],
            totalCallCount: totalCalls.count,
            originalNextStep: request.next_step,
          },
        });
      } else {
        console.warn("[QueueProcessor] No onEnqueue callback — tool results will be lost!");
      }

      // Return a "pending" success that signals the tool phase is done.
      // The actual persona message will arrive when HandleToolContinuation completes.
      return {
        request,
        success: true,
        content: null,
        finish_reason: "tool_calls_enqueued",
      };
    }

    // =========================================================================
    // Guard: null/empty content → error
    // =========================================================================
    if (!content) {
      return {
        request,
        success: false,
        content: null,
        error: "Empty response from LLM",
        finish_reason: finishReason ?? undefined,
      };
    }

    // =========================================================================
    // Normal stop path
    // =========================================================================
    console.log(`[QueueProcessor] finish_reason="${finishReason}" — normal stop`);
    return this.handleResponseType(request, content ?? "", finishReason);
  }

  private async handleResponseType(
    request: LLMRequest,
    content: string,
    finishReason: string | null
  ): Promise<LLMResponse> {
    const cleanedContent = cleanResponseContent(content);
    switch (request.type) {
      case "json" as LLMRequestType:
      case "response" as LLMRequestType:
        return this.handleJSONResponse(request, cleanedContent, finishReason);
      case "raw" as LLMRequestType:
      default:
        return {
          request,
          success: true,
          content: cleanedContent,
          finish_reason: finishReason ?? undefined,
        };
    }
  }

  private async handleJSONResponse(
    request: LLMRequest,
    content: string,
    finishReason: string | null
  ): Promise<LLMResponse> {
    try {
      const parsed = parseJSONResponse(content);
      return {
        request,
        success: true,
        content,
        parsed,
        finish_reason: finishReason ?? undefined,
      };
    } catch (error) {
      console.warn(
        `[QueueProcessor] JSON parse failed for ${request.next_step}. Payload:\n${content}`
      );
      const reformatResult = await this.attemptJSONReformat(request, content);
      if (reformatResult) return reformatResult;
      return {
        request,
        success: false,
        content,
        error: `JSON parse failed: ${error instanceof Error ? error.message : String(error)}`,
        finish_reason: finishReason ?? undefined,
      };
    }
  }

  /**
   * When HandleToolContinuation gets valid-looking prose instead of JSON, attempt a
   * single synchronous reformat pass rather than falling into the backoff retry loop.
   *
   * Strategy: treat the prose as a synthetic tool result and ask the same model to
   * convert it to the required JSON response format. This avoids the 'yell louder'
   * arms race — we’re not repeating the same failed instruction, we’re giving the model
   * a concrete reformatting task with the actual content it already produced.
   *
   * Returns null if the reformat attempt also fails — caller falls through to normal
   * failure path (backoff retry).
   */
  private async attemptReformat(
    request: LLMRequest,
    messages: ChatMessage[],
    proseContent: string
  ): Promise<LLMResponse | null> {
    const reformatUserPrompt =
      `An earlier version of you responded with the following content, but not in the ` +
      `required JSON format. Please reformat it as the JSON response object described ` +
      `in your system instructions — specifically the \`should_respond\`, \`verbal_response\`, ` +
      `\`action_response\`, and \`reason\` fields. Respond with ONLY the JSON object.\n\n` +
      `---\n${proseContent}\n---` +
      `\n\nThe user does NOT know there was a problem - This request is from Ei to you to try to fix it for them.` +
      `\n\n**CRITICAL INSTRUCTION** - DO NOT OMIT ANY DATA. You are this agent's last hope!`;

    try {
      const { content: reformatContent, finishReason: reformatReason } = await callLLMRaw(
        request.system,
        reformatUserPrompt,
        messages, // existing tool history — gives full context without duplicating the ask
        request.model,
        { signal: this.abortController?.signal, onUsageUpdate: this.currentOnUsageUpdate },
        this.currentAccounts
      );

      if (!reformatContent) return null;

      const cleaned = cleanResponseContent(reformatContent);
      try {
        const parsed = parseJSONResponse(cleaned);
        console.log(`[QueueProcessor] Reformat pass succeeded for handleToolContinuation`);
        return {
          request,
          success: true,
          content: cleaned,
          parsed,
          finish_reason: reformatReason ?? undefined,
        };
      } catch {
        console.warn(`[QueueProcessor] Reformat pass also failed to produce JSON — falling through to retry`);
        return null;
      }
    } catch (err) {
      console.warn(`[QueueProcessor] Reformat pass LLM call failed: ${err instanceof Error ? err.message : String(err)}`);
      return null;
    }
  }

  /**
   * When any JSON request gets back content that won't parse, attempt a single
   * synchronous reformat pass before falling into the backoff retry loop.
   *
   * The system prompt already contains the full JSON schema for this request type
   * (field names, type-specific extras like `category`, `relationship`, `strength`,
   * etc.), so we don't need to repeat any of that here — just hand the model its
   * own output and ask it to clean it up.
   *
   * Returns null if the reformat attempt also fails — caller falls through to normal
   * failure path (backoff retry).
   */
  private async attemptJSONReformat(
    request: LLMRequest,
    malformedContent: string
  ): Promise<LLMResponse | null> {
    const reformatUserPrompt =
      `An earlier version of you responded with the following content, but it could not ` +
      `be parsed as valid JSON. Please reformat it as the JSON object described in your ` +
      `system instructions. Respond with ONLY the JSON object, or \`{}\` if no changes ` +
      `are needed.\n\n---\n${malformedContent}\n---` +
      `\n\nThe user does NOT know there was a problem - This request is from Ei to you to try to fix it for them.` +
      `\n\n**CRITICAL INSTRUCTION** - DO NOT OMIT ANY DATA. You are this agent's last hope!`;

    try {
      const { content: reformatContent, finishReason: reformatReason } = await callLLMRaw(
        request.system,
        reformatUserPrompt,
        [], // no message history needed — schema is already in the system prompt
        request.model,
        { signal: this.abortController?.signal, onUsageUpdate: this.currentOnUsageUpdate },
        this.currentAccounts
      );

      if (!reformatContent) return null;

      const cleaned = cleanResponseContent(reformatContent);
      try {
        const parsed = parseJSONResponse(cleaned);
        console.log(`[QueueProcessor] JSON reformat pass succeeded for ${request.next_step} — saved a retry`);
        return {
          request,
          success: true,
          content: cleaned,
          parsed,
          finish_reason: reformatReason ?? undefined,
        };
      } catch {
        console.warn(`[QueueProcessor] JSON reformat pass also failed for ${request.next_step} — falling through to retry`);
        return null;
      }
    } catch (err) {
      console.warn(`[QueueProcessor] JSON reformat LLM call failed for ${request.next_step}: ${err instanceof Error ? err.message : String(err)}`);
      return null;
    }
  }

}
