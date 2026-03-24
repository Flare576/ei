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
  onSubmitHumanMessage: (content: string | null, silenceReason?: string) => void;
  onActivateRoom: () => void;
  onSelectCYPBranch: (messageId: string) => void;
  onRecallMessage?: () => void;
  isProcessing: boolean;
  isActivating?: boolean;
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

const EXPAND_THRESHOLD = 200;

function getAvatarColor(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) | 0;
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

function getInitials(name: string): string {
  return name.split(/\s+/).map(w => w[0]).join("").toUpperCase().slice(0, 2);
}

function formatTime(timestamp: string): string {
  return new Date(timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function buildRoomMessageText(msg: RoomMessage): string {
  if (msg.silence_reason) return `_[chose not to respond: ${msg.silence_reason}]_`;
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
  onSubmitHumanMessage,
  onActivateRoom,
  onSelectCYPBranch,
  onRecallMessage,
  isProcessing,
  isActivating = false,
}: RoomChatPanelProps) {
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [showCYPPicker, setShowCYPPicker] = useState(false);
  const [showSendDropdown, setShowSendDropdown] = useState(false);
  const [isSilentMode, setIsSilentMode] = useState(false);
  const [expandedCards, setExpandedCards] = useState<Set<string>>(new Set());
  const [navPickerMessageId, setNavPickerMessageId] = useState<string | null>(null);
  const [showScrollButton, setShowScrollButton] = useState(false);

  const personaMap = new Map(personas.map(p => [p.id, p]));

  const isFFA = room?.mode === RoomMode.FreeForAll;
  const isCYP = room?.mode === RoomMode.ChooseYourPath;

  const currentRoundMessages = room
    ? allRoomMessages.filter(m => m.parent_id === room.active_node_id)
    : [];

  const humanSubmittedMessage = currentRoundMessages.find(
    m => m.role === "human"
  ) ?? null;
  const humanHasSubmitted = !!humanSubmittedMessage;

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
  const needsActivation = allPersonasDone && humanHasSubmitted;

  const statusText: string | null = (() => {
    if (!room || isFFA) return null;
    if (isGathering) {
      if (pendingPersonaCount > 0 && !humanHasSubmitted) {
        const n = pendingPersonaCount;
        return `Waiting for Your Response + ${n} Persona response${n === 1 ? "" : "s"}`;
      }
      if (pendingPersonaCount > 0) {
        const n = pendingPersonaCount;
        return `Waiting for ${n} Persona response${n === 1 ? "" : "s"}`;
      }
      return "Processing\u2026";
    }
    if (!humanHasSubmitted) return "Waiting for Your Response";
    return null;
  })();

  const showActivateButton = needsActivation && !isGathering;

  const ffaPendingCount = isFFA
    ? expectedPersonaIds.filter(id => !respondedPersonaIds.has(id)).length
    : 0;

  const displayMessages = isCYP
    ? activeRoomPath
    : isFFA
      ? [...allRoomMessages].sort((a, b) => a.timestamp.localeCompare(b.timestamp))
      : allRoomMessages.filter(m => m.parent_id !== room?.active_node_id);

  const SCROLL_THRESHOLD = 150;

  const scrollToBottom = useCallback(() => {
    const container = messagesContainerRef.current;
    if (container) container.scrollTop = container.scrollHeight;
  }, []);

  const isNearBottom = useCallback(() => {
    const c = messagesContainerRef.current;
    if (!c) return true;
    return c.scrollHeight - c.scrollTop - c.clientHeight <= SCROLL_THRESHOLD;
  }, []);

  const handleContainerScroll = useCallback(() => {
    setShowScrollButton(!isNearBottom());
  }, [isNearBottom]);

  const prevMessageCount = useRef(0);
  useEffect(() => {
    const count = displayMessages.length;
    if (count !== prevMessageCount.current) {
      if (isNearBottom()) scrollToBottom();
      prevMessageCount.current = count;
    }
  }, [displayMessages.length, isNearBottom, scrollToBottom]);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, window.innerHeight * 0.33)}px`;
  }, [inputValue]);

  useEffect(() => {
    setShowCYPPicker(false);
    setExpandedCards(new Set());
    setNavPickerMessageId(null);
    setShowScrollButton(false);
    scrollToBottom();
  }, [room?.id, scrollToBottom]);

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

  const handleSend = useCallback(() => {
    if (isSilentMode) {
      onSubmitHumanMessage(null, inputValue.trim() || undefined);
      setIsSilentMode(false);
    } else {
      onSubmitHumanMessage(inputValue.trim() || null);
    }
  }, [isSilentMode, inputValue, onSubmitHumanMessage]);

  const handleActivate = useCallback(() => {
    if (isCYP) {
      setShowCYPPicker(true);
    } else {
      onActivateRoom();
    }
  }, [isCYP, onActivateRoom]);

  const canSend = isFFA
    ? (inputValue.trim().length > 0 || isSilentMode)
    : (!humanHasSubmitted && (inputValue.trim().length > 0 || isSilentMode));
  const canActivate = !isFFA && humanHasSubmitted && allPersonasDone && !isActivating;
  const isWaiting = !isFFA && humanHasSubmitted && (!allPersonasDone || isActivating);

  const buttonLabel = isFFA
    ? "Send"
    : humanHasSubmitted
      ? (isActivating ? "Queued\u2026" : allPersonasDone ? "Activate \u25b6" : "Waiting\u2026")
      : "Send";
  const buttonDisabled = !activeRoomId || (isFFA ? !canSend : (isWaiting || (!canSend && !canActivate)));
  const buttonOnClick = canActivate ? handleActivate : handleSend;

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      if (isFFA) {
        if (canSend) { e.preventDefault(); handleSend(); }
        return;
      }
      e.preventDefault();
      if (!humanHasSubmitted && inputValue.trim()) {
        handleSend();
      } else if (humanHasSubmitted && allPersonasDone) {
        handleActivate();
      }
      return;
    }
    if (e.key === "c" && e.ctrlKey) {
      e.preventDefault();
      onInputChange("");
      setIsSilentMode(false);
      return;
    }
    if (e.key === "ArrowUp" && onRecallMessage && humanHasSubmitted) {
      const textarea = textareaRef.current;
      if (textarea && textarea.selectionStart === 0 && textarea.selectionEnd === 0) {
        e.preventDefault();
        onRecallMessage();
      }
    }
  };

  const toggleCardExpand = (id: string) => {
    setExpandedCards(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const currentRoundPersonaMessages = currentRoundMessages.filter(m => m.role === "persona");

  const renderMessage = (msg: RoomMessage) => {
    const persona = msg.persona_id ? personaMap.get(msg.persona_id) : null;
    const speakerName = persona?.display_name ?? (msg.role === "human" ? "You" : "Persona");
    const avatarColor = msg.persona_id ? getAvatarColor(msg.persona_id) : "#007bff";

    const siblings = isCYP && msg.parent_id !== null
      ? allRoomMessages.filter(m => m.parent_id === msg.parent_id)
      : [];
    const hasBranches = siblings.length > 1;
    const navOpen = navPickerMessageId === msg.id;

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
        <div className="ei-room-message__time">
          {formatTime(msg.timestamp)}
          {hasBranches && (
            <span
              className="ei-cyp-branch-badge"
              onClick={() => setNavPickerMessageId(navOpen ? null : msg.id)}
            >
              ↕ {siblings.length} paths
            </span>
          )}
        </div>
        {navOpen && (
          <div className="ei-cyp-nav-picker">
            <div className="ei-cyp-nav-picker__title">Alternative paths from here:</div>
            {siblings.map(sibling => {
              const isCurrent = sibling.id === msg.id;
              const sibPersona = sibling.persona_id ? personaMap.get(sibling.persona_id) : null;
              const sibName = sibPersona?.display_name ?? (sibling.role === "human" ? "You" : "Persona");
              const sibColor = sibling.persona_id ? getAvatarColor(sibling.persona_id) : "#007bff";
              const sibText = buildRoomMessageText(sibling);
              const preview = sibText.slice(0, EXPAND_THRESHOLD);
              return (
                <div key={sibling.id} className={`ei-cyp-card${isCurrent ? " ei-cyp-card--current" : ""}`}>
                  <div className="ei-cyp-card__header">
                    <div className="ei-cyp-card__avatar" style={{ background: sibColor }}>
                      {getInitials(sibName)}
                    </div>
                    <span className="ei-cyp-card__name">{sibName}</span>
                  </div>
                  <div className="ei-cyp-card__preview">
                    {preview}{preview.length < sibText.length ? "\u2026" : ""}
                  </div>
                  <button
                    disabled={isCurrent}
                    className={`ei-btn ei-btn--sm ${isCurrent ? "ei-btn--secondary" : "ei-btn--primary"}`}
                    onClick={() => {
                      if (!isCurrent) {
                        onSelectCYPBranch(sibling.id);
                        setNavPickerMessageId(null);
                      }
                    }}
                  >
                    {isCurrent ? "Current path" : "Choose this path"}
                  </button>
                </div>
              );
            })}
            <button
              className="ei-btn ei-btn--sm ei-btn--ghost"
              onClick={() => setNavPickerMessageId(null)}
            >
              Cancel
            </button>
          </div>
        )}
      </div>
    );
  };

  const renderCYPCard = (msg: RoomMessage, isHuman = false) => {
    const persona = msg.persona_id ? personaMap.get(msg.persona_id) : null;
    const name = isHuman ? "You" : (persona?.display_name ?? "Persona");
    const color = isHuman ? "#007bff" : (msg.persona_id ? getAvatarColor(msg.persona_id) : "#6c757d");
    const text = buildRoomMessageText(msg);
    const isLong = text.length > EXPAND_THRESHOLD;
    const isExpanded = expandedCards.has(msg.id);
    const preview = isExpanded ? text : text.slice(0, EXPAND_THRESHOLD);

    return (
      <div key={msg.id} className={`ei-cyp-card${isHuman ? " ei-cyp-card--human" : ""}`}>
        <div className="ei-cyp-card__header">
          <div className="ei-cyp-card__avatar" style={{ background: color }}>
            {getInitials(name)}
          </div>
          <span className="ei-cyp-card__name">{name}</span>
        </div>
        <div className="ei-cyp-card__preview">
          {preview}{!isExpanded && isLong ? "…" : ""}
        </div>
        {isLong && (
          <button
            className="ei-cyp-card__expand"
            onClick={() => toggleCardExpand(msg.id)}
          >
            {isExpanded ? "▲ Show less" : "▼ Show more"}
          </button>
        )}
        <button
          className="ei-btn ei-btn--sm ei-btn--primary"
          onClick={() => {
            onSelectCYPBranch(msg.id);
            setShowCYPPicker(false);
          }}
        >
          Choose
        </button>
      </div>
    );
  };

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

      <div style={{ position: "relative", flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <div className="ei-room-chat-panel__messages" ref={messagesContainerRef} onScroll={handleContainerScroll}>
        {displayMessages.length === 0 ? (
          <div className="ei-room-chat-panel__empty">
            {activeRoomId ? "No messages yet. The room is waiting\u2026" : "Select a room to start chatting"}
          </div>
        ) : (
          displayMessages.map(renderMessage)
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

        {isFFA && ffaPendingCount > 0 && (
          <div className="ei-room-status ei-room-status--ffa">
            <span className="ei-room-status__text">
              {ffaPendingCount} persona{ffaPendingCount !== 1 ? "s" : ""} responding\u2026
            </span>
          </div>
        )}

        {room && !isFFA && (statusText || showActivateButton) && (
          <div className="ei-room-status">
            {statusText && <span className="ei-room-status__text">{statusText}</span>}
            {showActivateButton && (
              <button className="ei-room-status__activate" onClick={handleActivate}>
                ▶ Activate
              </button>
            )}
          </div>
        )}

        {isCYP && showCYPPicker && (
          <div className="ei-cyp-picker">
            <div className="ei-cyp-picker__title">Choose a branch to continue:</div>
            {currentRoundPersonaMessages.map(msg => renderCYPCard(msg))}
            {humanSubmittedMessage && renderCYPCard(humanSubmittedMessage, true)}
            <button
              className="ei-btn ei-btn--ghost ei-btn--sm ei-cyp-picker__cancel"
              onClick={() => setShowCYPPicker(false)}
            >
              Cancel
            </button>
          </div>
        )}
      </div>
      {showScrollButton && (
        <button
          className="ei-scroll-to-bottom"
          onClick={() => { scrollToBottom(); setShowScrollButton(false); }}
        >
          ↓ Latest
        </button>
      )}
      </div>

      <div className="ei-input-area">
        <textarea
          ref={textareaRef}
          className={`ei-input-area__textarea${isSilentMode ? " ei-input-area__textarea--silent" : ""}`}
          value={inputValue}
          onChange={(e) => onInputChange(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={
            !activeRoomId
              ? "Select a room first"
              : humanHasSubmitted
              ? `Response submitted\u2014press \u2191 to recall`
              : isSilentMode
              ? "Silence reason (optional)\u2026"
              : "Type a message\u2026 (Enter to send, Shift+Enter for newline)"
          }
          disabled={!activeRoomId}
          rows={1}
        />
        <div className="ei-room-send-group" ref={dropdownRef}>
          <button
            className="ei-room-send-group__main"
            onClick={buttonOnClick}
            disabled={buttonDisabled}
          >
            {buttonLabel}
          </button>
          <button
            className="ei-room-send-group__dropdown-toggle"
            onClick={() => setShowSendDropdown(v => !v)}
            disabled={!activeRoomId || humanHasSubmitted}
            aria-label="More send options"
          >
            ▼
          </button>
          {showSendDropdown && (
            <div className="ei-room-send-dropdown">
              <button
                onClick={() => {
                  setIsSilentMode(v => !v);
                  setShowSendDropdown(false);
                  textareaRef.current?.focus();
                }}
              >
                {isSilentMode ? "Normal Response" : "Silent Response"}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
