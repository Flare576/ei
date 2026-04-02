import { useRef, useEffect, useCallback, useState, useMemo, forwardRef, useImperativeHandle } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useStickToBottom } from "use-stick-to-bottom";
import type { Message, Quote } from "../../../../src/core/types";
import type { GenerationResult } from "../../comfyui";
import { MarkdownContent } from "../Chat";

function buildMessageDisplayText(message: Message): string {
  if (message.silence_reason !== undefined) return "";
  const parts: string[] = [];
  if (message.action_response) parts.push(`_${message.action_response}_`);
  if (message.verbal_response) parts.push(message.verbal_response);
  return parts.join('\n\n');
}

function renderMessageContent(
  message: Message,
  quotes: Quote[],
  activePersonaDisplayName: string | null
): React.ReactNode {
  // Silence-reason messages get muted rendering
  if (message.silence_reason !== undefined) {
    const label = message.role === "human" ? "You" : (activePersonaDisplayName ?? "Persona");
    return (
      <span className="silence-reason">
        [{label} chose not to respond because: {message.silence_reason}]
      </span>
    );
  }

  const displayText = buildMessageDisplayText(message);

  const messageQuotes = quotes
    .filter(q => q.message_id === message.id && q.start !== null && q.end !== null)
    .sort((a, b) => a.start! - b.start!);
  
  if (messageQuotes.length === 0) {
    return <MarkdownContent content={displayText} />;
  }
  
  const segments: string[] = [];
  let cursor = 0;
  
  for (const quote of messageQuotes) {
    if (quote.start! < cursor) continue;
    
    if (quote.start! > cursor) {
      segments.push(displayText.slice(cursor, quote.start!));
    }
    
    const quotedText = displayText.slice(quote.start!, quote.end!);
    segments.push(`<span class="ei-quote-highlight" data-quote-id="${quote.id}">${quotedText}</span>`);
    cursor = quote.end!;
  }
  
  if (cursor < displayText.length) {
    segments.push(displayText.slice(cursor));
  }
  
  return <MarkdownContent content={segments.join("")} />;
}

interface ChatPanelProps {
  activePersonaId: string | null;
  activePersonaDisplayName: string | null;
  messages: Message[];
  inputValue: string;
  isProcessing: boolean;
  contextBoundary?: string;
  quotes?: Quote[];
  onInputChange: (value: string) => void;
  onSendMessage: (content: string | null, silenceReason?: string) => void;
  onMarkMessageRead?: (messageId: string) => void;
  onRecallPending?: () => void;
  onSetContextBoundary?: (timestamp: string | null) => void;
  onQuoteClick?: (quote: Quote) => void;
  onScissorsClick?: (message: Message) => void;
  onImageGenerate?: (message: Message) => void;
  messageImages?: Record<string, {blobUrl: string, result: GenerationResult}>;
  generatingImageFor?: string | null;
  imageErrors?: Record<string, string>;
  onImageClick?: (messageId: string) => void;
  onImagePromptClick?: () => void;
  onCapture?: () => void;
}

export interface ChatPanelHandle {
  focusInput: () => void;
  scrollChat: (direction: "up" | "down") => void;
}

export const ChatPanel = forwardRef<ChatPanelHandle, ChatPanelProps>(function ChatPanel({
  activePersonaId,
  activePersonaDisplayName,
  messages,
  inputValue,
  isProcessing,
  contextBoundary,
  quotes = [],
  onInputChange,
  onSendMessage,
  onMarkMessageRead,
  onRecallPending,
  onSetContextBoundary,
  onQuoteClick,
  onScissorsClick,
  onImageGenerate,
  messageImages = {},
  generatingImageFor,
  imageErrors = {},
  onImageClick,
  onImagePromptClick,
  onCapture,
}, ref) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const { scrollRef, contentRef, isAtBottom, scrollToBottom } = useStickToBottom({ initial: 'instant', resize: 'instant' });

  const hasPendingMessages = messages.some(m => m.role === "human" && !m.read);

  const lastMessage = messages[messages.length - 1];
  const boundaryIsActive = contextBoundary && 
    (!lastMessage || contextBoundary > lastMessage.timestamp);
  
  const handleBoundaryToggle = () => {
    if (!onSetContextBoundary) return;
    if (boundaryIsActive) {
      onSetContextBoundary(null);
    } else {
      onSetContextBoundary(new Date().toISOString());
      setTimeout(() => scrollToBottom(), 50);
    }
  };

  const messageHeights = useMemo(() => messages.map(msg => {
    const text = [msg.verbal_response, msg.action_response].filter(Boolean).join('\n\n');
    if (!text) return 60;
    const charsPerLine = 70;
    const lineHeight = 20;
    const headerHeight = 40;
    const lines = Math.max(1, Math.ceil(text.length / charsPerLine));
    let height = lines * lineHeight + headerHeight;
    if (text.includes('```')) height += 120;
    return height;
  }), [messages]);

  const boundaryMessageIndex = useMemo(() => {
    if (!contextBoundary) return -1;
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].timestamp < contextBoundary) return i;
    }
    return -1;
  }, [messages, contextBoundary]);

  const rowVirtualizer = useVirtualizer({
    count: messages.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (i) => messageHeights[i] ?? 80,
    overscan: 5,
  });

  useImperativeHandle(ref, () => ({
    focusInput: () => {
      textareaRef.current?.focus();
    },
    scrollChat: (direction) => {
      const container = scrollRef.current;
      if (!container) return;
      const scrollAmount = container.clientHeight * 0.8;
      container.scrollBy({
        top: direction === "up" ? -scrollAmount : scrollAmount,
        behavior: "smooth",
      });
    },
  }));

  const [isSilentMode, setIsSilentMode] = useState(false);
  const [showSendDropdown, setShowSendDropdown] = useState(false);

  useEffect(() => {
    if (!activePersonaId || !onMarkMessageRead) return;
    const timer = setTimeout(() => {
      messages.forEach(msg => {
        if (msg.role === "system" && !msg.read) {
          onMarkMessageRead(msg.id);
        }
      });
    }, 2000);
    return () => clearTimeout(timer);
  }, [activePersonaId, messages.length, onMarkMessageRead, messages]);

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

  const adjustTextareaHeight = useCallback(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    
    textarea.style.height = "auto";
    const maxHeight = window.innerHeight * 0.33;
    const newHeight = Math.min(textarea.scrollHeight, maxHeight);
    textarea.style.height = `${newHeight}px`;
  }, []);

  useEffect(() => {
    adjustTextareaHeight();
  }, [inputValue, adjustTextareaHeight]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (isSilentMode) {
        onSendMessage(null, inputValue.trim() || undefined);
        setIsSilentMode(false);
      } else {
        onSendMessage(inputValue, undefined);
      }
    }
    if (e.key === "c" && e.ctrlKey) {
      e.preventDefault();
      onInputChange("");
    }
    if (e.key === "ArrowUp" && hasPendingMessages && onRecallPending) {
      const textarea = textareaRef.current;
      if (textarea && textarea.selectionStart === 0 && textarea.selectionEnd === 0) {
        e.preventDefault();
        onRecallPending();
      }
    }
  };

  const handleMessageClick = (msg: Message) => {
    if (msg.role === "system" && !msg.read && onMarkMessageRead) {
      onMarkMessageRead(msg.id);
    }
    if (msg.role === "human" && !msg.read && onRecallPending) {
      onRecallPending();
    }
  };

  const handleBubbleClick = (e: React.MouseEvent) => {
    if (!onQuoteClick) return;
    const target = e.target as HTMLElement;
    const quoteSpan = target.closest("[data-quote-id]") as HTMLElement | null;
    if (quoteSpan) {
      const quoteId = quoteSpan.dataset.quoteId;
      const quote = quotes.find(q => q.id === quoteId);
      if (quote) {
        e.stopPropagation();
        onQuoteClick(quote);
      }
    }
  };

  const formatTime = (timestamp: string) => {
    return new Date(timestamp).toLocaleTimeString([], { 
      hour: "2-digit", 
      minute: "2-digit" 
    });
  };

  const getMessageClasses = (msg: Message) => {
    const classes = ["ei-message", msg.role];
    if (msg.role === "human" && !msg.read) {
      classes.push("pending");
    }
    if (msg.role === "system" && !msg.read) {
      classes.push("unread");
    }
    if (msg._synthesis) {
      classes.push("silence-reason");
    }
    return classes.join(" ");
  };

  const isClickable = (msg: Message) => {
    if (msg.role === "system" && !msg.read) return true;
    if (msg.role === "human" && !msg.read) return true;
    return false;
  };

  return (
    <div className="ei-chat-panel">
      <div className="ei-chat-panel__header">
        <h2 className="ei-chat-panel__title">
          {activePersonaDisplayName ? `Chat with ${activePersonaDisplayName}` : "Chat"}
        </h2>
      </div>

      <div style={{ position: "relative", flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <div className="ei-chat-panel__messages" ref={scrollRef} style={{ height: "100%", overflow: "auto" }}>
        {messages.length === 0 ? (
          <div className="ei-chat-panel__empty">
            {activePersonaId 
              ? "No messages yet. Say hello!" 
              : "Select a persona to start chatting"}
          </div>
        ) : (
          <div
            ref={contentRef}
            style={{ height: `${rowVirtualizer.getTotalSize()}px`, position: "relative" }}
          >
            {rowVirtualizer.getVirtualItems().map((virtualRow) => {
              const msg = messages[virtualRow.index];
              const showBoundaryMarker = virtualRow.index === boundaryMessageIndex;

              const scissorsButton = (
                <button 
                  className="ei-message__scissors"
                  onClick={(e) => {
                    e.stopPropagation();
                    onScissorsClick?.(msg);
                  }}
                  title="Capture a quote"
                >
                  ✂️
                </button>
              );
              
              const getImageButtonIcon = (messageId: string) => {
                if (generatingImageFor === messageId) return "⏳";
                if (imageErrors[messageId]) return "❗";
                if (messageImages[messageId]) return "🎨";
                return "🖼️";
              };
              
              const getImageButtonTitle = (messageId: string) => {
                if (generatingImageFor === messageId) return "Generating image...";
                if (imageErrors[messageId]) return `Error: ${imageErrors[messageId]}`;
                if (messageImages[messageId]) return "View or regenerate image";
                return "Generate image from this message";
              };
              
              const imageButton = onImageGenerate && (
                <button 
                  className="ei-message__image"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (imageErrors[msg.id]) {
                      onImageClick?.(msg.id);
                    } else if (messageImages[msg.id]) {
                      onImageClick?.(msg.id);
                    } else if (!generatingImageFor) {
                      onImageGenerate(msg);
                    }
                  }}
                  title={getImageButtonTitle(msg.id)}
                  disabled={generatingImageFor === msg.id}
                >
                  {getImageButtonIcon(msg.id)}
                </button>
              );

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
                  <div className={`ei-message-wrapper ${msg.role}`}>
                    {showBoundaryMarker && (
                      <div className="ei-context-divider">
                        <span>New conversation started</span>
                      </div>
                    )}
                    <div 
                      data-message-id={msg.id}
                      className={getMessageClasses(msg)}
                      onClick={() => handleMessageClick(msg)}
                      style={{ cursor: isClickable(msg) ? "pointer" : undefined }}
                    >
                      {msg.role === "human" && (
                        <>
                          {scissorsButton}
                          {imageButton}
                        </>
                      )}
                      <div className="ei-message__bubble" onClick={handleBubbleClick}>
                        {msg._synthesis ? (
                          <div 
                            className="silence-reason" 
                            onClick={(e) => {
                              e.stopPropagation();
                              onImageClick?.(msg.id);
                            }}
                            style={{ cursor: 'pointer' }}
                            title="Click to edit and regenerate"
                          >
                            {msg.verbal_response}
                          </div>
                        ) : (
                          renderMessageContent(msg, quotes, activePersonaDisplayName)
                        )}
                      </div>
                      {messageImages[msg.id] && (
                        <div 
                          className="ei-message__inline-image" 
                          onClick={(e) => {
                            e.stopPropagation();
                            onImageClick?.(msg.id);
                          }}
                          title="Click to view full size"
                        >
                          <img 
                            src={messageImages[msg.id]?.blobUrl}
                            alt="Generated from message"
                            className="ei-message__inline-image-img"
                          />
                        </div>
                      )}
                      {msg.role === "system" && (
                        <>
                          {scissorsButton}
                          {imageButton}
                        </>
                      )}
                      <div className="ei-message__time">
                        {formatTime(msg.timestamp)}
                        {msg.role === "human" && !msg.read && (
                          <span className="ei-message__status"> (pending)</span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
        {contextBoundary && messages.length > 0 && messages[messages.length - 1].timestamp < contextBoundary && (
          <div className="ei-context-divider">
            <span>New conversation started</span>
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
      </div>

      <div className="ei-input-area">
        {activePersonaId && onSetContextBoundary && (
          <div className="ei-input-area__controls">
            <button 
              className="ei-boundary-btn"
              onClick={handleBoundaryToggle}
              title={boundaryIsActive ? "Resume previous conversation context" : "Start new conversation context"}
              disabled={messages.length === 0 && !boundaryIsActive}
            >
              {boundaryIsActive ? "↩" : "✦"}
            </button>
            {onImagePromptClick && (
              <button
                className="ei-boundary-btn ei-image-prompt-btn"
                onClick={onImagePromptClick}
                title="Generate image from selected messages"
              >
                🖼️
              </button>
            )}
            {onCapture && (
              <button
                className="ei-boundary-btn ei-capture-btn"
                onClick={onCapture}
                title="Extract data from current conversation"
              >
                💡
              </button>
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
            !activePersonaId
              ? "Select a persona first"
              : isSilentMode
              ? "Silence reason (optional)\u2026"
              : hasPendingMessages
              ? "Type a message... (Up arrow to recall pending)"
              : "Type a message... (Enter to send, Shift+Enter for newline)"
          }
          disabled={!activePersonaId}
          rows={1}
        />
        <div className="ei-room-send-group" ref={dropdownRef}>
          <button
            className="ei-room-send-group__main"
            onClick={() => {
              if (isSilentMode) {
                onSendMessage(null, inputValue.trim() || undefined);
                setIsSilentMode(false);
              } else {
                onSendMessage(inputValue, undefined);
              }
            }}
            disabled={!activePersonaId || (!isSilentMode && !inputValue.trim()) || isProcessing}
          >
            {isSilentMode ? "Silent" : "Send"}
          </button>
          <button
            className="ei-room-send-group__dropdown-toggle"
            onClick={() => setShowSendDropdown(v => !v)}
            disabled={!activePersonaId}
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
