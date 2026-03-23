import { useState, useRef, useEffect, useCallback } from "react";
import type { RoomEntity, RoomMessage, PersonaSummary } from "../../../../src/core/types";
import { RoomMode } from "../../../../src/core/types";
import { MarkdownContent } from "../Chat";

interface RoomChatPanelProps {
  activeRoomId: string | null;
  room: RoomEntity | null;
  activeRoomPath: RoomMessage[];
  allRoomMessages: RoomMessage[];
  personas: PersonaSummary[];
  inputValue: string;
  onInputChange: (value: string) => void;
  onSendMessage: () => void;
  onActivateRoom: (humanContent: string | null) => void;
  onSelectCYPBranch: (messageId: string) => void;
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
  "#e74c3c", "#e67e22", "#2ecc71", "#1abc9c",
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

function buildRoomMessageText(msg: RoomMessage): string {
  const parts: string[] = [];
  if (msg.action_response) parts.push(`_${msg.action_response}_`);
  if (msg.verbal_response) parts.push(msg.verbal_response);
  return parts.join("\n\n");
}

export function RoomChatPanel({
  activeRoomId,
  room,
  activeRoomPath,
  allRoomMessages,
  personas,
  inputValue,
  onInputChange,
  onSendMessage,
  onActivateRoom,
  onSelectCYPBranch,
  isProcessing,
}: RoomChatPanelProps) {
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [showCYPPicker, setShowCYPPicker] = useState(false);
  const [showSendDropdown, setShowSendDropdown] = useState(false);

  const personaMap = new Map(personas.map(p => [p.id, p]));

  const isFFA = room?.mode === RoomMode.FreeForAll;
  const isCYP = room?.mode === RoomMode.ChooseYourPath;

  const currentRoundMessages = room
    ? allRoomMessages.filter(m => m.parent_id === room.active_node_id)
    : [];

  const expectedPersonaIds = room
    ? room.persona_ids.filter(
        id => room.mode !== RoomMode.MessagesAgainstPersona || id !== room.judge_persona_id
      )
    : [];

  const respondedPersonaIds = new Set(
    currentRoundMessages
      .filter(m => m.role === "persona" && m.persona_id)
      .map(m => m.persona_id!)
  );

  const pendingPersonaCount = expectedPersonaIds.filter(id => !respondedPersonaIds.has(id)).length;
  const isGathering = isProcessing || pendingPersonaCount > 0;
  const hasRoundMessages = currentRoundMessages.length > 0;
  const allPersonasDone = !isGathering && hasRoundMessages;
  const humanHasTyped = inputValue.trim().length > 0;
  const needsActivation = !isFFA && allPersonasDone;

  const statusText: string | null = (() => {
    if (!room || isFFA) return null;
    if (isGathering) {
      if (pendingPersonaCount > 0 && !humanHasTyped) {
        const n = pendingPersonaCount;
        return `Waiting for Your Response + ${n} Persona response${n === 1 ? "" : "s"}`;
      }
      if (pendingPersonaCount > 0) {
        const n = pendingPersonaCount;
        return `Waiting for ${n} Persona response${n === 1 ? "" : "s"}`;
      }
      return "Processing\u2026";
    }
    if (needsActivation && !humanHasTyped) return "Waiting for Your Response";
    return null;
  })();

  const showActivateButton = needsActivation && humanHasTyped && !isGathering;

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

  useEffect(() => {
    if (!showSendDropdown) return;
    const handleClick = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowSendDropdown(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [showSendDropdown]);

  const handleActivate = useCallback(() => {
    if (isCYP) {
      setShowCYPPicker(true);
    } else {
      onActivateRoom(inputValue.trim() || null);
      onInputChange("");
    }
  }, [isCYP, inputValue, onActivateRoom, onInputChange]);

  const handleMainSend = useCallback(() => {
    if (isFFA) {
      onSendMessage();
    } else {
      handleActivate();
    }
  }, [isFFA, onSendMessage, handleActivate]);

  const mainSendDisabled = !activeRoomId || (
    isFFA
      ? !inputValue.trim() || isProcessing
      : isGathering || !humanHasTyped || !needsActivation
  );

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (!mainSendDisabled) handleMainSend();
    }
    if (e.key === "c" && e.ctrlKey) {
      e.preventDefault();
      onInputChange("");
    }
  };

  const currentRoundPersonaMessages = currentRoundMessages.filter(m => m.role === "persona");

  return (
    <div className="ei-room-chat-panel">
      <div className="ei-room-chat-panel__header">
        <h2 className="ei-room-chat-panel__title">
          {room ? (
            <>
              {room.display_name}
              <span className={`ei-room-chat-panel__mode ${MODE_CLASS[room.mode]}`}>
                {MODE_LABEL[room.mode]}
              </span>
            </>
          ) : (
            "Room"
          )}
        </h2>
      </div>

      <div className="ei-room-chat-panel__messages" ref={messagesContainerRef}>
        {activeRoomPath.length === 0 ? (
          <div className="ei-room-chat-panel__empty">
            {activeRoomId ? "No messages yet. The room is waiting…" : "Select a room to start chatting"}
          </div>
        ) : (
          activeRoomPath.map((msg) => {
            const persona = msg.persona_id ? personaMap.get(msg.persona_id) : null;
            const speakerName = persona?.display_name ?? (msg.role === "human" ? "You" : "Persona");
            const avatarColor = msg.persona_id ? getAvatarColor(msg.persona_id) : "#007bff";

            return (
              <div key={msg.id} className={`ei-room-message-wrapper ${msg.role}`}>
                {msg.role === "persona" && (
                  <div className="ei-room-message__speaker-row">
                    <div className="ei-room-message__avatar" style={{ background: avatarColor }}>
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
                      <MarkdownContent content={buildRoomMessageText(msg)} />
                    )}
                  </div>
                </div>
                <div className="ei-room-message__time">{formatTime(msg.timestamp)}</div>
              </div>
            );
          })
        )}

        {isProcessing && pendingPersonaCount > 0 && (
          <div className="ei-room-thinking">
            {expectedPersonaIds
              .filter(id => !respondedPersonaIds.has(id))
              .map(id => {
                const p = personaMap.get(id);
                const name = p?.display_name ?? id;
                return (
                  <div key={id} className="ei-room-thinking__item">
                    <span className="ei-room-thinking__spinner">⟳</span>
                    {name} is thinking…
                  </div>
                );
              })}
          </div>
        )}

        {room && !isFFA && (statusText || showActivateButton) && (
          <div className="ei-room-status">
            {statusText && (
              <span className="ei-room-status__text">{statusText}</span>
            )}
            {showActivateButton && (
              <button className="ei-room-status__activate" onClick={handleActivate}>
                ▶ Activate
              </button>
            )}
          </div>
        )}

        {showCYPPicker && (
          <div className="ei-cyp-picker">
            <div className="ei-cyp-picker__title">Choose a branch to continue:</div>
            {currentRoundPersonaMessages.map(msg => {
              const persona = msg.persona_id ? personaMap.get(msg.persona_id) : null;
              const name = persona?.display_name ?? "Persona";
              const color = msg.persona_id ? getAvatarColor(msg.persona_id) : "#6c757d";
              const text = buildRoomMessageText(msg);
              const preview = text.slice(0, 140);
              return (
                <div key={msg.id} className="ei-cyp-card">
                  <div className="ei-cyp-card__header">
                    <div className="ei-cyp-card__avatar" style={{ background: color }}>
                      {getInitials(name)}
                    </div>
                    <span className="ei-cyp-card__name">{name}</span>
                  </div>
                  <div className="ei-cyp-card__preview">
                    {preview}{preview.length < text.length ? "…" : ""}
                  </div>
                  <button
                    className="ei-btn ei-btn--primary ei-btn--sm"
                    onClick={() => {
                      onSelectCYPBranch(msg.id);
                      setShowCYPPicker(false);
                    }}
                  >
                    Choose
                  </button>
                </div>
              );
            })}
            {humanHasTyped && (
              <div className="ei-cyp-card ei-cyp-card--human">
                <div className="ei-cyp-card__header">
                  <div className="ei-cyp-card__avatar" style={{ background: "#007bff" }}>
                    {getInitials("You")}
                  </div>
                  <span className="ei-cyp-card__name">You</span>
                </div>
                <div className="ei-cyp-card__preview">
                  {inputValue.slice(0, 140)}{inputValue.length > 140 ? "…" : ""}
                </div>
                <button
                  className="ei-btn ei-btn--secondary ei-btn--sm"
                  onClick={() => {
                    onActivateRoom(inputValue.trim());
                    onInputChange("");
                    setShowCYPPicker(false);
                  }}
                >
                  Choose
                </button>
              </div>
            )}
            <button
              className="ei-btn ei-btn--ghost ei-btn--sm ei-cyp-picker__cancel"
              onClick={() => setShowCYPPicker(false)}
            >
              Cancel
            </button>
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
              ? isFFA
                ? "Type a message… (Enter to send, Shift+Enter for newline)"
                : "Type your response… (Enter to activate, Shift+Enter for newline)"
              : "Select a room first"
          }
          disabled={!activeRoomId}
          rows={1}
        />
        <div className="ei-room-send-group" ref={dropdownRef}>
          <button
            className="ei-room-send-group__main"
            onClick={handleMainSend}
            disabled={mainSendDisabled}
          >
            Send
          </button>
          <button
            className="ei-room-send-group__dropdown-toggle"
            onClick={() => setShowSendDropdown(v => !v)}
            disabled={!activeRoomId || isProcessing}
            aria-label="More send options"
          >
            ▼
          </button>
          {showSendDropdown && (
            <div className="ei-room-send-dropdown">
              <button
                onClick={() => {
                  onActivateRoom(null);
                  onInputChange("");
                  setShowSendDropdown(false);
                }}
              >
                Silent Response
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
