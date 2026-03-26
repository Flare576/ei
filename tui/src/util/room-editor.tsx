import { spawnEditor } from "./editor.js";
import type { CommandContext } from "../commands/registry.js";
import type { RoomEntity, PersonaSummary } from "../../../src/core/types.js";
import { ConfirmOverlay } from "../components/ConfirmOverlay.js";
import { logger } from "./logger.js";

export interface RoomEditorOptions {
  roomId: string;
  ctx: CommandContext;
}

function buildRoomEditYAML(room: RoomEntity, personas: PersonaSummary[]): string {
  const activePersonas = personas.filter((p) => !p.is_archived);
  const personaLines = activePersonas
    .map((p) => `  ${p.display_name}: ${room.persona_ids.includes(p.id) ? "true" : "false"}`)
    .join("\n");

  const judgePersona = room.judge_persona_id
    ? personas.find((p) => p.id === room.judge_persona_id)
    : null;
  const judgeDisplayName = judgePersona ? judgePersona.display_name : "";

  return `# Room: ${room.display_name} (read-only info)
# Mode: ${room.mode} (cannot be changed)
display_name: "${room.display_name}"

# Participants (set true/false to add/remove):
persona_ids:
${personaLines}

# judge_persona_id: required for messages_against_persona, use display_name from persona_ids
judge_persona_id: "${judgeDisplayName}"
`;
}

function parseRoomEditYAML(content: string, personas: PersonaSummary[]): Partial<RoomEntity> {
  const lines = content.split("\n");
  const updates: Partial<RoomEntity> = {};

  let inPersonaIds = false;
  const personaMapEntries: Array<{ name: string; enabled: boolean }> = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("#") || trimmed === "") {
      continue;
    }

    if (inPersonaIds && line.match(/^\s+\S/)) {
      const colonIdx = trimmed.lastIndexOf(":");
      if (colonIdx !== -1) {
        const name = trimmed.slice(0, colonIdx).trim();
        const val = trimmed.slice(colonIdx + 1).trim().toLowerCase();
        personaMapEntries.push({ name, enabled: val === "true" });
      }
      continue;
    }

    if (inPersonaIds) {
      inPersonaIds = false;
    }

    if (trimmed.startsWith("display_name:")) {
      const val = trimmed.slice("display_name:".length).trim().replace(/^["']|["']$/g, "");
      if (val) updates.display_name = val;
    } else if (trimmed.startsWith("judge_persona_id:")) {
      const val = trimmed.slice("judge_persona_id:".length).trim().replace(/^["']|["']$/g, "");
      if (val) {
        const found = personas.find((p) => p.display_name === val);
        updates.judge_persona_id = found ? found.id : val;
      } else {
        updates.judge_persona_id = undefined;
      }
    } else if (trimmed.startsWith("persona_ids:")) {
      inPersonaIds = true;
      const inline = trimmed.slice("persona_ids:".length).trim();
      if (inline && inline !== "[]") {
        inPersonaIds = false;
      }
    }
  }

  if (personaMapEntries.length > 0) {
    updates.persona_ids = personaMapEntries
      .filter((e) => e.enabled)
      .map((e) => {
        const found = personas.find((p) => p.display_name === e.name);
        return found ? found.id : e.name;
      });
  }

  return updates;
}

export async function openRoomEditor(options: RoomEditorOptions): Promise<void> {
  const { roomId, ctx } = options;
  const room = ctx.ei.getRoom(roomId);
  if (!room) {
    ctx.showNotification("Room not found", "error");
    return;
  }

  const personas = ctx.ei.personas();
  let yamlContent = buildRoomEditYAML(room, personas);

  while (true) {
    const result = await spawnEditor({
      initialContent: yamlContent,
      filename: `${roomId}-details.yaml`,
      renderer: ctx.renderer,
    });

    if (result.aborted) {
      ctx.showNotification("Editor cancelled", "info");
      return;
    }

    if (!result.success) {
      ctx.showNotification("Editor failed to open", "error");
      return;
    }

    if (result.content === null) {
      ctx.showNotification("No changes made", "info");
      return;
    }

    try {
      const updates = parseRoomEditYAML(result.content, personas);
      await ctx.ei.updateRoom(roomId, updates);
      ctx.showNotification(`Updated ${room.display_name}`, "info");
      return;
    } catch (parseError) {
      const errorMsg = parseError instanceof Error ? parseError.message : String(parseError);
      logger.debug("[room-editor] YAML parse error", { error: errorMsg });

      const shouldReEdit = await new Promise<boolean>((resolve) => {
        ctx.showOverlay((hideOverlay, hideForEditor) => (
          <ConfirmOverlay
            message={`YAML parse error:\n${errorMsg}\n\nRe-edit?`}
            onConfirm={() => {
              logger.debug("[room-editor] user confirmed re-edit");
              hideForEditor();
              resolve(true);
            }}
            onCancel={() => {
              logger.debug("[room-editor] user cancelled re-edit");
              hideOverlay();
              resolve(false);
            }}
          />
        ), ctx.renderer);
      });

      if (shouldReEdit) {
        yamlContent = result.content;
        continue;
      } else {
        ctx.showNotification("Changes discarded", "info");
        return;
      }
    }
  }
}
