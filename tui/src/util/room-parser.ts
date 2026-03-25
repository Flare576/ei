import YAML from "yaml";
import { RoomMode } from "../../../src/core/types/enums.js";
import type { RoomCreationInput, PersonaSummary } from "../../../src/core/types.js";

export function buildRoomYAMLTemplate(personas: PersonaSummary[], initialName = ""): string {
  const activePersonas = personas.filter((p) => !p.is_archived);
  const personaLines = activePersonas.map((p) => `  ${p.display_name}: false`).join("\n");
  return `# Room configuration
# mode: choose_your_path | free_for_all | messages_against_persona
display_name: "${initialName}"
mode: free_for_all
persona_ids:
${personaLines}
# judge_persona_id: required for messages_against_persona, use display_name from persona_ids above
judge_persona_id: ""
initial_message: ""
`;
}

export function parseRoomYAML(content: string, personas: PersonaSummary[]): RoomCreationInput {
  const parsed = YAML.parse(content) as Record<string, unknown>;

  const display_name = typeof parsed.display_name === "string" ? parsed.display_name.trim() : "";
  if (!display_name) {
    throw new Error("display_name is required");
  }

  const rawMode = typeof parsed.mode === "string" ? parsed.mode.trim() : "";
  const validModes = [RoomMode.ChooseYourPath, RoomMode.FreeForAll, RoomMode.MessagesAgainstPersona] as string[];
  if (!validModes.includes(rawMode)) {
    throw new Error("mode is required");
  }
  const mode = rawMode as RoomMode;

  let persona_ids: string[] = [];
  if (parsed.persona_ids && typeof parsed.persona_ids === "object" && !Array.isArray(parsed.persona_ids)) {
    persona_ids = Object.entries(parsed.persona_ids as Record<string, unknown>)
      .filter(([, enabled]) => enabled === true)
      .map(([name]) => {
        const found = personas.find((p) => p.display_name === name);
        return found ? found.id : name;
      });
  } else if (Array.isArray(parsed.persona_ids)) {
    persona_ids = (parsed.persona_ids as unknown[]).map((v) => String(v).trim()).filter(Boolean);
  }

  let judge_persona_id: string | undefined;
  const rawJudge = typeof parsed.judge_persona_id === "string" ? parsed.judge_persona_id.trim() : "";
  if (rawJudge) {
    const found = personas.find((p) => p.display_name === rawJudge);
    judge_persona_id = found ? found.id : rawJudge;
  }

  const initial_message = typeof parsed.initial_message === "string" ? parsed.initial_message : "";

  return {
    display_name,
    mode,
    persona_ids,
    ...(judge_persona_id ? { judge_persona_id } : {}),
    initial_message,
  };
}
