import type { Trait, Topic, Message } from "../../core/types.js";

export interface PromptOutput {
  system: string;
  user: string;
}

export interface PersonaTraitExtractionPromptData {
  persona_name: string;
  current_traits: Trait[];
  messages_context: Message[];
  messages_analyze: Message[];
}

export interface PersonaTopicDetectionPromptData {
  persona_name: string;
  current_topics: Topic[];
  messages_context: Message[];
  messages_analyze: Message[];
}

export interface PersonaTopicExplorationPromptData {
  persona_name: string;
  short_description?: string;
  long_description?: string;
  traits: Trait[];
  current_topics: Topic[];
}

export interface TopicResult {
  name: string;
  description: string;
  sentiment: number;
  exposure_current: number;
  exposure_desired: number;
}

export interface TraitResult {
  name: string;
  description: string;
  sentiment: number;
  strength: number;
}
