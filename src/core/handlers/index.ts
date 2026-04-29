import { LLMNextStep } from "../types.js";
import type { ResponseHandler } from "./persona-response.js";

export type { ResponseHandler } from "./persona-response.js";

import { handlePersonaResponse, handleToolContinuation, handleOneShot, handleOneShotJSON } from "./persona-response.js";
import { handleHeartbeatCheck, handleEiHeartbeat, handleReflectionCritic } from "./heartbeat.js";
import { handlePersonaGeneration, handlePersonaTraitExtraction } from "./persona-generation.js";
import {
  handlePersonaTopicRating,
} from "./persona-topics.js";
import { handleFactFind, handleHumanTopicScan, handleHumanPersonScan, handleEventScan } from "./human-extraction.js";
import { handleTopicMatch, handleTopicUpdate, handlePersonUpdate } from "./human-matching.js";
import { handleRewriteScan, handleRewriteRewrite } from "./rewrite.js";
import { handleDedupCurate } from "./dedup.js";
import { handleRoomResponse, handleRoomJudge } from "./rooms.js";
import { handlePersonaPreview } from "./persona-preview.js";

export const handlers: Record<LLMNextStep, ResponseHandler> = {
  handlePersonaResponse,
  handlePersonaGeneration,
  handleFactFind,
  handleHumanTopicScan,
  handleHumanPersonScan,
  handleTopicMatch,
  handleTopicUpdate,
  handlePersonUpdate,
  handlePersonaTraitExtraction,
  handlePersonaTopicRating,
  handleHeartbeatCheck,
  handleEiHeartbeat,
  handleOneShot,
  handleOneShotJSON,
  handleToolContinuation,
  handleRewriteScan,
  handleRewriteRewrite,
  handleDedupCurate,
  handleEventScan,
  handleRoomResponse,
  handleRoomJudge,
  handlePersonaPreview,
  [LLMNextStep.HandleTopicValidate]: handleDedupCurate,
  [LLMNextStep.HandleReflectionCritic]: handleReflectionCritic,
};
