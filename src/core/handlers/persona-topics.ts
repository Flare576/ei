import {
  type LLMResponse,
  type PersonaTopic,
} from "../types.js";
import type { StateManager } from "../state-manager.js";
import type { PersonaTopicRatingResult } from "../../prompts/persona/types.js";
import { calculateExposureCurrent } from "../utils/exposure.js";

export const MIN_MESSAGE_COUNT_FOR_CREATE = 2;

export function handlePersonaTopicRating(response: LLMResponse, state: StateManager): void {
  const personaId = response.request.data.personaId as string;
  const personaDisplayName = response.request.data.personaDisplayName as string;
  if (!personaId || !personaDisplayName) {
    throw new Error("[handlePersonaTopicRating] Missing personaId or personaDisplayName in request data");
  }

  const result = response.parsed as PersonaTopicRatingResult | undefined;
  if (!result?.ratings || !Array.isArray(result.ratings)) {
    console.log("[handlePersonaTopicRating] No ratings returned or invalid result");
    return;
  }

  const messageIds = response.request.data.message_ids as string[] | undefined;
  if (messageIds?.length) {
    const shortId = personaId.slice(0, 8);
    const roomId = response.request.data.roomId as string | undefined;
    if (roomId) {
      state.markRoomMessagesPersonaExtracted(roomId, messageIds, shortId);
    } else {
      state.messages_markPersonaExtracted(personaId, messageIds, shortId);
    }
  }

  const persona = state.persona_getById(personaId);
  if (!persona) {
    throw new Error(`[handlePersonaTopicRating] Persona not found: ${personaDisplayName}`);
  }

  const now = new Date().toISOString();
  let updatedCount = 0;

  const updatedTopics = persona.topics.map((topic: PersonaTopic) => {
    const rating = result.ratings.find(r => r.topic_id === topic.id);
    if (!rating || rating.exposure_impact === "none") {
      return topic;
    }

    const newExposure = calculateExposureCurrent(rating.exposure_impact, topic.exposure_current);
    updatedCount++;

    return {
      ...topic,
      exposure_current: newExposure,
      last_updated: now,
    };
  });

  if (updatedCount > 0) {
    state.persona_update(personaId, {
      topics: updatedTopics,
      last_updated: now,
    });
    console.log(`[handlePersonaTopicRating] Updated ${updatedCount}/${persona.topics.length} topics for ${personaDisplayName}`);
  } else {
    console.log(`[handlePersonaTopicRating] No topic exposure updates for ${personaDisplayName}`);
  }
}
