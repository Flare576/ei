import type { PersonaTrait, PersonaTopic } from "../../core/types.js";

export interface PersonaIdentitySnapshot {
  name: string;
  long_description: string;
  short_description: string;
  traits: PersonaTrait[];
  topics: PersonaTopic[];
}

export interface ReflectionCriticPromptData {
  persona_identity: PersonaIdentitySnapshot;
  person_log: string;
}

export interface ReflectionCriticResult {
  critique: string;
  updated_identity: {
    long_description: string;
    short_description: string;
    traits: PersonaTrait[];
    topics: PersonaTopic[];
  };
}


