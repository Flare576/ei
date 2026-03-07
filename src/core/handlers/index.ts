import { LLMNextStep } from "../types.js";
import type { ResponseHandler } from "./persona-response.js";

export type { ResponseHandler } from "./persona-response.js";
export { registerSearchHumanData } from "./rewrite.js";

import { handlePersonaResponse, handleToolSynthesis, handleOneShot } from "./persona-response.js";
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
import { handleHumanFactScan, handleHumanTraitScan, handleHumanTopicScan, handleHumanPersonScan } from "./human-extraction.js";
import { handleHumanItemMatch, handleHumanItemUpdate } from "./human-matching.js";
import { handleRewriteScan, handleRewriteRewrite } from "./rewrite.js";

export const handlers: Record<LLMNextStep, ResponseHandler> = {
  handlePersonaResponse,
  handlePersonaGeneration,
  handlePersonaDescriptions,
  handleHumanFactScan,
  handleHumanTraitScan,
  handleHumanTopicScan,
  handleHumanPersonScan,
  handleHumanItemMatch,
  handleHumanItemUpdate,
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
  handleToolSynthesis,
  handleRewriteScan,
  handleRewriteRewrite,
};
