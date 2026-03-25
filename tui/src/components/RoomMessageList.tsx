import { For, Show, createMemo, onCleanup } from "solid-js";
import { TextAttributes, type ScrollBoxRenderable } from "@opentui/core";
import { useEi } from "../context/ei.js";
import { useKeyboardNav } from "../context/keyboard.js";
import { solarizedDarkSyntax } from "../util/syntax.js";
import type { RoomMessage } from "../../../src/core/types.js";
import { RoomMode } from "../../../src/core/types/enums.js";

function formatTime(timestamp: string): string {
  const date = new Date(timestamp);
  const hours = date.getHours().toString().padStart(2, "0");
  const minutes = date.getMinutes().toString().padStart(2, "0");
  return `${hours}:${minutes}`;
}

export function RoomMessageList() {
  const { roomMessages, roomActivePath, personas, activeRoomId, getRoom } = useEi();
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
        >
          <For each={displayMessages()}>
            {(msg) => {
              const speakerName = getSpeakerName(msg);
              const speakerColor = getSpeakerColor(msg);
              const idx = messageIndices().get(msg.id) ?? "?";
              const siblingCount = siblingCounts().get(msg.id) ?? 0;
              const branchIndicator = (siblingCount > 0 && activeRoom()?.mode === RoomMode.ChooseYourPath)
                ? ` ⑂${siblingCount}`
                : "";
              const header = `${speakerName} (${formatTime(msg.timestamp)}) [${idx}]${branchIndicator}:`;
              const isSilence = msg.silence_reason !== undefined && !msg.verbal_response;
              const isJudge = activeRoom()?.judge_persona_id !== undefined
                && msg.persona_id === activeRoom()?.judge_persona_id;
              const silenceText = isSilence
                ? isJudge
                  ? `[${speakerName}'s verdict: ${msg.silence_reason ?? ""}]`
                  : `[${speakerName} chose not to respond: ${msg.silence_reason ?? ""}]`
                : "";
              const contentParts: string[] = [];
              if (msg.action_response) contentParts.push(`_${msg.action_response}_`);
              if (msg.verbal_response) contentParts.push(msg.verbal_response);
              const normalContent = contentParts.join("\n\n");

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
