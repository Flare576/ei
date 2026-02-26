import { useRef, useEffect, useCallback, forwardRef, useImperativeHandle } from "react";
import type { Message, Quote } from "../../../../src/core/types";
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
    const label = activePersonaDisplayName ?? "Persona";
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
  onSendMessage: () => void;
  onMarkMessageRead?: (messageId: string) => void;
  onRecallPending?: () => void;
  onSetContextBoundary?: (timestamp: string | null) => void;
  onQuoteClick?: (quote: Quote) => void;
  onScissorsClick?: (message: Message) => void;
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
}, ref) {
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const observerRef = useRef<IntersectionObserver | null>(null);

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
    }
  };

  useImperativeHandle(ref, () => ({
    focusInput: () => {
      textareaRef.current?.focus();
    },
    scrollChat: (direction) => {
      const container = messagesContainerRef.current;
      if (!container) return;
      const scrollAmount = container.clientHeight * 0.8;
      container.scrollBy({
        top: direction === "up" ? -scrollAmount : scrollAmount,
        behavior: "smooth",
      });
    },
  }));

  const scrollToBottom = useCallback(() => {
    const container = messagesContainerRef.current;
    if (container) {
      container.scrollTop = container.scrollHeight;
    }
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
    if (!onMarkMessageRead || !messagesContainerRef.current) return;

    observerRef.current = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            const messageId = entry.target.getAttribute("data-message-id");
            const isUnread = entry.target.classList.contains("unread");
            const isSystemMessage = entry.target.classList.contains("system");
            
            if (messageId && isUnread && isSystemMessage) {
              onMarkMessageRead(messageId);
            }
          }
        });
      },
      { root: messagesContainerRef.current, threshold: 0.5 }
    );

    const messageElements = messagesContainerRef.current.querySelectorAll(".ei-message");
    messageElements.forEach((el) => observerRef.current?.observe(el));

    return () => {
      observerRef.current?.disconnect();
    };
  }, [messages, onMarkMessageRead]);

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
      onSendMessage();
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

      <div className="ei-chat-panel__messages" ref={messagesContainerRef}>
        {messages.length === 0 ? (
          <div className="ei-chat-panel__empty">
            {activePersonaId 
              ? "No messages yet. Say hello!" 
              : "Select a persona to start chatting"}
          </div>
        ) : (
          messages.map((msg, index) => {
            const showDivider = contextBoundary && 
              index > 0 && 
              messages[index - 1].timestamp < contextBoundary && 
              msg.timestamp >= contextBoundary;
            
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
            
            return (
              <div key={msg.id} className={`ei-message-wrapper ${msg.role}`}>
                {showDivider && (
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
                  {msg.role === "human" && scissorsButton}
                  <div className="ei-message__bubble" onClick={handleBubbleClick}>
                    {renderMessageContent(msg, quotes, activePersonaDisplayName)}
                  </div>
                  {msg.role === "system" && scissorsButton}
                  <div className="ei-message__time">
                    {formatTime(msg.timestamp)}
                    {msg.role === "human" && !msg.read && (
                      <span className="ei-message__status"> (pending)</span>
                    )}
                  </div>
                </div>
              </div>
            );
          })
        )}
        {contextBoundary && messages.length > 0 && messages[messages.length - 1].timestamp < contextBoundary && (
          <div className="ei-context-divider">
            <span>New conversation started</span>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      <div className="ei-input-area">
        {activePersonaId && onSetContextBoundary && (
          <button 
            className="ei-boundary-btn"
            onClick={handleBoundaryToggle}
            title={boundaryIsActive ? "Resume previous conversation context" : "Start new conversation context"}
          >
            {boundaryIsActive ? "↩" : "✦"}
          </button>
        )}
        <textarea
          ref={textareaRef}
          className="ei-input-area__textarea"
          value={inputValue}
          onChange={(e) => onInputChange(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={activePersonaId 
            ? hasPendingMessages 
              ? "Type a message... (Up arrow to recall pending)" 
              : "Type a message... (Enter to send, Shift+Enter for newline)"
            : "Select a persona first"}
          disabled={!activePersonaId}
          rows={1}
        />
        <button
          className="ei-input-area__send"
          onClick={onSendMessage}
          disabled={!activePersonaId || !inputValue.trim() || isProcessing}
        >
          Send
        </button>
      </div>
    </div>
  );
});
