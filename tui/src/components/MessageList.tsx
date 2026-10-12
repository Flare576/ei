import { For, Show, createMemo, createSignal, createEffect, on, onMount } from "solid-js";
import { TextAttributes, type ScrollBoxRenderable } from "@opentui/core";
import { useEi } from "../context/ei.js";
import { useKeyboardNav } from "../context/keyboard.js";
import { logger } from "../util/logger.js";
import { solarizedDarkSyntax } from "../util/syntax.js";
import { TOOLS_RAN_NO_REPLY_SILENCE_REASON, type Quote, type Message, type ToolCallRecord } from "../../../src/core/types.js";
import { insertQuoteMarkers } from "../util/quote-utils.js";

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

function getContent(msg: { content?: string }): string {
  return msg.content ?? '';
}

function buildMessageText(message: Message, humanName: string): string {
  if (message.silence_reason !== undefined) {
    if (message.role === "system" && message.silence_reason === TOOLS_RAN_NO_REPLY_SILENCE_REASON) {
      return "[Persona ran tools but sent no reply]";
    }
    const silentParty = message.role === "human" ? humanName : "Persona";
    return `[${silentParty} chose not to respond: ${message.silence_reason}]`;
  }
  return getContent(message);
}

function toolCallIcon(toolCalls: ToolCallRecord[] | undefined): string {
  if (!toolCalls || toolCalls.length === 0) return "";
  return toolCalls.some(call => call.kind === "write") ? "🧧" : "🔧";
}

let instanceId = 0;

export function MessageList() {
  const myId = ++instanceId;
  logger.info(`MessageList instance ${myId} MOUNTED`);
  
  const { messages, activePersonaId, personas, activeContextBoundary, getQuotes, quotesVersion, getHuman, getPersona } = useEi();
  const { focusedPanel, registerMessageScroll } = useKeyboardNav();

  const isFocused = () => focusedPanel() === "messages";

  const [humanDisplayName, setHumanDisplayName] = createSignal("Human");
  const [allQuotes, setAllQuotes] = createSignal<Quote[]>([]);
  // The active Persona's resolved thinking-display setting. Unset until the
  // lookup for the current Persona resolves, so a stored `false` never flashes
  // visible while the lookup is pending.
  const [thinkingSetting, setThinkingSetting] = createSignal<{ personaId: string; visible: boolean } | null>(null);

  onMount(() => {
    void getHuman().then(human => {
      const name =
        human.settings?.name_display ||
        human.facts?.find(f => f.name === "Nickname/Preferred Name")?.description ||
        "Human";
      setHumanDisplayName(name);
    });
  });

  createEffect(on(() => [messages(), quotesVersion()], () => {
    void getQuotes().then(setAllQuotes);
  }));

  // Every refetch (a Persona switch or a same-Persona personas() re-emission)
  // clears the resolved setting and bumps the token, so thinking text is
  // withheld until the CURRENT lookup resolves and a response that is no
  // longer the latest lookup is ignored.
  let thinkingLookupToken = 0;
  createEffect(on(() => [personas(), activePersonaId()], () => {
    const personaId = activePersonaId();
    const token = ++thinkingLookupToken;
    setThinkingSetting(null);
    if (!personaId) return;
    getPersona(personaId).then(persona => {
      if (token !== thinkingLookupToken) return;
      setThinkingSetting({ personaId, visible: persona?.show_thinking ?? true });
    }).catch(error => {
      logger.error(`Failed to load persona ${personaId} for thinking display`, error);
    });
  }));

  const thinkingVisible = () => {
    const setting = thinkingSetting();
    return setting !== null && setting.personaId === activePersonaId() && setting.visible;
  };

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
          viewportCulling={true}
          wrapperOptions={{ paddingRight: 2 }}
        >
          <For each={messagesWithQuotes()}>
            {(message, index) => {
              const getDisplayName = () => {
                const persona = personas().find(p => p.id === activePersonaId());
                return persona?.display_name ?? "Ei";
              };
              const speaker = message.role === "human" ? humanDisplayName() : getDisplayName();
              const speakerColor = message.role === "human" ? "#2aa198" : "#b58900";
              
              const thinkingPresent = (message.thinking ?? "").length > 0;
              const icons = [toolCallIcon(message.tool_calls), thinkingPresent ? "💭" : ""].filter(Boolean).join(" ");
              const baseHeader = `${speaker} (${formatTime(message.timestamp)}) [✂️  ${message._quoteIndex}]:`;
              const header = () => (icons ? `${baseHeader} ${icons}` : baseHeader);
              
              const displayContent = insertQuoteMarkers(buildMessageText(message, humanDisplayName()), message._quotes);
              
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
                    <box paddingLeft={2} visible={thinkingPresent && thinkingVisible()}>
                      <text fg="#586e75" attributes={TextAttributes.ITALIC} content={message.thinking ?? ""} />
                    </box>
                    <box paddingLeft={2} flexGrow={1}>
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
