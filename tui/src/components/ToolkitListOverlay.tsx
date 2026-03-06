import { useKeyboard } from "@opentui/solid";
import { For, createSignal, createMemo } from "solid-js";
import type { KeyEvent } from "@opentui/core";

export interface ToolkitListItem {
  id: string;
  displayName: string;
  name: string;
  enabled: boolean;
  toolCount: number;
}

interface ToolkitListOverlayProps {
  toolkits: ToolkitListItem[];
  onEdit: (toolkit: ToolkitListItem) => void;
  onDismiss: () => void;
}

export function ToolkitListOverlay(props: ToolkitListOverlayProps) {
  const [selectedIndex, setSelectedIndex] = createSignal(0);
  const [filterText, setFilterText] = createSignal("");
  const [filterMode, setFilterMode] = createSignal(false);

  const filteredToolkits = createMemo(() => {
    const filter = filterText().toLowerCase();
    if (!filter) return props.toolkits;
    return props.toolkits.filter((t) =>
      t.displayName.toLowerCase().includes(filter) ||
      t.name.toLowerCase().includes(filter)
    );
  });

  createMemo(() => {
    const list = filteredToolkits();
    if (selectedIndex() >= list.length) {
      setSelectedIndex(Math.max(0, list.length - 1));
    }
  });

  useKeyboard((event: KeyEvent) => {
    const key = event.name;
    const listLength = filteredToolkits().length;

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
        setFilterMode(false);
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

      if (key === "e" || key === "return") {
        event.preventDefault();
        if (listLength > 0) {
          props.onEdit(filteredToolkits()[selectedIndex()]);
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
          Toolkits
        </text>

        <scrollbox height="100%">
          <For each={filteredToolkits()}>
            {(toolkit, index) => {
              const isSelected = () => selectedIndex() === index();
              const label = () => {
                const prefix = isSelected() ? "> " : "  ";
                const tools = toolkit.toolCount > 0 ? ` (${toolkit.toolCount} tools)` : "";
                const disabled = !toolkit.enabled ? " (disabled)" : "";
                return `${prefix}${toolkit.displayName}${tools}${disabled}`;
              };

              return (
                <box
                  backgroundColor={
                    isSelected()
                      ? "#2d3748"
                      : "transparent"
                  }
                  paddingLeft={1}
                  paddingRight={1}
                >
                  <text
                    fg={
                      !toolkit.enabled
                        ? "#4a5568"
                        : isSelected()
                        ? "#eee8d5"
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
            j/k: navigate | e/Enter: edit | Esc: cancel | /: filter
          </text>
        )}
      </box>
    </box>
  );
}
