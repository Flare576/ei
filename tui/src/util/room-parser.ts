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
  const lines = content.split("\n");
  const result: Partial<RoomCreationInput> = {
    persona_ids: [],
    mode: RoomMode.FreeForAll,
    initial_message: "",
  };

  // Tracks whether we're inside a persona_ids block (key: true/false map format)
  let inPersonaIds = false;
  // Accumulate key:bool entries for the new map format
  const personaMapEntries: Array<{ name: string; enabled: boolean }> = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("#") || trimmed === "") {
      // Comments and blank lines don't exit persona_ids block — indented entries may follow
      continue;
    }

    // Detect indented lines (persona map entries) while in persona_ids block
    if (inPersonaIds && line.match(/^\s+\S/)) {
      // Format: "  DisplayName: true" or "  DisplayName: false"
      const colonIdx = trimmed.lastIndexOf(":");
      if (colonIdx !== -1) {
        const name = trimmed.slice(0, colonIdx).trim();
        const val = trimmed.slice(colonIdx + 1).trim().toLowerCase();
        personaMapEntries.push({ name, enabled: val === "true" });
      }
      continue;
    }

    // Any non-indented, non-comment line exits the persona_ids block
    if (inPersonaIds) {
      inPersonaIds = false;
    }

    if (trimmed.startsWith("display_name:")) {
      const val = trimmed.slice("display_name:".length).trim().replace(/^["']|["']$/g, "");
      result.display_name = val;
    } else if (trimmed.startsWith("mode:")) {
      const val = trimmed.slice("mode:".length).trim().replace(/^["']|["']$/g, "");
      if (val === RoomMode.ChooseYourPath || val === RoomMode.FreeForAll || val === RoomMode.MessagesAgainstPersona) {
        result.mode = val;
      }
    } else if (trimmed.startsWith("judge_persona_id:")) {
      const val = trimmed.slice("judge_persona_id:".length).trim().replace(/^["']|["']$/g, "");
      if (val) {
        // Look up by display_name first, fall back to treating as raw ID
        const found = personas.find((p) => p.display_name === val);
        result.judge_persona_id = found ? found.id : val;
      }
    } else if (trimmed.startsWith("initial_message:")) {
      const val = trimmed.slice("initial_message:".length).trim().replace(/^["']|["']$/g, "");
      result.initial_message = val;
    } else if (trimmed.startsWith("persona_ids:")) {
      inPersonaIds = true;
      const inline = trimmed.slice("persona_ids:".length).trim();
      if (inline && inline !== "[]") {
        // Old format: persona_ids: [id1, id2]
        const cleaned = inline.replace(/^\[|\]$/g, "");
        result.persona_ids = cleaned.split(",").map(s => s.trim().replace(/^["']|["']$/g, "")).filter(Boolean);
        inPersonaIds = false;
      }
    }
  }

  // Resolve new map format: filter true entries, look up IDs by display_name
  if (personaMapEntries.length > 0) {
    result.persona_ids = personaMapEntries
      .filter((e) => e.enabled)
      .map((e) => {
        const found = personas.find((p) => p.display_name === e.name);
        return found ? found.id : e.name;
      });
  }

  if (!result.display_name) {
    throw new Error("display_name is required");
  }
  if (!result.mode) {
    throw new Error("mode is required");
  }

  return result as RoomCreationInput;
}
