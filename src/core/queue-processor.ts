import { LLMRequest, LLMResponse, LLMRequestType, LLMNextStep, ProviderAccount, ChatMessage, Message, ToolDefinition } from "./types.js";
import { callLLMRaw, parseJSONResponse, cleanResponseContent } from "./llm-client.js";
import { hydratePromptPlaceholders } from "../prompts/message-utils.js";
import { toOpenAITools, executeToolCalls, parseToolCalls } from "./tools/index.js";

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
   * Called when the QueueProcessor needs to enqueue a follow-up request (e.g. HandleToolSynthesis).
   * Injected by Processor pointing to stateManager.queue_enqueue.
   */
  onEnqueue?: EnqueueCallback;
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
      this.abortController = null;
    });
  }

  private async processRequest(request: LLMRequest): Promise<LLMResponse> {
    // =========================================================================
    // Build conversation history (message fetch + placeholder hydration)
    // =========================================================================
    let messages: ChatMessage[] = [];

    const isResponseType = request.type === "response" as LLMRequestType;
    const isToolSynthesis = request.next_step === LLMNextStep.HandleToolSynthesis;

    if (isResponseType || isToolSynthesis) {
      const personaId = request.data.personaId as string | undefined;
      if (personaId && this.currentMessageFetcher) {
        messages = this.currentMessageFetcher(personaId);
      }
    }

    let hydratedSystem = request.system;
    let hydratedUser = request.user;

    if (this.currentRawMessageFetcher) {
      const personaId = request.data.personaId as string | undefined;
      if (personaId) {
        const rawMessages = this.currentRawMessageFetcher(personaId);
        const messageMap = new Map<string, Message>();
        for (const msg of rawMessages) {
          messageMap.set(msg.id, msg);
        }

        const placeholderCount = (request.user.match(/\[mid:[^\]]+\]/g) || []).length;
        console.log(`[QueueProcessor] Hydrating ${placeholderCount} placeholders with ${messageMap.size} messages for ${personaId}`);

        hydratedSystem = hydratePromptPlaceholders(request.system, messageMap);
        hydratedUser = hydratePromptPlaceholders(request.user, messageMap);

        const hydratedPlaceholderCount = (hydratedUser.match(/\[mid:[^\]]+\]/g) || []).length;
        if (hydratedPlaceholderCount > 0) {
          console.log(`[QueueProcessor] WARNING: ${hydratedPlaceholderCount} placeholders not hydrated!`);
        }
      }
    }

    // =========================================================================
    // For HandleToolSynthesis: inject stored tool history into messages.
    // This is the second LLM call — no tools offered, just synthesize.
    // =========================================================================
    if (isToolSynthesis) {
      const rawHistory = request.data.toolHistory as LLMHistoryMessage[] | undefined;
      if (rawHistory && rawHistory.length > 0) {
        messages = [...messages, ...rawHistory] as ChatMessage[];
        console.log(`[QueueProcessor] HandleToolSynthesis: injecting ${rawHistory.length} tool history messages`);
      }

      const { content, finishReason } = await callLLMRaw(
        hydratedSystem,
        hydratedUser,
        messages,
        request.model,
        { signal: this.abortController?.signal },
        this.currentAccounts
      );

      console.log(`[QueueProcessor] HandleToolSynthesis LLM call complete, finish_reason="${finishReason}"`);
      return this.handleResponseType(request, content ?? "", finishReason);
    }

    // =========================================================================
    // Normal single-shot LLM call (with optional tools offered)
    // =========================================================================
    const activeTools = this.currentTools ?? [];
    const openAITools = activeTools.length > 0 ? toOpenAITools(activeTools) : [];
    console.log(`[QueueProcessor] LLM call for ${request.next_step}, tools=${openAITools.length}`);

    const { content, finishReason, rawToolCalls, assistantMessage } = await callLLMRaw(
      hydratedSystem,
      hydratedUser,
      messages,
      request.model,
      { signal: this.abortController?.signal, tools: openAITools },
      this.currentAccounts
    );

    // =========================================================================
    // Tool call path: execute tools, enqueue HandleToolSynthesis, done.
    // =========================================================================
    if (finishReason === "tool_calls" && rawToolCalls?.length) {
      console.log(`[QueueProcessor] finish_reason=tool_calls — executing tools, will enqueue HandleToolSynthesis`);

      const toolCalls = parseToolCalls(rawToolCalls);
      if (toolCalls.length === 0) {
        // Malformed tool_calls — treat as stop.
        console.warn("[QueueProcessor] finish_reason=tool_calls but no valid calls parsed — treating as stop");
        return this.handleResponseType(request, content ?? "", finishReason);
      }

      // Accumulate tool history: assistant message with tool_calls + tool results
      const toolHistory: LLMHistoryMessage[] = [];
      if (assistantMessage) {
        toolHistory.push(assistantMessage as unknown as LLMHistoryMessage);
      }

      const callCounts = new Map<string, number>();
      const totalCalls = { count: 0 };
      const { results } = await executeToolCalls(toolCalls, activeTools, callCounts, totalCalls);

      for (const result of results) {
        toolHistory.push({
          role: "tool",
          content: result.result,
          tool_call_id: result.tool_call_id,
          name: result.name,
        });
      }

      console.log(`[QueueProcessor] Tool execution complete: ${results.length} result(s). Enqueueing HandleToolSynthesis.`);

      if (this.currentOnEnqueue) {
        this.currentOnEnqueue({
          type: request.type,
          priority: request.priority,
          system: request.system,
          user: request.user,
          next_step: LLMNextStep.HandleToolSynthesis,
          model: request.model,
          data: {
            ...request.data,
            toolHistory,
            originalNextStep: request.next_step,
          },
        });
      } else {
        console.warn("[QueueProcessor] No onEnqueue callback — tool results will be lost!");
      }

      // Return a "pending" success that signals the tool phase is done.
      // The actual persona message will arrive when HandleToolSynthesis completes.
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

  private handleResponseType(
    request: LLMRequest,
    content: string,
    finishReason: string | null
  ): LLMResponse {
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

  private handleJSONResponse(
    request: LLMRequest,
    content: string,
    finishReason: string | null
  ): LLMResponse {
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
      return {
        request,
        success: false,
        content,
        error: `JSON parse failed: ${error instanceof Error ? error.message : String(error)}`,
        finish_reason: finishReason ?? undefined,
      };
    }
  }

}
