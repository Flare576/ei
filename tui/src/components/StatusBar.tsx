import { Show, createMemo } from "solid-js";
import { useEi } from "../context/ei";
import { useKeyboardNav } from "../context/keyboard";
import { RoomMode } from "../../../src/core/types/enums.js";

export function StatusBar() {
  const {
    activePersonaId,
    personas,
    queueStatus,
    notification,
    activeRoomId,
    roomMessages,
    getRoom,
    rooms,
    humanRoomMessagePending,
    isRoomProcessing,
  } = useEi();
  const { focusedPanel, sidebarVisible } = useKeyboardNav();

  const getActiveDisplayName = () => {
    const id = activePersonaId();
    if (!id) return null;
    const persona = personas().find(p => p.id === id);
    return persona?.display_name ?? id;
  };

  const getQueueIndicator = () => {
    const status = queueStatus();
    let label: string;
    if (status.state === "busy") {
      label = `Processing (${status.pending_count})`;
    } else if (status.state === "paused") {
      label = `Paused (${status.pending_count})`;
    } else if (status.pending_count > 0) {
      label = `Waiting (${status.pending_count})`;
    } else {
      label = "Ready";
    }
    if (status.dlq_count > 0) {
      label += ` [DLQ:${status.dlq_count}]`;
    }
    return label;
  };

  const getFocusIndicator = () => {
    const panel = focusedPanel();
    return panel.charAt(0).toUpperCase() + panel.slice(1);
  };

  const getNotificationColor = () => {
    const n = notification();
    if (!n) return "#586e75";
    if (n.level === "error") return "#dc322f";
    if (n.level === "warn") return "#b58900";
    return "#2aa198";
  };

  const respondedPersonaIds = createMemo(() => {
    const roomId = activeRoomId();
    if (!roomId) return new Set<string>();
    const roomSummary = rooms().find(r => r.id === roomId);
    if (!roomSummary?.active_node_id) return new Set<string>();
    const msgs = roomMessages().filter(
      m => m.parent_id === roomSummary.active_node_id && m.role === "persona" && m.persona_id
    );
    return new Set(msgs.map(m => m.persona_id!));
  });

  const allPersonasResponded = createMemo(() => {
    const roomId = activeRoomId();
    if (!roomId) return false;
    const room = getRoom(roomId);
    if (!room) return false;
    const judgeId = room.judge_persona_id;
    const nonJudgeIds = room.persona_ids.filter(id => id !== judgeId);
    return nonJudgeIds.every(id => respondedPersonaIds().has(id));
  });

  const pendingPersonaNames = createMemo(() => {
    const roomId = activeRoomId();
    if (!roomId) return [];
    const room = getRoom(roomId);
    if (!room) return [];
    const judgeId = room.judge_persona_id;
    const allPersonas = personas();
    return room.persona_ids
      .filter(id => id !== judgeId && !respondedPersonaIds().has(id))
      .map(id => allPersonas.find(p => p.id === id)?.display_name ?? id);
  });

  const getRoomWaitingText = () => {
    const names: string[] = [];
    if (!humanRoomMessagePending()) {
      names.push("You");
    }
    names.push(...pendingPersonaNames());
    return "Waiting for " + names.join(", ") + "...";
  };

  const activeRoom = () => {
    const roomId = activeRoomId();
    if (!roomId) return null;
    return getRoom(roomId);
  };

  const centerIndicator = createMemo(() => {
    const roomId = activeRoomId();
    if (roomId) {
      const room = getRoom(roomId);
      if (room?.mode !== RoomMode.FreeForAll) {
        if (isRoomProcessing()) {
          return { text: "[Waiting]", color: "#586e75" };
        }
        if (humanRoomMessagePending() && allPersonasResponded()) {
          return { text: "[Activate!]", color: "#b58900" };
        }
        if (humanRoomMessagePending()) {
          return { text: "[Waiting]", color: "#586e75" };
        }
      }
    }
    return { text: `[${getFocusIndicator()}]`, color: "#586e75" };
  });

  return (
    <box
      height={1}
      backgroundColor="#16213e"
      paddingLeft={1}
      paddingRight={1}
      flexDirection="row"
    >
      <box flexGrow={1}>
        <Show when={notification()} fallback={
          <Show when={activeRoomId()} fallback={
            <text fg="#586e75">
              <Show when={getActiveDisplayName()} fallback="No persona selected">
                {getActiveDisplayName()}
              </Show>
            </text>
          }>
            <Show when={allPersonasResponded()} fallback={
              <text fg="#586e75">
                {getRoomWaitingText()}
              </text>
            }>
              <text fg="#586e75">
                {activeRoom()?.display_name ?? ""}
              </text>
            </Show>
          </Show>
        }>
          <text fg={getNotificationColor()}>
            {notification()?.message}
          </text>
        </Show>
      </box>

      <text fg={centerIndicator().color} marginRight={2}>
        {centerIndicator().text}
      </text>

      <Show when={!sidebarVisible()}>
        <text fg="#586e75" marginRight={2}>
          [S]
        </text>
      </Show>

      <text fg={queueStatus().state === "busy" ? "#b58900" : queueStatus().dlq_count > 0 ? "#dc322f" : queueStatus().pending_count > 0 ? "#2aa198" : "#586e75"}>
        {getQueueIndicator()}
      </text>
    </box>
  );
}
