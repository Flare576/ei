import { For, Show } from "solid-js";
import { TextAttributes, type ScrollBoxRenderable } from "@opentui/core";
import { useEi } from "../context/ei.js";
import { useKeyboardNav } from "../context/keyboard.js";

function formatTime(timestamp: string): string {
  const date = new Date(timestamp);
  const hours = date.getHours().toString().padStart(2, "0");
  const minutes = date.getMinutes().toString().padStart(2, "0");
  return `${hours}:${minutes}`;
}

export function MessageList() {
  const { messages, activePersona } = useEi();
  const { focusedPanel, registerMessageScroll } = useKeyboardNav();

  const isFocused = () => focusedPanel() === "messages";

  const handleScrollboxRef = (scrollbox: ScrollBoxRenderable) => {
    registerMessageScroll(scrollbox);
  };

  return (
    <box 
      flexGrow={1}
      border={isFocused() ? ["left"] : undefined}
      borderColor={isFocused() ? "#268bd2" : undefined}
      borderStyle="single"
    >
      <scrollbox
        ref={handleScrollboxRef}
        flexGrow={1}
        padding={1}
        backgroundColor="#0f1419"
        stickyScroll={true}
        stickyStart="bottom"
      >
        <Show
          when={messages().length > 0}
          fallback={
            <text fg="#586e75" content="No messages yet. Start a conversation!" />
          }
        >
          <For each={messages()}>
            {(message) => {
              const speaker = message.role === "human" ? "Human" : activePersona() || "Ei";
              const speakerColor = message.role === "human" ? "#2aa198" : "#b58900";
              const header = `${speaker} (${formatTime(message.timestamp)}):`;
              
              return (
                <box flexDirection="column" marginBottom={1}>
                  <text
                    fg={speakerColor}
                    attributes={TextAttributes.BOLD}
                    content={header}
                  />
                  <text 
                    fg="#839496" 
                    marginLeft={2}
                    content={message.content}
                  />
                </box>
              );
            }}
          </For>
        </Show>
      </scrollbox>
    </box>
  );
}
