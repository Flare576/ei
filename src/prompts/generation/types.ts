import type { Trait, Topic } from "../../core/types.js";

export interface PromptOutput {
  system: string;
  user: string;
}

export interface PersonaGenerationPromptData {
  name: string;
  long_description?: string;
  short_description?: string;
  existing_traits?: Array<{ name?: string; description?: string; sentiment?: number; strength?: number }>;
  existing_topics?: Array<{ name?: string; description?: string; sentiment?: number; exposure_current?: number; exposure_desired?: number }>;
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
    description: string;
    exposure_current: number;
    exposure_desired: number;
    sentiment: number;
  }>;
}

export interface PersonaDescriptionsPromptData {
  name: string;
  aliases: string[];
  traits: Trait[];
  topics: Topic[];
}

export interface PersonaDescriptionsResult {
  short_description: string;
  long_description: string;
  no_change?: boolean;
}
