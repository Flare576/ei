import { useKeyboard } from "@opentui/solid";
import { For, createSignal, createMemo } from "solid-js";
import type { KeyEvent } from "@opentui/core";
import type { PersonaSummary } from "../../../src/core/types.js";

interface PersonaListOverlayProps {
  personas: PersonaSummary[];
  activePersona: string | null;
  title?: string;
  onSelect: (name: string) => void;
  onDismiss: () => void;
}

export function PersonaListOverlay(props: PersonaListOverlayProps) {
  const [selectedIndex, setSelectedIndex] = createSignal(0);
  const [filterText, setFilterText] = createSignal("");
  const [filterMode, setFilterMode] = createSignal(false);

  const filteredPersonas = createMemo(() => {
    const filter = filterText().toLowerCase();
    if (!filter) return props.personas;
    return props.personas.filter((p) =>
      p.name.toLowerCase().includes(filter)
    );
  });

  createMemo(() => {
    const list = filteredPersonas();
    if (selectedIndex() >= list.length) {
      setSelectedIndex(Math.max(0, list.length - 1));
    }
  });

  useKeyboard((event: KeyEvent) => {
    const key = event.name;
    const listLength = filteredPersonas().length;

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
          const selected = filteredPersonas()[selectedIndex()];
          props.onSelect(selected.name);
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
          const selected = filteredPersonas()[selectedIndex()];
          props.onSelect(selected.name);
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

  const truncateDescription = (desc: string | undefined, maxLen: number = 40): string => {
    if (!desc) return "";
    return desc.length > maxLen ? desc.slice(0, maxLen - 3) + "..." : desc;
  };

  const title = props.title || "Select Persona";

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
          {title}
        </text>

        <scrollbox height="100%">
          <For each={filteredPersonas()}>
            {(persona, index) => {
              const isActive = () => props.activePersona === persona.name;
              const isSelected = () => selectedIndex() === index();
              const description = truncateDescription(persona.short_description);
              const label = () => {
                const prefix = isActive() ? "> " : "  ";
                const descText = description ? ` - ${description}` : "";
                return `${prefix}${persona.name}${descText}`;
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
