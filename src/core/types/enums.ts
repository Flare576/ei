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
  Judge = "judge",
  Room = "room",
  Normal = "normal",
  Low = "low",
}

export enum LLMNextStep {
  HandlePersonaResponse = "handlePersonaResponse",
  HandlePersonaGeneration = "handlePersonaGeneration",
  HandlePersonaDescriptions = "handlePersonaDescriptions",
  HandleFactFind = "handleFactFind",
  HandleHumanTopicScan = "handleHumanTopicScan",
  HandleHumanPersonScan = "handleHumanPersonScan",
  HandleTopicMatch = "handleTopicMatch",
  HandleTopicUpdate = "handleTopicUpdate",
  HandlePersonMatch = "handlePersonMatch",
  HandlePersonUpdate = "handlePersonUpdate",
  HandlePersonaTraitExtraction = "handlePersonaTraitExtraction",
  HandlePersonaTopicRating = "handlePersonaTopicRating",
  HandleHeartbeatCheck = "handleHeartbeatCheck",
  HandleEiHeartbeat = "handleEiHeartbeat",
  HandleOneShot = "handleOneShot",
  // Tool calling continuation (second LLM call after tool execution, may loop for more tool calls).
  // data.toolHistory: serialized LLMHistoryMessage[] (assistant + tool result messages)
  // data.toolCallCounts: serialized Map entries [[name, count], ...] carrying per-tool call counts
  // data.originalNextStep: the next_step value from the originating request
  HandleToolContinuation = "handleToolContinuation",
  HandleRewriteScan = "handleRewriteScan",
  HandleRewriteRewrite = "handleRewriteRewrite",
  HandleDedupCurate = "handleDedupCurate",
  HandleEventScan = "handleEventScan",
  HandleRoomResponse = "handleRoomResponse",
  HandleRoomJudge = "handleRoomJudge",
  HandlePersonaPreview = "handlePersonaPreview",
  HandlePersonIdentifierMigration = "handlePersonIdentifierMigration",
}

export enum ProviderType {
  LLM = "llm",
  Storage = "storage",
  Image = "image",
}

export enum RoomMode {
  ChooseYourPath = "choose_your_path",
  FreeForAll = "free_for_all",
  MessagesAgainstPersona = "messages_against_persona",
}
