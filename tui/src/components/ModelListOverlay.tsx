import { useKeyboard } from "@opentui/solid";
import { For, createSignal, createMemo, onMount, onCleanup } from "solid-js";
import type { KeyEvent } from "@opentui/core";
import { useKeyboardNav } from "../context/keyboard.js";

export interface ModelListItem {
  display: string;
  guid: string;
  providerId: string;
}

interface ModelListOverlayProps {
  models: ModelListItem[];
  activeModelGuid: string | null;
  onSelect: (model: ModelListItem) => void;
  onEdit: (model: ModelListItem) => void;
  onNew: () => void;
  onDismiss: () => void;
}

export function ModelListOverlay(props: ModelListOverlayProps) {
  const { setOverlayActive } = useKeyboardNav();
  onMount(() => setOverlayActive(true));
  onCleanup(() => setOverlayActive(false));

  const [selectedIndex, setSelectedIndex] = createSignal(0);
  const [filterText, setFilterText] = createSignal("");
  const [filterMode, setFilterMode] = createSignal(false);

  const filteredModels = createMemo(() => {
    const filter = filterText().toLowerCase();
    if (!filter) return props.models;
    return props.models.filter((m) => m.display.toLowerCase().includes(filter));
  });

  createMemo(() => {
    const list = filteredModels();
    if (selectedIndex() >= list.length) {
      setSelectedIndex(Math.max(0, list.length - 1));
    }
  });

  onMount(() => {
    const idx = props.models.findIndex((m) => m.guid === props.activeModelGuid);
    if (idx >= 0) setSelectedIndex(idx);
  });

  useKeyboard((event: KeyEvent) => {
    const key = event.name;
    const listLength = filteredModels().length;

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
          props.onSelect(filteredModels()[selectedIndex()]);
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
          props.onSelect(filteredModels()[selectedIndex()]);
        }
        return;
      }

      if (key === "e") {
        event.preventDefault();
        if (listLength > 0) {
          props.onEdit(filteredModels()[selectedIndex()]);
        }
        return;
      }

      if (key === "n") {
        event.preventDefault();
        props.onNew();
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
          Select Model
        </text>

        <scrollbox height="100%">
          <For each={filteredModels()}>
            {(item, index) => {
              const isActive = () => props.activeModelGuid === item.guid;
              const isSelected = () => selectedIndex() === index();
              const label = () => {
                const prefix = isActive() ? "> " : "  ";
                return `${prefix}${item.display}`;
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
            j/k: navigate | Enter: select | e: edit provider | n: new | Esc: cancel | /: filter
          </text>
        )}
      </box>
    </box>
  );
}
