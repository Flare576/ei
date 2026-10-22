import { resolveCanonicalAgent } from "../../core/personas/opencode-agent.js";
import { stripControlChars } from "../../core/utils/message-refusal.js";

/** Persona for main-session messages that name no agent. */
export const MAIN_SESSION_PERSONA = "OhMyPi";
/** Persona for a sub-agent transcript that names no agent. */
export const SUB_AGENT_FALLBACK_PERSONA = "task";

/** The sanitized agent name, or `fallback` when nothing usable is left of it. */
export function agentNameOr(raw: string | undefined, fallback: string): string {
  const cleaned = stripControlChars(raw ?? "");
  return resolveCanonicalAgent(cleaned).canonical ? cleaned : fallback;
}

/** The display name of the persona an agent's messages are filed under. */
export function agentPersonaName(raw: string | undefined, fallback: string): string {
  return resolveCanonicalAgent(agentNameOr(raw, fallback)).canonical;
}
