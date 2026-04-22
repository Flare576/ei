import { For, createSignal, createEffect, createMemo, onCleanup } from "solid-js";
import { useEi } from "../context/ei";
import { useKeyboardNav } from "../context/keyboard";
import { RoomMode } from "../../../src/core/types/enums.js";
import type { RoomSummary } from "../../../src/core/types.js";

const modeBadge = (mode: RoomMode): string => {
  switch (mode) {
    case RoomMode.ChooseYourPath: return "[CYP]";
    case RoomMode.FreeForAll: return "[FFA]";
    case RoomMode.MessagesAgainstPersona: return "[MAP]";
    default: return "";
  }
};

export function Sidebar() {
  const { personas, activePersonaId, rooms, activeRoomId } = useEi();
  const { focusedPanel } = useKeyboardNav();

  const isFocused = () => focusedPanel() === "sidebar";
  const isRoomMode = () => activeRoomId() !== null;

  // Memoize visible (non-archived) personas for proper reactivity
  const visiblePersonas = createMemo(() => 
    personas().filter(p => !p.is_archived)
  );

  const visibleRooms = createMemo(() =>
    rooms().filter((r: RoomSummary) => !r.is_archived)
  );

  const [highlightedPersona, setHighlightedPersona] = createSignal<string | null>(null);
  let highlightTimer: ReturnType<typeof setTimeout> | null = null;

  createEffect(() => {
    const currentId = activePersonaId();
    if (currentId) {
      if (highlightTimer) clearTimeout(highlightTimer);
      
      setHighlightedPersona(currentId);
      
      highlightTimer = setTimeout(() => {
        setHighlightedPersona(null);
        highlightTimer = null;
      }, 500);
    }
  });

  onCleanup(() => {
    if (highlightTimer) clearTimeout(highlightTimer);
  });

  return (
    <box 
      width={25} 
      border={["right"]}
      borderStyle="single" 
      borderColor={isFocused() ? "#268bd2" : "#586e75"}
      padding={1}
      backgroundColor="#1a1a2e"
    >
      <box flexDirection="column">
        <text fg={isFocused() ? "#268bd2" : "#93a1a1"} marginBottom={1}>
          {isRoomMode() ? `/p Personas | * Rooms` : `* Personas | /r Rooms`}
        </text>
        
        <scrollbox height="100%">
          <For each={visiblePersonas()}>
            {(persona) => {
              const isActive = () => activePersonaId() === persona.id;
              const displayName = () => 
                persona.display_name || persona.aliases[0] || persona.id;

              const getLabel = () => {
                const prefix = isActive() ? "* " : "  ";
                const name = displayName();
                const unread = persona.unread_count > 0 ? ` (${persona.unread_count} new)` : "";
                const paused = persona.is_paused ? " ⏸" : "";
                return `${prefix}${name}${unread}${paused}`;
              };

              const textColor = () => {
                if (isActive()) return "#eee8d5";
                if (persona.is_paused) return "#586e75";
                return "#839496";
              };

              return (
                <box
                  visible={!isRoomMode()}
                  flexDirection="column"
                  backgroundColor={
                    isActive() && highlightedPersona() === persona.id 
                      ? "#3d5a80"
                      : isActive() 
                      ? "#2d3748"
                      : "transparent"
                  }
                  paddingX={1}
                  marginBottom={1}
                >
                  <text fg={textColor()}>
                    {getLabel()}
                  </text>
                  <text fg="#586e75" wrapMode="word" height={2} visible={!!persona.short_description}>
                    {persona.short_description ?? ""}
                  </text>
                </box>
              );
            }}
          </For>
          <For each={visibleRooms()}>
            {(room) => {
              const isActive = () => activeRoomId() === room.id;

              const getLabel = () => {
                const prefix = isActive() ? "* " : "  ";
                const name = room.display_name;
                const badge = modeBadge(room.mode);
                const unread = room.unread_count > 0 ? ` (${room.unread_count} new)` : "";
                return `${prefix}${name} ${badge}${unread}`;
              };

              const textColor = () => {
                if (isActive()) return "#eee8d5";
                return "#839496";
              };

              return (
                <box
                  visible={isRoomMode()}
                  flexDirection="column"
                  backgroundColor={isActive() ? "#2d3748" : "transparent"}
                  paddingX={1}
                  marginBottom={1}
                >
                  <text fg={textColor()}>
                    {getLabel()}
                  </text>
                </box>
              );
            }}
          </For>
        </scrollbox>
      </box>
    </box>
  );
}
