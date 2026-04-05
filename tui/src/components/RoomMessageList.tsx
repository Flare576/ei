import { For, Show, createMemo, createSignal, createEffect, on, onCleanup } from "solid-js";
import { TextAttributes, type ScrollBoxRenderable } from "@opentui/core";
import { useEi } from "../context/ei.js";
import { useKeyboardNav } from "../context/keyboard.js";
import { solarizedDarkSyntax } from "../util/syntax.js";
import type { RoomMessage, Quote } from "../../../src/core/types.js";
import { RoomMode } from "../../../src/core/types/enums.js";
import { insertQuoteMarkers } from "../util/quote-utils.js";

function getContent(msg: { content?: string; verbal_response?: string; action_response?: string }): string {
  if (msg.content) return msg.content;
  const parts: string[] = [];
  if (msg.action_response) parts.push(`_${msg.action_response}_`);
  if (msg.verbal_response) parts.push(msg.verbal_response);
  return parts.join('\n\n');
}

interface RoomMessageWithQuotes extends RoomMessage {
  _quotes: Quote[];
}

function formatTime(timestamp: string): string {
  const date = new Date(timestamp);
  const hours = date.getHours().toString().padStart(2, "0");
  const minutes = date.getMinutes().toString().padStart(2, "0");
  return `${hours}:${minutes}`;
}

export function RoomMessageList() {
  const { roomMessages, roomActivePath, personas, activeRoomId, getRoom, getQuotes, quotesVersion } = useEi();
  const { registerMessageScroll } = useKeyboardNav();

  const personaNameMap = createMemo(() => {
    const map = new Map<string, string>();
    for (const p of personas()) {
      map.set(p.id, p.display_name);
    }
    return map;
  });

  const messageIndices = createMemo(() => {
    const all = roomMessages();
    const indexMap = new Map<string, number>();
    all.forEach((m, i) => indexMap.set(m.id, i + 1));
    return indexMap;
  });

  const siblingCounts = createMemo(() => {
    const all = roomMessages();
    const countMap = new Map<string, number>();
    for (const msg of all) {
      const siblings = all.filter(m => m.parent_id === msg.parent_id && m.id !== msg.id && m.parent_id !== null);
      countMap.set(msg.id, siblings.length);
    }
    return countMap;
  });

  const activeRoom = createMemo(() => {
    const id = activeRoomId();
    return id ? getRoom(id) : null;
  });

  const displayMessages = createMemo(() => {
    if (activeRoom()?.mode === RoomMode.ChooseYourPath) {
      return roomActivePath();
    }
    if (activeRoom()?.mode === RoomMode.MessagesAgainstPersona) {
      const activeNodeId = activeRoom()?.active_node_id;
      if (!activeNodeId) return roomMessages();
      return roomMessages().filter(m => m.parent_id !== activeNodeId);
    }
    return roomMessages();
  });

  const [allQuotes, setAllQuotes] = createSignal<Quote[]>([]);

  createEffect(on(() => [roomMessages(), quotesVersion()], () => {
    void getQuotes().then(setAllQuotes);
  }));

  const quotesByMessage = createMemo(() => {
    const map = new Map<string, Quote[]>();
    for (const quote of allQuotes()) {
      if (quote.message_id) {
        const existing = map.get(quote.message_id) ?? [];
        existing.push(quote);
        map.set(quote.message_id, existing);
      }
    }
    return map;
  });

  const displayMessagesWithQuotes = createMemo<RoomMessageWithQuotes[]>(() => {
    const qMap = quotesByMessage();
    return displayMessages().map(msg => ({
      ...msg,
      _quotes: qMap.get(msg.id) ?? [],
    }));
  });

  const getSpeakerName = (msg: RoomMessage): string => {
    if (msg.role === "human") return "Human";
    if (msg.persona_id) return personaNameMap().get(msg.persona_id) ?? msg.persona_id;
    return "Persona";
  };

  const getSpeakerColor = (msg: RoomMessage): string => {
    if (msg.role === "human") return "#268bd2";
    return "#b58900";
  };

  const handleScrollboxRef = (scrollbox: ScrollBoxRenderable) => {
    registerMessageScroll(scrollbox);
  };

  onCleanup(() => {
    registerMessageScroll(null as unknown as ScrollBoxRenderable);
  });

  return (
    <box flexGrow={1}>
      <Show
        when={displayMessages().length > 0}
        fallback={
          <box flexGrow={1} padding={1} backgroundColor="#0f1419" justifyContent="center" alignItems="center">
            <text fg="#586e75" content="No messages yet." />
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
        >
          <For each={displayMessagesWithQuotes()}>
            {(msg) => {
              const speakerName = getSpeakerName(msg);
              const speakerColor = getSpeakerColor(msg);
              const idx = messageIndices().get(msg.id) ?? "?";
              const siblingCount = siblingCounts().get(msg.id) ?? 0;
              const branchIndicator = (siblingCount > 0 && activeRoom()?.mode === RoomMode.ChooseYourPath)
                ? ` ⑂${siblingCount}`
                : "";
              const header = `${speakerName} (${formatTime(msg.timestamp)}) [${idx}]${branchIndicator}:`;
              const isSilence = msg.silence_reason !== undefined && !getContent(msg);
              const isJudge = activeRoom()?.judge_persona_id !== undefined
                && msg.persona_id === activeRoom()?.judge_persona_id;
              const silenceText = isSilence
                ? isJudge
                  ? `[${speakerName}'s verdict: ${msg.silence_reason ?? ""}]`
                  : `[${speakerName} chose not to respond: ${msg.silence_reason ?? ""}]`
                : "";
              const msgQuotes = msg._quotes;
              const normalContent = insertQuoteMarkers(getContent(msg), msgQuotes);

              return (
                <box flexDirection="column" marginBottom={1}>
                  <text
                    fg={speakerColor}
                    attributes={TextAttributes.BOLD}
                    content={header}
                  />
                  <box marginLeft={2} visible={isSilence}>
                    <text fg="#586e75" content={silenceText} />
                  </box>
                  <box marginLeft={2} visible={!isSilence}>
                    <markdown
                      content={normalContent}
                      syntaxStyle={solarizedDarkSyntax}
                      conceal={true}
                    />
                  </box>
                </box>
              );
            }}
          </For>
        </scrollbox>
      </Show>
    </box>
  );
}
