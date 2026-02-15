import { For, Show, createMemo, createEffect } from "solid-js";
import { TextAttributes, type ScrollBoxRenderable } from "@opentui/core";
import { useEi } from "../context/ei.js";
import { useKeyboardNav } from "../context/keyboard.js";
import { logger } from "../util/logger.js";

function formatTime(timestamp: string): string {
  const date = new Date(timestamp);
  const hours = date.getHours().toString().padStart(2, "0");
  const minutes = date.getMinutes().toString().padStart(2, "0");
  return `${hours}:${minutes}`;
}

let renderCount = 0;
let instanceId = 0;

export function MessageList() {
  const myId = ++instanceId;
  logger.info(`MessageList instance ${myId} MOUNTED`);
  
  const { messages, activePersona, activeContextBoundary } = useEi();
  const { focusedPanel, registerMessageScroll } = useKeyboardNav();

  const isFocused = () => focusedPanel() === "messages";

  const handleScrollboxRef = (scrollbox: ScrollBoxRenderable) => {
    registerMessageScroll(scrollbox);
  };

  const boundaryIsActive = createMemo(() => {
    const boundary = activeContextBoundary();
    const msgs = messages();
    const lastMessage = msgs[msgs.length - 1];
    const result = boundary ? (!lastMessage || boundary > lastMessage.timestamp) : false;
    logger.debug(`boundaryIsActive: boundary=${boundary}, lastMsg=${lastMessage?.timestamp}, result=${result}`);
    return result;
  });

  createEffect(() => {
    renderCount++;
    const msgs = messages();
    const boundary = activeContextBoundary();
    logger.debug(`MessageList render #${renderCount}: ${msgs.length} msgs, boundary=${boundary}, boundaryIsActive=${boundaryIsActive()}`);
  });

  return (
    <box 
      flexGrow={1}
      border={isFocused() ? ["left"] : undefined}
      borderColor={isFocused() ? "#268bd2" : undefined}
      borderStyle="single"
    >
      <Show
        when={messages().length > 0}
        fallback={
          <box flexGrow={1} padding={1} backgroundColor="#0f1419" justifyContent="center" alignItems="center">
            <text fg="#586e75" content="No messages yet. Start a conversation!" />
          </box>
        }
      >
        <scrollbox
          ref={handleScrollboxRef}
          flexGrow={1}
          padding={1}
          backgroundColor="#0f1419"
          stickyScroll={true}
          stickyStart="bottom"
        >
          <For each={messages()}>
            {(message, index) => {
              const speaker = message.role === "human" ? "Human" : activePersona() || "Ei";
              const speakerColor = message.role === "human" ? "#2aa198" : "#b58900";
              const header = `${speaker} (${formatTime(message.timestamp)}):`;
              
              const showDivider = () => {
                const boundary = activeContextBoundary();
                if (!boundary) return false;
                const i = index();
                if (i === 0) return false;
                const msgs = messages();
                const prevMsg = msgs[i - 1];
                const result = prevMsg.timestamp < boundary && message.timestamp >= boundary;
                if (result) {
                  logger.debug(`showDivider TRUE at index ${i}: prev=${prevMsg.timestamp}, boundary=${boundary}, curr=${message.timestamp}`);
                }
                return result;
              };

              const showTrailingDivider = () => {
                const msgs = messages();
                const isLast = index() === msgs.length - 1;
                if (!isLast) return false;
                return boundaryIsActive();
              };
              
              return (
                <>
                  <box marginTop={1} marginBottom={1} visible={showDivider()}>
                    <text fg="#586e75" content="─── New Context ───" />
                  </box>
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
                  <box marginTop={1} marginBottom={1} visible={showTrailingDivider()}>
                    <text fg="#586e75" content="─── New Context ───" />
                  </box>
                </>
              );
            }}
          </For>
        </scrollbox>
      </Show>
    </box>
  );
}
