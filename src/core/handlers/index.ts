import { LLMNextStep } from "../types.js";
import type { ResponseHandler } from "./persona-response.js";

export type { ResponseHandler } from "./persona-response.js";

import { handlePersonaResponse, handleToolContinuation, handleOneShot } from "./persona-response.js";
import { handleHeartbeatCheck, handleEiHeartbeat } from "./heartbeat.js";
import { handlePersonaGeneration, handlePersonaDescriptions, handlePersonaTraitExtraction } from "./persona-generation.js";
import {
  handlePersonaExpire,
  handlePersonaExplore,
  handleDescriptionCheck,
  handlePersonaTopicScan,
  handlePersonaTopicMatch,
  handlePersonaTopicUpdate,
} from "./persona-topics.js";
import { handleFactFind, handleHumanTopicScan, handleHumanPersonScan } from "./human-extraction.js";
import { handleTopicMatch, handleTopicUpdate, handlePersonMatch, handlePersonUpdate } from "./human-matching.js";
import { handleRewriteScan, handleRewriteRewrite } from "./rewrite.js";
import { handleDedupCurate } from "./dedup.js";

export const handlers: Record<LLMNextStep, ResponseHandler> = {
  handlePersonaResponse,
  handlePersonaGeneration,
  handlePersonaDescriptions,
  handleFactFind,
  handleHumanTopicScan,
  handleHumanPersonScan,
  handleTopicMatch,
  handleTopicUpdate,
  handlePersonMatch,
  handlePersonUpdate,
  handlePersonaTraitExtraction,
  handlePersonaTopicScan,
  handlePersonaTopicMatch,
  handlePersonaTopicUpdate,
  handleHeartbeatCheck,
  handleEiHeartbeat,
  handleOneShot,
  handlePersonaExpire,
  handlePersonaExplore,
  handleDescriptionCheck,
  handleToolContinuation,
  handleRewriteScan,
  handleRewriteRewrite,
  handleDedupCurate,
};
