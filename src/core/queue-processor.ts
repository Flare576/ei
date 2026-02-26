import { LLMRequest, LLMResponse, LLMRequestType, ProviderAccount, ChatMessage, Message } from "./types.js";
import { callLLMRaw, parseJSONResponse } from "./llm-client.js";
import { hydratePromptPlaceholders } from "../prompts/message-utils.js";

type QueueProcessorState = "idle" | "busy";
type ResponseCallback = (response: LLMResponse) => Promise<void>;
type MessageFetcher = (personaId: string) => ChatMessage[];
type RawMessageFetcher = (personaId: string) => Message[];

export interface QueueProcessorStartOptions {
  accounts?: ProviderAccount[];
  messageFetcher?: MessageFetcher;
  rawMessageFetcher?: RawMessageFetcher;
}

export class QueueProcessor {
  private state: QueueProcessorState = "idle";
  private abortController: AbortController | null = null;
  private currentCallback: ResponseCallback | null = null;
  private currentAccounts: ProviderAccount[] | undefined;
  private currentMessageFetcher: MessageFetcher | undefined;
  private currentRawMessageFetcher: RawMessageFetcher | undefined;

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
      this.abortController = null;
    });
  }

  private async processRequest(request: LLMRequest): Promise<LLMResponse> {
    let messages: ChatMessage[] = [];
    
    if (request.type === "response" as LLMRequestType) {
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

    const { content, finishReason } = await callLLMRaw(
      hydratedSystem,
      hydratedUser,
      messages,
      request.model,
      { signal: this.abortController?.signal },
      this.currentAccounts
    );

    if (!content) {
      return {
        request,
        success: false,
        content: null,
        error: "Empty response from LLM",
        finish_reason: finishReason ?? undefined,
      };
    }

    return this.handleResponseType(request, content, finishReason);
  }

  private handleResponseType(
    request: LLMRequest,
    content: string,
    finishReason: string | null
  ): LLMResponse {
    switch (request.type) {
      case "json" as LLMRequestType:
      case "response" as LLMRequestType:
        return this.handleJSONResponse(request, content, finishReason);
      case "raw" as LLMRequestType:
      default:
        return {
          request,
          success: true,
          content,
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
