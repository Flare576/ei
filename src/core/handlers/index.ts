import { LLMNextStep } from "../types.js";
import type { LLMResponse } from "../types.js";
import type { StateManager } from "../state-manager.js";
import type { ResponseHandler } from "./persona-response.js";
import type { PersonIdentifier } from "../types/data-items.js";

export type { ResponseHandler } from "./persona-response.js";

import { handlePersonaResponse, handleToolContinuation, handleOneShot, handleOneShotJSON } from "./persona-response.js";
import { handleHeartbeatCheck, handleEiHeartbeat, handleReflectionCritic } from "./heartbeat.js";
import { handlePersonaGeneration, handlePersonaDescriptions, handlePersonaTraitExtraction } from "./persona-generation.js";
import {
  handlePersonaTopicRating,
} from "./persona-topics.js";
import { handleFactFind, handleHumanTopicScan, handleHumanPersonScan, handleEventScan } from "./human-extraction.js";
import { handleTopicMatch, handleTopicUpdate, handlePersonUpdate } from "./human-matching.js";
import { handleRewriteScan, handleRewriteRewrite } from "./rewrite.js";
import { handleDedupCurate } from "./dedup.js";
import { handleRoomResponse, handleRoomJudge } from "./rooms.js";
import { handlePersonaPreview } from "./persona-preview.js";

function handlePersonIdentifierMigration(response: LLMResponse, state: StateManager): void {
  const personId = response.request.data.person_id as string;
  if (!personId) {
    console.error("[handlePersonIdentifierMigration] Missing person_id in request data");
    return;
  }

  const human = state.getHuman();
  const person = human.people.find(p => p.id === personId);
  if (!person) {
    console.error(`[handlePersonIdentifierMigration] Person not found: ${personId}`);
    return;
  }

  const result = response.parsed as { identifiers?: Array<{ type: string; value: string; is_primary?: boolean }> } | undefined;
  if (!result?.identifiers || !Array.isArray(result.identifiers) || result.identifiers.length === 0) {
    console.error(`[handlePersonIdentifierMigration] Invalid or empty identifiers for ${person.name}`);
    return;
  }

  const hasName = result.identifiers.some(i => i.value === person.name);
  if (!hasName) {
    result.identifiers.unshift({ type: "nickname", value: person.name });
  }

  const hasPrimary = result.identifiers.some(i => i.is_primary);
  if (!hasPrimary) {
    result.identifiers[0].is_primary = true;
  }

  const identifiers: PersonIdentifier[] = result.identifiers.map(i => ({
    type: i.type,
    value: i.value,
    ...(i.is_primary ? { is_primary: i.is_primary } : {}),
  }));

  state.human_person_upsert({
    ...person,
    identifiers,
    last_updated: new Date().toISOString(),
  });

  console.log(`[handlePersonIdentifierMigration] Migrated ${identifiers.length} identifier(s) for ${person.name}`);
}

export const handlers: Record<LLMNextStep, ResponseHandler> = {
  handlePersonaResponse,
  handlePersonaGeneration,
  handlePersonaDescriptions,
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
  [LLMNextStep.HandlePersonIdentifierMigration]: handlePersonIdentifierMigration,
  [LLMNextStep.HandleTopicValidate]: handleDedupCurate,
  [LLMNextStep.HandleReflectionCritic]: handleReflectionCritic,
};
