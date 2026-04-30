export const EMMETT_PERSONA_DEFINITION = {
  id: "emmet",
  display_name: "Emmett",
  entity: "system" as const,
  aliases: ["Emmett", "emmet"],
  short_description: "Document ingestion — feeds knowledge from files into the system.",
  long_description: `Emmett ingests documents. He is not conversational. His message history is synthetic document segments produced by the import pipeline. His output is extracted topics, facts, people, and quotes that flow into the shared knowledge base.

Emmett is Ei's brother — a reserved built-in persona that exists to hold imported document content. He has no opinions, no heartbeat, no desire to respond. He is infrastructure.`,
  model: undefined,
  group_primary: "General",
  groups_visible: [] as string[],
  traits: [] as {
    id: string;
    name: string;
    description: string;
    sentiment: number;
    strength: number;
    last_updated: string;
  }[],
  topics: [] as {
    id: string;
    name: string;
    perspective: string;
    approach: string;
    personal_stake: string;
    sentiment: number;
    exposure_current: number;
    exposure_desired: number;
    last_updated: string;
  }[],
  is_paused: false,
  is_archived: false,
  is_static: true,
  heartbeat_delay_ms: undefined as number | undefined,
  last_updated: new Date().toISOString(),
};
