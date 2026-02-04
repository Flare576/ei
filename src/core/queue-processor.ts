import type { LLMRequest, LLMResponse, LLMRequestType, ProviderAccount, ChatMessage, Message } from "./types.js";
import { callLLMRaw, parseJSONResponse, cleanResponseContent } from "./llm-client.js";
import { hydratePromptPlaceholders } from "../prompts/message-utils.js";

type QueueProcessorState = "idle" | "busy";
type ResponseCallback = (response: LLMResponse) => void;
type MessageFetcher = (personaName: string) => ChatMessage[];
type RawMessageFetcher = (personaName: string) => Message[];

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
    const callback = this.currentCallback;
    this.state = "idle";
    this.currentCallback = null;
    this.currentAccounts = undefined;
    this.currentMessageFetcher = undefined;
    this.currentRawMessageFetcher = undefined;
    this.abortController = null;
    callback?.(response);
  }

  private async processRequest(request: LLMRequest): Promise<LLMResponse> {
    let messages: ChatMessage[] = [];
    
    if (request.type === "response" as LLMRequestType) {
      const personaName = request.data.personaName as string | undefined;
      if (personaName && this.currentMessageFetcher) {
        messages = this.currentMessageFetcher(personaName);
      }
    }

    let hydratedSystem = request.system;
    let hydratedUser = request.user;
    
    if (this.currentRawMessageFetcher) {
      const personaName = request.data.personaName as string | undefined;
      if (personaName) {
        const rawMessages = this.currentRawMessageFetcher(personaName);
        const messageMap = new Map<string, Message>();
        for (const msg of rawMessages) {
          messageMap.set(msg.id, msg);
        }
        
        hydratedSystem = hydratePromptPlaceholders(request.system, messageMap);
        hydratedUser = hydratePromptPlaceholders(request.user, messageMap);
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
        return this.handleJSONResponse(request, content, finishReason);
      case "response" as LLMRequestType:
        return this.handleConversationResponse(request, content, finishReason);
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

  private handleConversationResponse(
    request: LLMRequest,
    content: string,
    finishReason: string | null
  ): LLMResponse {
    const cleaned = cleanResponseContent(content);
    
    const noMessagePatterns = [
      /^no\s*(new\s*)?(message|response)/i,
      /^nothing\s+to\s+(say|add)/i,
      /^\[no\s+message\]/i,
    ];
    
    const isNoMessage = noMessagePatterns.some((p) => p.test(cleaned));
    
    return {
      request,
      success: true,
      content: isNoMessage ? null : cleaned,
      finish_reason: finishReason ?? undefined,
    };
  }
}
