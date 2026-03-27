import { useKeyboard } from "@opentui/solid";
import { For, createSignal } from "solid-js";
import type { KeyEvent } from "@opentui/core";

export interface PersonPickerItem {
  id: string;
  name: string;
  relationship?: string;
  description?: string;
}

interface PersonPickerOverlayProps {
  title: string;
  people: PersonPickerItem[];
  onSelect: (person: PersonPickerItem) => void;
  onDismiss: () => void;
}

const truncate = (text: string, maxLen: number): string => {
  return text.length > maxLen ? text.slice(0, maxLen - 3) + "..." : text;
};

export function PersonPickerOverlay(props: PersonPickerOverlayProps) {
  const [selectedIndex, setSelectedIndex] = createSignal(0);

  useKeyboard((event: KeyEvent) => {
    const key = event.name;
    const listLength = props.people.length;

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
        props.onSelect(props.people[selectedIndex()]);
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
          {props.title}
        </text>

        <scrollbox height="100%">
          <For each={props.people}>
            {(person, index) => {
              const isSelected = () => selectedIndex() === index();
              const label = () => {
                let text = person.name;
                if (person.relationship) {
                  text += ` — ${person.relationship}`;
                }
                if (person.description) {
                  text += ` · ${truncate(person.description, 40)}`;
                }
                return text;
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
        <text fg="#586e75">j/k: navigate | Enter: select | Esc: cancel</text>
      </box>
    </box>
  );
}
