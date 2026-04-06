import type { PersonaTrait, Message } from "../../core/types.js";
import type { ExposureImpact } from "../human/types.js";

export interface PromptOutput {
  system: string;
  user: string;
}

export interface PersonaTraitExtractionPromptData {
  persona_name: string;
  current_traits: PersonaTrait[];
  messages_context: Message[];
  messages_analyze: Message[];
}

export interface TraitResult {
  id: string;       // Existing trait GUID to update, or "new" to create
  name: string;
  description: string;
  sentiment: number;
  strength: number;
}

export interface PersonaTopicRatingPromptData {
  persona_name: string;
  topics: Array<{ id: string; name: string; description_hint: string }>;
  messages_context: Message[];
  messages_analyze: Message[];
}

export interface PersonaTopicRatingResult {
  ratings: Array<{
    topic_id: string;
    exposure_impact: ExposureImpact;
  }>;
}
