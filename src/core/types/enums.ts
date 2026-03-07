/**
 * EI V1 Core Enums
 * Source of truth: CONTRACTS.md
 */

export enum ContextStatus {
  Default = "default",
  Always = "always",
  Never = "never",
}

export enum ValidationLevel {
  None = "none",     // Fresh data, never acknowledged
  Ei = "ei",         // Ei mentioned it to user (don't mention again)
  Human = "human",   // User explicitly confirmed (locked)
}
export enum LLMRequestType {
  Response = "response",
  JSON = "json",
  Raw = "raw",
}

export enum LLMPriority {
  High = "high",
  Normal = "normal",
  Low = "low",
}

export enum LLMNextStep {
  HandlePersonaResponse = "handlePersonaResponse",
  HandlePersonaGeneration = "handlePersonaGeneration",
  HandlePersonaDescriptions = "handlePersonaDescriptions",
  HandleHumanFactScan = "handleHumanFactScan",
  HandleHumanTraitScan = "handleHumanTraitScan",
  HandleHumanTopicScan = "handleHumanTopicScan",
  HandleHumanPersonScan = "handleHumanPersonScan",
  HandleHumanItemMatch = "handleHumanItemMatch",
  HandleHumanItemUpdate = "handleHumanItemUpdate",
  HandlePersonaTraitExtraction = "handlePersonaTraitExtraction",
  HandlePersonaTopicScan = "handlePersonaTopicScan",
  HandlePersonaTopicMatch = "handlePersonaTopicMatch",
  HandlePersonaTopicUpdate = "handlePersonaTopicUpdate",
  HandleHeartbeatCheck = "handleHeartbeatCheck",
  HandleEiHeartbeat = "handleEiHeartbeat",
  HandleOneShot = "handleOneShot",
  HandlePersonaExpire = "handlePersonaExpire",
  HandlePersonaExplore = "handlePersonaExplore",
  HandleDescriptionCheck = "handleDescriptionCheck",
  // Tool calling synthesis (second LLM call after tool execution)
  // data.toolHistory: serialized LLMHistoryMessage[] (assistant + tool result messages)
  // data.originalNextStep: the next_step value from the originating request
  HandleToolSynthesis = "handleToolSynthesis",
  HandleRewriteScan = "handleRewriteScan",
  HandleRewriteRewrite = "handleRewriteRewrite",
}

export enum ProviderType {
  LLM = "llm",
  Storage = "storage",
}
