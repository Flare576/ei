/**
 * EI V1 Core Enums
 * Source of truth: CONTRACTS.md
 */

export enum ContextStatus {
  Default = "default",
  Always = "always",
  Never = "never",
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
  HandleFactFind = "handleFactFind",
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
  // Tool calling continuation (second LLM call after tool execution, may loop for more tool calls).
  // data.toolHistory: serialized LLMHistoryMessage[] (assistant + tool result messages)
  // data.toolCallCounts: serialized Map entries [[name, count], ...] carrying per-tool call counts
  // data.originalNextStep: the next_step value from the originating request
  HandleToolContinuation = "handleToolContinuation",
  HandleRewriteScan = "handleRewriteScan",
  HandleRewriteRewrite = "handleRewriteRewrite",
  HandleDedupCurate = "handleDedupCurate",
}

export enum ProviderType {
  LLM = "llm",
  Storage = "storage",
  Image = "image",
}
