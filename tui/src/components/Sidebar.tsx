import { For, createSignal, createEffect, createMemo, onCleanup } from "solid-js";
import { useEi } from "../context/ei";
import { useKeyboardNav } from "../context/keyboard";

export function Sidebar() {
  const { personas, activePersonaId } = useEi();
  const { focusedPanel } = useKeyboardNav();

  const isFocused = () => focusedPanel() === "sidebar";

  // Memoize visible (non-archived) personas for proper reactivity
  const visiblePersonas = createMemo(() => 
    personas().filter(p => !p.is_archived)
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
          {`Personas ${isFocused() ? "[*]" : ""}`}
        </text>
        
        <scrollbox height="100%">
          <For each={visiblePersonas()}>
            {(persona) => {
              const isActive = () => activePersonaId() === persona.id;
              const displayName = () => 
                persona.aliases.length > 0 
                  ? persona.aliases[0] 
                  : persona.display_name;

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
                  backgroundColor={
                    isActive() && highlightedPersona() === persona.id 
                      ? "#3d5a80"
                      : isActive() 
                      ? "#2d3748"
                      : "transparent"
                  }
                  padding={1}
                  marginBottom={0.5}
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
