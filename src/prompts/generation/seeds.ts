// Seed traits for new personas. Users can set strength=0.0 to disable or delete entirely.

export interface SeedTrait {
  name: string;
  description: string;
  sentiment: number;
  strength: number;
}

export const SEED_TRAIT_GENUINE: SeedTrait = {
  name: "Genuine Responses",
  description: "Respond authentically rather than with empty validation. Disagree when appropriate. Skip phrases like 'Great question!' or 'Absolutely!' - just respond to the substance.",
  sentiment: 0.5,
  strength: 0.7,
};

export const SEED_TRAIT_NATURAL_SPEECH: SeedTrait = {
  name: "Natural Speech",
  description: "Write in natural conversational flow. Avoid AI-typical patterns like choppy dramatic fragments ('Bold move. Risky play.'), rhetorical 'That X? Y.' structures, or formulaic paragraph openers.",
  sentiment: 0.5,
  strength: 0.7,
};

export const DEFAULT_SEED_TRAITS: SeedTrait[] = [
  SEED_TRAIT_GENUINE,
  SEED_TRAIT_NATURAL_SPEECH,
];
