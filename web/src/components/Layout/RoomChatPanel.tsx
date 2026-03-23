import { useRef, useEffect, useCallback } from "react";
import type { RoomEntity, RoomMessage, PersonaSummary } from "../../../../src/core/types";
import { RoomMode } from "../../../../src/core/types";
import { MarkdownContent } from "../Chat";

interface RoomChatPanelProps {
  activeRoomId: string | null;
  room: RoomEntity | null;
  messages: RoomMessage[];
  activePath: RoomMessage[];
  personas: PersonaSummary[];
  inputValue: string;
  onInputChange: (value: string) => void;
  onSendMessage: () => void;
  isProcessing: boolean;
}

const MODE_LABEL: Record<RoomMode, string> = {
  [RoomMode.ChooseYourPath]: "CYP",
  [RoomMode.FreeForAll]: "FFA",
  [RoomMode.MessagesAgainstPersona]: "MAP",
};

const MODE_CLASS: Record<RoomMode, string> = {
  [RoomMode.ChooseYourPath]: "ei-room-chat-panel__mode--cyp",
  [RoomMode.FreeForAll]: "ei-room-chat-panel__mode--ffa",
  [RoomMode.MessagesAgainstPersona]: "ei-room-chat-panel__mode--map",
};

const AVATAR_COLORS = [
  "#e74c3c", "#e67e22", "#f1c40f", "#2ecc71", "#1abc9c",
  "#3498db", "#9b59b6", "#e91e63", "#00bcd4", "#8bc34a",
];

function getAvatarColor(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) | 0;
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

function getInitials(name: string): string {
  return name
    .split(/\s+/)
    .map(w => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

function formatTime(timestamp: string): string {
  return new Date(timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function RoomChatPanel({
  activeRoomId,
  room,
  messages,
  activePath,
  personas,
  inputValue,
  onInputChange,
  onSendMessage,
  isProcessing,
}: RoomChatPanelProps) {
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const personaMap = new Map(personas.map(p => [p.id, p]));

  const scrollToBottom = useCallback(() => {
    const container = messagesContainerRef.current;
    if (container) container.scrollTop = container.scrollHeight;
  }, []);

  useEffect(() => {
    const container = messagesContainerRef.current;
    if (!container) return;
    const observer = new MutationObserver(() => {
      container.scrollTop = container.scrollHeight;
    });
    observer.observe(container, { childList: true, subtree: true });
    scrollToBottom();
    return () => observer.disconnect();
  }, [scrollToBottom]);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    const maxHeight = window.innerHeight * 0.33;
    textarea.style.height = `${Math.min(textarea.scrollHeight, maxHeight)}px`;
  }, [inputValue]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      onSendMessage();
    }
    if (e.key === "c" && e.ctrlKey) {
      e.preventDefault();
      onInputChange("");
    }
  };

  const displayMessages = room?.mode === RoomMode.ChooseYourPath ? activePath : messages;

  const pendingPersonaIds = (() => {
    if (!isProcessing || !room) return [];
    const lastHumanIdx = [...displayMessages].reverse().findIndex(m => m.role === "human");
    if (lastHumanIdx === -1) return room.persona_ids;
    const afterHumanIdx = displayMessages.length - lastHumanIdx;
    const respondedIds = new Set(
      displayMessages.slice(afterHumanIdx).map(m => m.persona_id).filter(Boolean)
    );
    return room.persona_ids.filter(id => !respondedIds.has(id));
  })();

  const showCYPIndicator =
    room?.mode === RoomMode.ChooseYourPath &&
    !isProcessing &&
    displayMessages.length > 0 &&
    displayMessages[displayMessages.length - 1].role === "persona";

  return (
    <div className="ei-room-chat-panel">
      <div className="ei-room-chat-panel__header">
        <h2 className="ei-room-chat-panel__title">
          {room ? (
            <>
              {room.display_name}
              <span className={`ei-room-chat-panel__mode ${room.mode ? MODE_CLASS[room.mode] : ""}`}>
                {room.mode ? MODE_LABEL[room.mode] : ""}
              </span>
            </>
          ) : (
            "Room"
          )}
        </h2>
      </div>

      <div className="ei-room-chat-panel__messages" ref={messagesContainerRef}>
        {displayMessages.length === 0 ? (
          <div className="ei-room-chat-panel__empty">
            {activeRoomId ? "No messages yet. The room is waiting..." : "Select a room to start chatting"}
          </div>
        ) : (
          displayMessages.map((msg) => {
            const persona = msg.persona_id ? personaMap.get(msg.persona_id) : null;
            const speakerName = persona?.display_name ?? (msg.role === "human" ? "You" : "Persona");
            const avatarColor = msg.persona_id ? getAvatarColor(msg.persona_id) : "#007bff";

            return (
              <div key={msg.id} className={`ei-room-message-wrapper ${msg.role}`}>
                {msg.role === "persona" && (
                  <div className="ei-room-message__speaker-row">
                    <div
                      className="ei-room-message__avatar"
                      style={{ background: avatarColor }}
                    >
                      {getInitials(speakerName)}
                    </div>
                    <span className="ei-room-message__speaker-name">{speakerName}</span>
                  </div>
                )}
                <div className="ei-room-message">
                  <div className="ei-room-message__bubble">
                    {msg.silence_reason !== undefined ? (
                      <span className="ei-room-message__silence">
                        [{speakerName} chose not to respond: {msg.silence_reason}]
                      </span>
                    ) : (
                      <MarkdownContent content={msg.verbal_response ?? msg.action_response ?? ""} />
                    )}
                  </div>
                </div>
                <div className="ei-room-message__time">{formatTime(msg.timestamp)}</div>
              </div>
            );
          })
        )}

        {isProcessing && pendingPersonaIds.length > 0 && (
          <div className="ei-room-thinking">
            {pendingPersonaIds.map(id => {
              const p = personaMap.get(id);
              const name = p?.display_name ?? id;
              return (
                <div key={id} className="ei-room-thinking__item">
                  <span className="ei-room-thinking__spinner">⟳</span>
                  {name} is thinking...
                </div>
              );
            })}
          </div>
        )}

        {showCYPIndicator && (
          <div className="ei-cyp-indicator">
            ✦ Each persona has responded. Continue the conversation to see more, or they'll all respond again.
          </div>
        )}
      </div>

      <div className="ei-input-area">
        <textarea
          ref={textareaRef}
          className="ei-input-area__textarea"
          value={inputValue}
          onChange={(e) => onInputChange(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={
            activeRoomId
              ? "Type a message... (Enter to send, Shift+Enter for newline)"
              : "Select a room first"
          }
          disabled={!activeRoomId}
          rows={1}
        />
        <button
          className="ei-input-area__send"
          onClick={onSendMessage}
          disabled={!activeRoomId || !inputValue.trim() || isProcessing}
        >
          Send
        </button>
      </div>
    </div>
  );
}
