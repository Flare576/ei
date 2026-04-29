export interface PromptOutput {
  system: string;
  user: string;
}

export interface PersonaGenerationPromptData {
  name: string;
  long_description?: string;
  short_description?: string;
  existing_traits?: Array<{ name?: string; description?: string; sentiment?: number; strength?: number }>;
  existing_topics?: Array<{ name?: string; perspective?: string; approach?: string; personal_stake?: string; sentiment?: number; exposure_current?: number; exposure_desired?: number }>;
  filtered_traits: Array<{ name?: string; description?: string; sentiment?: number; strength?: number }>;
  filtered_topics: Array<{ name?: string; perspective?: string; approach?: string; personal_stake?: string; sentiment?: number; exposure_current?: number; exposure_desired?: number }>;
}

export interface PersonaGenerationResult {
  short_description: string;
  long_description: string;
  traits: Array<{
    name: string;
    description: string;
    strength: number;
    sentiment: number;
  }>;
  topics: Array<{
    name: string;
    perspective: string;
    approach: string;
    personal_stake: string;
    exposure_current: number;
    exposure_desired: number;
    sentiment: number;
  }>;
  previous_long_description?: string;
  previous_short_description?: string;
  aliases?: string[];
}

export interface PersonaFromPersonPromptData {
  name: string;
  description: string;
  relationship?: string;
  existing_trait_names?: string[];
  existing_topic_names?: string[];
}
