import type { PersonaFromPersonPromptData, PromptOutput } from "./types.js";

const JSON_SCHEMA = `\`\`\`json
{
  "short_description": "10-15 word summary of who this person is",
  "long_description": "2-3 sentences describing personality, approach, and what makes them distinctive",
  "traits": [
    { "name": "...", "description": "...", "sentiment": 0.7, "strength": 0.8 }
  ],
  "topics": [
    { "name": "...", "perspective": "...", "approach": "...", "personal_stake": "...", "sentiment": 0.6, "exposure_current": 0.5, "exposure_desired": 0.7 }
  ]
}
\`\`\``;

const JSON_SCHEMA_ABBREVIATED = `Return JSON:
\`\`\`json
{
  "short_description": "10-15 word summary",
  "long_description": "2-3 sentence description",
  "traits": [ { "name": "...", "description": "...", "sentiment": 0.0, "strength": 0.5 } ],
  "topics": [ { "name": "...", "perspective": "...", "approach": "...", "personal_stake": "...", "sentiment": 0.5, "exposure_current": 0.5, "exposure_desired": 0.6 } ]
}
\`\`\``;

export function buildPersonaFromPersonPrompt(data: PersonaFromPersonPromptData): PromptOutput {
  if (!data.name) {
    throw new Error("buildPersonaFromPersonPrompt: name is required");
  }
  if (!data.description) {
    throw new Error("buildPersonaFromPersonPrompt: description is required");
  }

  const isUpdate = !!(data.existing_trait_names?.length || data.existing_topic_names?.length);

  const systemLines: string[] = [];
  systemLines.push("You are building a persona definition from a real person's description.");

  if (isUpdate) {
    systemLines.push(
      "This persona already exists — generate traits and topics that EXPAND its personality with new dimensions."
    );
  }

  systemLines.push(
    "Generate content that authentically reflects the person described. Do not use generic filler.",
    "",
    "Generate exactly 3 traits and exactly 3 topics.",
    "",
    JSON_SCHEMA
  );

  const system = systemLines.join("\n");

  const userLines: string[] = [];
  userLines.push(`Person: ${data.name}`);

  if (data.relationship) {
    userLines.push(`Relationship: ${data.relationship}`);
  }

  userLines.push("", "Description:", data.description);

  if (data.existing_trait_names && data.existing_trait_names.length > 0) {
    userLines.push(
      "",
      "These traits already exist on this persona — do NOT repeat them. Generate 3 NEW traits that reveal different dimensions:",
      ...data.existing_trait_names.map((n) => `- ${n}`)
    );
  }

  if (data.existing_topic_names && data.existing_topic_names.length > 0) {
    userLines.push(
      "",
      "These topics already exist — do NOT repeat them. Generate 3 NEW topics that expand different areas:",
      ...data.existing_topic_names.map((n) => `- ${n}`)
    );
  }

  userLines.push("", JSON_SCHEMA_ABBREVIATED);

  const user = userLines.join("\n");

  return { system, user };
}
