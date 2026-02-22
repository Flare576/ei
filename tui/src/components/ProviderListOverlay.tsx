import { useKeyboard } from "@opentui/solid";
import { For, createSignal, createMemo } from "solid-js";
import type { KeyEvent } from "@opentui/core";

export interface ProviderListItem {
  id: string;
  displayName: string;
  key: string;
  defaultModel?: string;
  enabled: boolean;
}

interface ProviderListOverlayProps {
  providers: ProviderListItem[];
  activeProviderKey: string | null;
  onSelect: (provider: ProviderListItem) => void;
  onEdit: (provider: ProviderListItem) => void;
  onNew: () => void;
  onDismiss: () => void;
}

export function ProviderListOverlay(props: ProviderListOverlayProps) {
  const [selectedIndex, setSelectedIndex] = createSignal(0);
  const [filterText, setFilterText] = createSignal("");
  const [filterMode, setFilterMode] = createSignal(false);

  const filteredProviders = createMemo(() => {
    const filter = filterText().toLowerCase();
    if (!filter) return props.providers;
    return props.providers.filter((p) =>
      p.displayName.toLowerCase().includes(filter) ||
      p.key.toLowerCase().includes(filter)
    );
  });

  createMemo(() => {
    const list = filteredProviders();
    if (selectedIndex() >= list.length) {
      setSelectedIndex(Math.max(0, list.length - 1));
    }
  });

  useKeyboard((event: KeyEvent) => {
    const key = event.name;
    const listLength = filteredProviders().length;

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
          props.onSelect(filteredProviders()[selectedIndex()]);
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
          props.onSelect(filteredProviders()[selectedIndex()]);
        }
        return;
      }

      if (key === "e") {
        event.preventDefault();
        if (listLength > 0) {
          props.onEdit(filteredProviders()[selectedIndex()]);
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

  const truncateModel = (model: string | undefined, maxLen: number = 30): string => {
    if (!model) return "";
    return model.length > maxLen ? model.slice(0, maxLen - 3) + "..." : model;
  };

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
          Select Provider
        </text>

        <scrollbox height="100%">
          <For each={filteredProviders()}>
            {(provider, index) => {
              const isActive = () => props.activeProviderKey === provider.key;
              const isSelected = () => selectedIndex() === index();
              const modelText = truncateModel(provider.defaultModel);
              const label = () => {
                const prefix = isActive() ? "> " : "  ";
                const model = modelText ? ` - ${modelText}` : "";
                const disabled = !provider.enabled ? " (disabled)" : "";
                return `${prefix}${provider.displayName}${model}${disabled}`;
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
                      !provider.enabled
                        ? "#4a5568"
                        : isSelected()
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
            j/k: navigate | Enter: select | e: edit | n: new | Esc: cancel | /: filter
          </text>
        )}
      </box>
    </box>
  );
}
