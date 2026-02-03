import type { Trait, PersonaTopic } from "../../core/types.js";

export interface PersonaExpirePromptData {
  persona_name: string;
  topics: PersonaTopic[];
}

export interface PersonaExpireResult {
  topic_ids_to_remove: string[];
}

export interface PersonaExplorePromptData {
  persona_name: string;
  traits: Trait[];
  remaining_topics: PersonaTopic[];
  recent_conversation_themes: string[];
}

export interface PersonaExploreResult {
  new_topics: Array<{
    name: string;
    perspective: string;
    approach: string;
    personal_stake: string;
    sentiment: number;
    exposure_current: number;
    exposure_desired: number;
  }>;
}

export interface DescriptionCheckPromptData {
  persona_name: string;
  current_short_description?: string;
  current_long_description?: string;
  traits: Trait[];
  topics: PersonaTopic[];
}

export interface DescriptionCheckResult {
  should_update: boolean;
  reason?: string;
}
