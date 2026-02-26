import { For, Show, createMemo, createSignal, createEffect, on } from "solid-js";
import { TextAttributes, type ScrollBoxRenderable } from "@opentui/core";
import { useEi } from "../context/ei.js";
import { useKeyboardNav } from "../context/keyboard.js";
import { logger } from "../util/logger.js";
import { solarizedDarkSyntax } from "../util/syntax.js";
import type { Quote, Message } from "../../../src/core/types.js";

interface MessageWithQuotes extends Message {
  _quotes: Quote[];
  _quoteIndex: number;
}

function formatTime(timestamp: string): string {
  const date = new Date(timestamp);
  const hours = date.getHours().toString().padStart(2, "0");
  const minutes = date.getMinutes().toString().padStart(2, "0");
  return `${hours}:${minutes}`;
}

function buildMessageText(message: Message): string {
  if (message.silence_reason !== undefined) {
    return `[chose not to respond: ${message.silence_reason}]`;
  }
  const parts: string[] = [];
  if (message.action_response) parts.push(`_${message.action_response}_`);
  if (message.verbal_response) parts.push(message.verbal_response);
  return parts.join('\n\n');
}

function insertQuoteMarkers(content: string, quotes: Quote[]): string {
  const validQuotes = quotes
    .filter(q => q.end !== null && q.end !== undefined)
    .sort((a, b) => b.end! - a.end!);
  
  let result = content;
  for (const quote of validQuotes) {
    let insertPos = quote.end!;
    if (insertPos >= 0 && insertPos <= result.length) {
      while (insertPos > 0 && (result[insertPos - 1] === '\n' || result[insertPos - 1] === ' ')) {
        insertPos--;
      }
      result = result.slice(0, insertPos) + "\u207a" + result.slice(insertPos);
    }
  }
  return result;
}

let instanceId = 0;

export function MessageList() {
  const myId = ++instanceId;
  logger.info(`MessageList instance ${myId} MOUNTED`);
  
  const { messages, activePersonaId, personas, activeContextBoundary, getQuotes, quotesVersion } = useEi();
  const { focusedPanel, registerMessageScroll } = useKeyboardNav();

  const isFocused = () => focusedPanel() === "messages";

  const [allQuotes, setAllQuotes] = createSignal<Quote[]>([]);

  createEffect(on(() => [messages(), quotesVersion()], () => {
    void getQuotes().then(setAllQuotes);
  }));

  const messagesWithQuotes = createMemo<MessageWithQuotes[]>(() => {
    const quotesByMessage = new Map<string, Quote[]>();
    for (const quote of allQuotes()) {
      if (quote.message_id) {
        const existing = quotesByMessage.get(quote.message_id) ?? [];
        existing.push(quote);
        quotesByMessage.set(quote.message_id, existing);
      }
    }

    return messages().map((msg, idx) => {
      const quotes = quotesByMessage.get(msg.id) ?? [];
      return {
        ...msg,
        _quotes: quotes,
        _quoteIndex: idx + 1,
      };
    });
  });

  const handleScrollboxRef = (scrollbox: ScrollBoxRenderable) => {
    registerMessageScroll(scrollbox);
  };

  const boundaryIsActive = createMemo(() => {
    const boundary = activeContextBoundary();
    const msgs = messages();
    const lastMessage = msgs[msgs.length - 1];
    return boundary ? (!lastMessage || boundary > lastMessage.timestamp) : false;
  });

  return (
    <box 
      flexGrow={1}
      border={isFocused() ? ["left"] : undefined}
      borderColor={isFocused() ? "#268bd2" : undefined}
      borderStyle="single"
    >
      <Show
        when={messagesWithQuotes().length > 0}
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
          <For each={messagesWithQuotes()}>
            {(message, index) => {
              const getDisplayName = () => {
                const persona = personas().find(p => p.id === activePersonaId());
                return persona?.display_name ?? "Ei";
              };
              const speaker = message.role === "human" ? "Human" : getDisplayName();
              const speakerColor = message.role === "human" ? "#2aa198" : "#b58900";
              
              const header = () => `${speaker} (${formatTime(message.timestamp)}) [✂️  ${message._quoteIndex}]:`;
              
              const displayContent = insertQuoteMarkers(buildMessageText(message), message._quotes);
              
              const showDivider = () => {
                const boundary = activeContextBoundary();
                if (!boundary) return false;
                const i = index();
                if (i === 0) return false;
                const msgs = messagesWithQuotes();
                const prevMsg = msgs[i - 1];
                const result = prevMsg.timestamp < boundary && message.timestamp >= boundary;
                if (result) {
                  logger.debug(`showDivider TRUE at index ${i}: prev=${prevMsg.timestamp}, boundary=${boundary}, curr=${message.timestamp}`);
                }
                return result;
              };

              const showTrailingDivider = () => {
                const msgs = messagesWithQuotes();
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
                      content={header()}
                    />
                    <box marginLeft={2}>
                      <markdown
                        content={displayContent}
                        syntaxStyle={solarizedDarkSyntax}
                        conceal={true}
                      />
                    </box>
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
