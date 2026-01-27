import type { LLMRequest, LLMResponse, LLMRequestType } from "./types.js";
import { callLLMRaw, parseJSONResponse, cleanResponseContent } from "./llm-client.js";

type QueueProcessorState = "idle" | "busy";
type ResponseCallback = (response: LLMResponse) => void;

export class QueueProcessor {
  private state: QueueProcessorState = "idle";
  private abortController: AbortController | null = null;
  private currentCallback: ResponseCallback | null = null;

  getState(): QueueProcessorState {
    return this.state;
  }

  start(request: LLMRequest, callback: ResponseCallback): void {
    if (this.state !== "idle") {
      throw new Error("QUEUE_BUSY: QueueProcessor is already processing a request");
    }

    this.state = "busy";
    this.currentCallback = callback;
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
    this.abortController = null;
    callback?.(response);
  }

  private async processRequest(request: LLMRequest): Promise<LLMResponse> {
    const { content, finishReason } = await callLLMRaw(
      request.system,
      request.user,
      request.messages ?? [],
      request.model,
      { signal: this.abortController?.signal }
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
