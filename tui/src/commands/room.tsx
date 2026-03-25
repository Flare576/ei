import { For, createSignal, createMemo } from "solid-js";
import { useKeyboard } from "@opentui/solid";
import type { KeyEvent } from "@opentui/core";
import type { Command } from "./registry";
import { spawnEditor } from "../util/editor.js";
import { RoomMode } from "../../../src/core/types/enums.js";
import type { RoomSummary, RoomCreationInput, PersonaSummary } from "../../../src/core/types.js";

function modeBadge(mode: RoomMode): string {
  switch (mode) {
    case RoomMode.ChooseYourPath: return "[CYP]";
    case RoomMode.FreeForAll: return "[FFA]";
    case RoomMode.MessagesAgainstPersona: return "[MAP]";
    default: return "[???]";
  }
}

interface RoomListOverlayProps {
  rooms: RoomSummary[];
  activeRoomId: string | null;
  onSelect: (roomId: string) => void;
  onDismiss: () => void;
}

function RoomListOverlay(props: RoomListOverlayProps) {
  const [selectedIndex, setSelectedIndex] = createSignal(0);
  const [filterText, setFilterText] = createSignal("");
  const [filterMode, setFilterMode] = createSignal(false);

  const filteredRooms = createMemo(() => {
    const filter = filterText().toLowerCase();
    if (!filter) return props.rooms;
    return props.rooms.filter((r) =>
      r.display_name.toLowerCase().includes(filter)
    );
  });

  createMemo(() => {
    const list = filteredRooms();
    if (selectedIndex() >= list.length) {
      setSelectedIndex(Math.max(0, list.length - 1));
    }
  });

  useKeyboard((event: KeyEvent) => {
    const key = event.name;
    const listLength = filteredRooms().length;

    if (filterMode()) {
      if (key === "escape") {
        event.preventDefault();
        setFilterText("");
        setFilterMode(false);
        return;
      }
      if (key === "backspace") {
        event.preventDefault();
        setFilterText((prev) => prev.slice(0, -1));
        return;
      }
      if (key === "return") {
        event.preventDefault();
        if (listLength > 0) {
          const selected = filteredRooms()[selectedIndex()];
          props.onSelect(selected.id);
        }
        return;
      }
      if (key.length === 1 && !event.ctrl && !event.meta) {
        event.preventDefault();
        setFilterText((prev) => prev + key);
        return;
      }
    } else {
      if (key === "j" || key === "down") {
        event.preventDefault();
        setSelectedIndex((prev) => Math.min(prev + 1, listLength - 1));
        return;
      }
      if (key === "k" || key === "up") {
        event.preventDefault();
        setSelectedIndex((prev) => Math.max(prev - 1, 0));
        return;
      }
      if (key === "return") {
        event.preventDefault();
        if (listLength > 0) {
          const selected = filteredRooms()[selectedIndex()];
          props.onSelect(selected.id);
        }
        return;
      }
      if (key === "escape") {
        event.preventDefault();
        props.onDismiss();
        return;
      }
      if (key === "/") {
        event.preventDefault();
        setFilterMode(true);
        return;
      }
    }
  });

  return (
    <box
      position="absolute"
      width="100%"
      height="100%"
      left={0}
      top={0}
      backgroundColor="#000000"
      alignItems="center"
      justifyContent="center"
    >
      <box
        width={70}
        height="80%"
        backgroundColor="#1a1a2e"
        borderStyle="single"
        borderColor="#586e75"
        padding={2}
        flexDirection="column"
      >
        <text fg="#eee8d5" marginBottom={1}>
          Select Room
        </text>

        <scrollbox height="100%">
          <For each={filteredRooms()}>
            {(room, index) => {
              const isActive = () => props.activeRoomId === room.id;
              const isSelected = () => selectedIndex() === index();
              const label = () => {
                const prefix = isActive() ? "> " : "  ";
                const badge = modeBadge(room.mode);
                const unread = room.unread_count > 0 ? ` (${room.unread_count})` : "";
                return `${prefix}${badge} ${room.display_name}${unread}`;
              };

              return (
                <box
                  backgroundColor={
                    isSelected()
                      ? "#2d3748"
                      : isActive()
                      ? "#1f2937"
                      : "transparent"
                  }
                  paddingLeft={1}
                  paddingRight={1}
                >
                  <text
                    fg={
                      isSelected()
                        ? "#eee8d5"
                        : isActive()
                        ? "#93a1a1"
                        : "#839496"
                    }
                  >
                    {label()}
                  </text>
                </box>
              );
            }}
          </For>
        </scrollbox>

        <text> </text>

        {filterMode() ? (
          <text fg="#586e75">Filter: {filterText()}|</text>
        ) : (
          <text fg="#586e75">
            j/k: navigate | Enter: select | Esc: cancel | /: filter
          </text>
        )}
      </box>
    </box>
  );
}

function buildRoomYAMLTemplate(personas: PersonaSummary[]): string {
  const activePersonas = personas.filter((p) => !p.is_archived);
  const personaLines = activePersonas.map((p) => `  ${p.display_name}: false`).join("\n");
  return `# Room configuration
# mode: choose_your_path | free_for_all | messages_against_persona
display_name: ""
mode: free_for_all
persona_ids:
${personaLines}
# judge_persona_id: required for messages_against_persona, use display_name from persona_ids above
judge_persona_id: ""
initial_message: ""
`;
}

function parseRoomYAML(content: string, personas: PersonaSummary[]): RoomCreationInput {
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

export const roomCommand: Command = {
  name: "room",
  aliases: ["r"],
  description: "List rooms, switch to a room, or create a new one",
  usage: "/room | /room <name> | /room new",

  async execute(args, ctx) {
    const unarchived = ctx.ei.rooms().filter(r => !r.is_archived);

    if (args.length === 0) {
      if (unarchived.length === 0) {
        ctx.showNotification("No rooms. Use /room new to create one.", "info");
        return;
      }
      ctx.showOverlay((hideOverlay, _hideForEditor) => (
        <RoomListOverlay
          rooms={unarchived}
          activeRoomId={ctx.ei.activeRoomId()}
          onSelect={(roomId) => {
            const room = unarchived.find(r => r.id === roomId);
            ctx.ei.selectRoom(roomId);
            hideOverlay();
            ctx.showNotification(`Switched to ${room?.display_name ?? roomId}`, "info");
          }}
          onDismiss={hideOverlay}
        />
      ), ctx.renderer);
      return;
    }

    if (args[0].toLowerCase() === "new") {
      const personas = ctx.ei.personas();
      const result = await spawnEditor({
        initialContent: buildRoomYAMLTemplate(personas),
        filename: "new-room.yaml",
        renderer: ctx.renderer,
      });

      if (result.aborted) {
        ctx.showNotification("Room creation cancelled", "info");
        return;
      }

      if (!result.success || result.content === null) {
        ctx.showNotification("No changes — room not created", "info");
        return;
      }

      try {
        const input = parseRoomYAML(result.content, personas);
        await ctx.ei.createRoom(input);
        ctx.showNotification(`Room "${input.display_name}" created`, "info");
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        ctx.showNotification(`Failed to create room: ${msg}`, "error");
      }
      return;
    }

    const name = args.join(" ");
    const roomId = ctx.ei.resolveRoomName(name);
    if (roomId) {
      const room = unarchived.find(r => r.id === roomId);
      ctx.ei.selectRoom(roomId);
      ctx.showNotification(`Switched to ${room?.display_name ?? name}`, "info");
    } else {
      ctx.showNotification(`No room named "${name}". Use /room new to create one.`, "warn");
    }
  },
};
