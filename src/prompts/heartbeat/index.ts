/**
 * Heartbeat Prompts
 * 
 * Prompts for persona heartbeat checks - proactive outreach decisions.
 */

export { buildHeartbeatCheckPrompt } from "./check.js";
export { buildEiHeartbeatPrompt } from "./ei.js";
export type {
  HeartbeatCheckPromptData,
  HeartbeatCheckResult,
  EiHeartbeatPromptData,
  EiHeartbeatResult,
  PromptOutput,
} from "./types.js";
