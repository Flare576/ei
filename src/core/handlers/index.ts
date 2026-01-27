import { ContextStatus, type LLMResponse, type LLMNextStep, type Message } from "../types.js";
import type { StateManager } from "../state-manager.js";

export type ResponseHandler = (response: LLMResponse, state: StateManager) => void;

function handlePersonaResponse(response: LLMResponse, state: StateManager): void {
  const personaName = response.request.data.personaName as string;
  if (!personaName) {
    console.error("[handlePersonaResponse] No personaName in request data");
    return;
  }

  if (!response.content) {
    console.log("[handlePersonaResponse] No content in response (persona chose not to respond)");
    return;
  }

  const message: Message = {
    id: crypto.randomUUID(),
    role: "system",
    content: response.content,
    timestamp: new Date().toISOString(),
    read: false,
    context_status: ContextStatus.Default,
  };

  state.messages_append(personaName, message);
  console.log(`[handlePersonaResponse] Appended response to ${personaName}`);
}

export const handlers: Record<LLMNextStep, ResponseHandler> = {
  handlePersonaResponse,
  handlePersonaGeneration: stubHandler("handlePersonaGeneration"),
  handlePersonaDescriptions: stubHandler("handlePersonaDescriptions"),
  handleHumanFactScan: stubHandler("handleHumanFactScan"),
  handleHumanTraitScan: stubHandler("handleHumanTraitScan"),
  handleHumanTopicScan: stubHandler("handleHumanTopicScan"),
  handleHumanPersonScan: stubHandler("handleHumanPersonScan"),
  handleHumanItemMatch: stubHandler("handleHumanItemMatch"),
  handleHumanItemUpdate: stubHandler("handleHumanItemUpdate"),
  handlePersonaTraitExtraction: stubHandler("handlePersonaTraitExtraction"),
  handlePersonaTopicDetection: stubHandler("handlePersonaTopicDetection"),
  handlePersonaTopicExploration: stubHandler("handlePersonaTopicExploration"),
  handleHeartbeatCheck: stubHandler("handleHeartbeatCheck"),
  handleEiHeartbeat: stubHandler("handleEiHeartbeat"),
  handleEiValidation: stubHandler("handleEiValidation"),
};

function stubHandler(name: string): ResponseHandler {
  return (response, _state) => {
    console.log(`[STUB] ${name}:`, response.success ? "success" : "failed");
  };
}
