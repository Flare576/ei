import { useState, useRef, useEffect, useLayoutEffect, useCallback, useMemo, forwardRef, useImperativeHandle } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useStickToBottom } from "use-stick-to-bottom";
import type { RoomEntity, RoomMessage, PersonaSummary } from "../../../../src/core/types";
import { RoomMode } from "../../../../src/core/types";
import { MarkdownContent } from "../Chat";
import { PersonaAvatar } from "../Avatar";
import { Tooltip } from './Tooltip';

function getContent(msg: { content?: string; verbal_response?: string; action_response?: string }): string {
  if (msg.content) return msg.content;
  const parts: string[] = [];
  if (msg.action_response) parts.push(`_${msg.action_response}_`);
  if (msg.verbal_response) parts.push(msg.verbal_response);
  return parts.join('\n\n');
}

export interface RoomChatPanelHandle {
  focusInput: () => void;
  scrollChat: (direction: "up" | "down") => void;
}

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
  onCapture?: () => void;
  onShowOverview?: () => void;
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

const EXPAND_THRESHOLD = 200;function formatTime(timestamp: string): string {
  return new Date(timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function buildRoomMessageText(msg: RoomMessage, judgePersonaId?: string): string {
  if (msg.silence_reason) {
    const label = judgePersonaId && msg.persona_id === judgePersonaId
      ? "verdict:"
      : "chose not to respond:";
    return `_[${label} ${msg.silence_reason}]_`;
  }
  return getContent(msg);
}

export const RoomChatPanel = forwardRef<RoomChatPanelHandle, RoomChatPanelProps>(function RoomChatPanel({
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
  onCapture,
  onShowOverview,
}: RoomChatPanelProps, ref) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const cypContainerRef = useRef<HTMLDivElement>(null);

  const { scrollRef, contentRef, isAtBottom, scrollToBottom } = useStickToBottom({
    initial: 'instant',
    resize: 'instant',
    targetScrollTop: (_, { scrollElement }) => scrollElement.scrollHeight - scrollElement.clientHeight,
  });

  const [containerWidth, setContainerWidth] = useState(0);
  useLayoutEffect(() => {
    if (scrollRef.current) setContainerWidth(scrollRef.current.clientWidth);
  }, []);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setContainerWidth(e.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useImperativeHandle(ref, () => ({
    focusInput: () => textareaRef.current?.focus(),
    scrollChat: (direction) => {
      const container = isCYP ? cypContainerRef.current : scrollRef.current;
      if (!container) return;
      const amount = container.clientHeight * 0.8;
      container.scrollBy({ top: direction === "up" ? -amount : amount, behavior: "smooth" });
    },
  }));
  const [showCYPPicker, setShowCYPPicker] = useState(false);
  const [showSendDropdown, setShowSendDropdown] = useState(false);
  const [isSilentMode, setIsSilentMode] = useState(false);
  const [expandedCards, setExpandedCards] = useState<Set<string>>(new Set());
  const [navPickerMessageId, setNavPickerMessageId] = useState<string | null>(null);

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
      .filter(m => m.role === "persona" && m.persona_id &&
                   !!(getContent(m) || m.silence_reason))
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

  const messageHeights = useMemo(() => {
    const charsPerLine = containerWidth > 0 ? Math.floor(containerWidth / 7.5) : 70;
    return displayMessages.map(msg => {
      const text = buildRoomMessageText(msg, room?.judge_persona_id);
      if (!text) return 60;
      const lines = Math.max(1, Math.ceil(text.length / charsPerLine));
      let height = lines * 20 + 60;
      if (text.includes('```')) height += 120;
      return height;
    });
  }, [displayMessages, room?.judge_persona_id, containerWidth]);

  const rowVirtualizer = useVirtualizer({
    count: isCYP ? 0 : displayMessages.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (i) => messageHeights[i] ?? 80,
    overscan: 5,
  });

  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = `${Math.min(ta.scrollHeight, window.innerHeight * 0.33)}px`;
  }, [inputValue]);

  const scrolledForRoomRef = useRef<string | null>(null);
  useEffect(() => { scrolledForRoomRef.current = null; }, [activeRoomId]);
  useEffect(() => {
    if (!activeRoomId || displayMessages.length === 0) return;
    if (scrolledForRoomRef.current === activeRoomId) return;
    scrolledForRoomRef.current = activeRoomId;
    scrollToBottom({ animation: 'instant' });
    const timer = setTimeout(() => scrollToBottom({ animation: 'instant' }), 100);
    return () => clearTimeout(timer);
  }, [activeRoomId, displayMessages.length, scrollToBottom]);

  useEffect(() => {
    setShowCYPPicker(false);
    setExpandedCards(new Set());
    setNavPickerMessageId(null);
    scrollToBottom({ animation: 'instant' });
    textareaRef.current?.focus();
  }, [room?.id, scrollToBottom]);

  useEffect(() => {
    if (!room?.active_node_id) return;
    if (isCYP) {
      const el = cypContainerRef.current;
      setTimeout(() => { if (el) el.scrollTop = el.scrollHeight; }, 50);
    } else {
      setTimeout(() => scrollToBottom({ animation: 'instant' }), 50);
    }
  }, [room?.active_node_id, isCYP, scrollToBottom]);

  const prevNeedsActivationRef = useRef(needsActivation);
  useEffect(() => {
    const prev = prevNeedsActivationRef.current;
    prevNeedsActivationRef.current = needsActivation;
    if (needsActivation && !prev) {
      if (isCYP) {
        const el = cypContainerRef.current;
        if (el) el.scrollTop = el.scrollHeight;
      } else {
        scrollToBottom({ animation: 'instant' });
      }
    }
  }, [needsActivation, isCYP, scrollToBottom]);

  useEffect(() => {
    if (!showCYPPicker) return;
    const el = cypContainerRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [showCYPPicker]);

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
    setTimeout(() => scrollToBottom({ animation: 'instant' }), 0);
  }, [isCYP, onActivateRoom, scrollToBottom]);

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

    const siblings = isCYP && msg.parent_id !== null
      ? allRoomMessages.filter(m => m.parent_id === msg.parent_id)
      : [];
    const hasBranches = siblings.length > 1;
    const navOpen = navPickerMessageId === msg.id;
    const unexploredSiblingCount = siblings.filter(s =>
      s.id !== msg.id && !allRoomMessages.some(m => m.parent_id === s.id)
    ).length;

    const personaTheme = msg.role === "persona" ? (persona?.preferred_theme ?? undefined) : undefined;

    return (
      <div key={msg.id} className={`ei-room-message-wrapper ${msg.role}`} data-persona-theme={personaTheme}>
        {msg.role === "persona" && (
            <div className="ei-room-message__speaker-row">
              <PersonaAvatar
                personaId={msg.persona_id ?? "human"}
                displayName={speakerName}
                avatarEmoji={persona?.avatar_emoji}
                avatarImage={persona?.avatar_image}
                size={28}
                className="ei-room-message__avatar"
              />
              <span className="ei-room-message__speaker-name">{speakerName}</span>
              {persona?.short_description && (
                <span className="ei-room-message__speaker-desc">{persona.short_description}</span>
              )}
            </div>
        )}
        <div className="ei-room-message">
          <div className="ei-room-message__bubble">
            {msg.silence_reason !== undefined ? (
              <span className="ei-room-message__silence">
                {msg.persona_id && msg.persona_id === room?.judge_persona_id
                  ? `[${speakerName}'s verdict: ${msg.silence_reason}]`
                  : `[${speakerName} chose not to respond: ${msg.silence_reason}]`}
              </span>
            ) : (
              <MarkdownContent content={buildRoomMessageText(msg, room?.judge_persona_id)} />
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
              {unexploredSiblingCount > 0 ? `↕ ${unexploredSiblingCount} unexplored` : "↕ all explored"}
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
              const sibText = buildRoomMessageText(sibling, room?.judge_persona_id);
              const sibIsLong = sibText.length > EXPAND_THRESHOLD;
              const sibIsExpanded = expandedCards.has(sibling.id);
              const siblingIsExplored = allRoomMessages.some(m => m.parent_id === sibling.id);
              return (
                <div key={sibling.id} className={`ei-cyp-card${isCurrent ? " ei-cyp-card--current" : ""}`}>
                   <div className="ei-cyp-card__header">
                    <PersonaAvatar
                      personaId={sibling.persona_id ?? "unknown"}
                      displayName={sibName}
                      avatarEmoji={sibPersona?.avatar_emoji}
                      avatarImage={sibPersona?.avatar_image}
                      size={20}
                      className="ei-cyp-card__avatar"
                    />
                    <span className="ei-cyp-card__name">{sibName}</span>
                    <span className={`ei-cyp-explored-badge ${siblingIsExplored ? "ei-cyp-explored-badge--yes" : "ei-cyp-explored-badge--no"}`}>
                      {siblingIsExplored ? "\u2713 explored" : "\u25cb unexplored"}
                    </span>
                  </div>
                  <div className={`ei-cyp-card__preview${sibIsLong && !sibIsExpanded ? " ei-cyp-card__preview--collapsed" : ""}`}>
                    <MarkdownContent content={sibText} />
                  </div>
                  {sibIsLong && (
                    <button
                      className="ei-cyp-card__expand"
                      onClick={() => toggleCardExpand(sibling.id)}
                    >
                      {sibIsExpanded ? "▲ Show less" : "▼ Show more"}
                    </button>
                  )}
                  <button
                    className={`ei-btn ei-btn--sm ${isCurrent ? "ei-btn--secondary" : "ei-btn--primary"}`}
                    onClick={() => {
                      if (isCurrent) {
                        setNavPickerMessageId(null);
                      } else {
                        onSelectCYPBranch(sibling.id);
                        setNavPickerMessageId(null);
                      }
                    }}
                  >
                    {isCurrent ? "Current path" : siblingIsExplored ? "Return to this path" : "Choose this path"}
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
    const text = buildRoomMessageText(msg, room?.judge_persona_id);
    const isLong = text.length > EXPAND_THRESHOLD;
    const isExpanded = expandedCards.has(msg.id);
    const isExplored = allRoomMessages.some(m => m.parent_id === msg.id);

    return (
      <div key={msg.id} className={`ei-cyp-card${isHuman ? " ei-cyp-card--human" : ""}`}>
        <div className="ei-cyp-card__header">
          <PersonaAvatar
            personaId={msg.persona_id ?? "human"}
            displayName={name}
            avatarEmoji={persona?.avatar_emoji}
            avatarImage={persona?.avatar_image}
            size={20}
            className="ei-cyp-card__avatar"
          />
          <span className="ei-cyp-card__name">{name}</span>
          {(
            <span className={`ei-cyp-explored-badge ${isExplored ? "ei-cyp-explored-badge--yes" : "ei-cyp-explored-badge--no"}`}>
              {isExplored ? "\u2713 explored" : "\u25cb unexplored"}
            </span>
          )}
        </div>
        <div className={`ei-cyp-card__preview${isLong && !isExpanded ? " ei-cyp-card__preview--collapsed" : ""}`}>
          <MarkdownContent content={text} />
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
          {isExplored ? "Resume path" : "Choose"}
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
      {isCYP ? (
        <div className="ei-room-chat-panel__messages" ref={cypContainerRef} style={{ height: "100%", overflow: "auto" }}>
          {displayMessages.length === 0 ? (
            <div className="ei-room-chat-panel__empty">
              {activeRoomId ? "No messages yet. The room is waiting\u2026" : "Select a room to start chatting"}
            </div>
          ) : (
            displayMessages.map(renderMessage)
          )}

          {isGathering && pendingPersonaCount > 0 && (
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
              {statusText && <span className="ei-room-status__text">{statusText}</span>}
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
      ) : (
        <>
        <div className="ei-room-chat-panel__messages" ref={scrollRef} style={{ height: "100%", overflow: "auto" }}>
          {displayMessages.length === 0 ? (
            <div className="ei-room-chat-panel__empty">
              {activeRoomId ? "No messages yet. The room is waiting\u2026" : "Select a room to start chatting"}
            </div>
          ) : (
            <div
              ref={contentRef}
              style={{ height: `${rowVirtualizer.getTotalSize()}px`, position: "relative", flexShrink: 0 }}
            >
              {rowVirtualizer.getVirtualItems().map((virtualRow) => {
                const msg = displayMessages[virtualRow.index];
                return (
                  <div
                    key={msg.id}
                    data-index={virtualRow.index}
                    ref={rowVirtualizer.measureElement}
                    style={{
                      position: "absolute",
                      top: 0,
                      left: 0,
                      width: "100%",
                      transform: `translateY(${virtualRow.start}px)`,
                    }}
                  >
                    {renderMessage(msg)}
                  </div>
                );
              })}
            </div>
          )}

          {isGathering && pendingPersonaCount > 0 && (
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
                {ffaPendingCount} persona{ffaPendingCount !== 1 ? "s" : ""} responding…
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
        </div>
        {!isAtBottom && (
          <button
            className="ei-scroll-to-bottom"
            onClick={() => scrollToBottom()}
          >
            ↓ Latest
          </button>
        )}
        </>
      )}
      </div>

      <div className="ei-input-area">
        {(onCapture || (onShowOverview && room)) && (
          <div className="ei-input-area__controls">
            {onCapture && (
              <Tooltip text="Extract data from current conversation">
                <button
                  className="ei-boundary-btn"
                  onClick={onCapture}
                >
                  💡
                </button>
              </Tooltip>
            )}
            {onShowOverview && room && (
              <Tooltip text="Room conversation overview">
                <button
                  className="ei-boundary-btn"
                  onClick={onShowOverview}
                >
                  🗺
                </button>
              </Tooltip>
            )}
          </div>
        )}
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
});
