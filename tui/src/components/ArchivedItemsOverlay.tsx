import { useKeyboard } from "@opentui/solid";
import { For, createSignal, createMemo, onMount, onCleanup } from "solid-js";
import type { KeyEvent } from "@opentui/core";
import type { PersonaSummary, RoomSummary } from "../../../src/core/types.js";
import { useKeyboardNav } from "../context/keyboard.js";

export type ArchivedItem =
  | { kind: "persona"; id: string; display_name: string }
  | { kind: "room"; id: string; display_name: string; mode: RoomSummary["mode"] };

interface ArchivedItemsOverlayProps {
  personas: PersonaSummary[];
  rooms: RoomSummary[];
  onSelect: (item: ArchivedItem) => void | Promise<void>;
  onDismiss: () => void;
}

function modeLabel(mode: RoomSummary["mode"]): string {
  switch (mode) {
    case "choose_your_path": return "CYP";
    case "free_for_all": return "FFA";
    case "messages_against_persona": return "MAP";
    default: return mode;
  }
}

export function ArchivedItemsOverlay(props: ArchivedItemsOverlayProps) {
  const { setOverlayActive } = useKeyboardNav();
  const [selectedIndex, setSelectedIndex] = createSignal(0);

  onMount(() => setOverlayActive(true));
  onCleanup(() => setOverlayActive(false));

  const allItems = createMemo<ArchivedItem[]>(() => [
    ...props.rooms.map(r => ({
      kind: "room" as const,
      id: r.id,
      display_name: r.display_name,
      mode: r.mode,
    })),
    ...props.personas.map(p => ({
      kind: "persona" as const,
      id: p.id,
      display_name: p.display_name,
    })),
  ]);

  createMemo(() => {
    const list = allItems();
    if (selectedIndex() >= list.length) {
      setSelectedIndex(Math.max(0, list.length - 1));
    }
  });

  useKeyboard((event: KeyEvent) => {
    const key = event.name;
    const listLength = allItems().length;

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
        const selected = allItems()[selectedIndex()];
        void props.onSelect(selected);
      }
      return;
    }

    if (key === "escape") {
      event.preventDefault();
      props.onDismiss();
      return;
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
          Archived Items (Enter to unarchive)
        </text>

        <scrollbox height="100%">
          <For each={allItems()}>
            {(item, index) => {
              const isSelected = () => selectedIndex() === index();
              const label = () => {
                if (item.kind === "room") {
                  return `[Room] ${item.display_name} (${modeLabel(item.mode)})`;
                }
                return `[Persona] ${item.display_name}`;
              };
              return (
                <box
                  backgroundColor={isSelected() ? "#2d3748" : "transparent"}
                  paddingLeft={1}
                  paddingRight={1}
                >
                  <text fg={isSelected() ? "#eee8d5" : "#839496"}>
                    {label()}
                  </text>
                </box>
              );
            }}
          </For>
        </scrollbox>

        <text> </text>

        <text fg="#586e75">
          j/k: navigate | Enter: unarchive | Esc: cancel
        </text>
      </box>
    </box>
  );
}
