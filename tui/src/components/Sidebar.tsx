import { For } from "solid-js";
import { useEi } from "../context/ei";
import { useKeyboardNav } from "../context/keyboard";

export function Sidebar() {
  const { personas, activePersona } = useEi();
  const { focusedPanel } = useKeyboardNav();

  const isFocused = () => focusedPanel() === "sidebar";

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
          {`Personas ${isFocused() ? "[*]" : ""}`}
        </text>
        
        <scrollbox height="100%">
          <For each={personas()}>
            {(persona) => {
              const isActive = () => activePersona() === persona.name;
              const displayName = () => 
                persona.aliases.length > 0 
                  ? persona.aliases[0] 
                  : persona.name;

              const getLabel = () => {
                const prefix = isActive() ? "* " : "  ";
                const name = displayName();
                const unread = persona.unread_count > 0 ? ` (${persona.unread_count} new)` : "";
                const paused = persona.is_paused ? " [P]" : "";
                return `${prefix}${name}${unread}${paused}`;
              };

              return (
                <box
                  backgroundColor={isActive() ? "#2d3748" : "transparent"}
                  padding={1}
                  marginBottom={0.5}
                >
                  <text fg={isActive() ? "#eee8d5" : "#839496"}>
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
