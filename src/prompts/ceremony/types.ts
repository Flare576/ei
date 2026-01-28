import type { Topic, Trait } from "../../core/types.js";

export interface PersonaExpirePromptData {
  persona_name: string;
  topics: Topic[];
}

export interface PersonaExpireResult {
  topic_ids_to_remove: string[];
}

export interface PersonaExplorePromptData {
  persona_name: string;
  traits: Trait[];
  remaining_topics: Topic[];
  recent_conversation_themes: string[];
}

export interface PersonaExploreResult {
  new_topics: Array<{
    name: string;
    description: string;
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
  topics: Topic[];
}

export interface DescriptionCheckResult {
  should_update: boolean;
  reason?: string;
}
