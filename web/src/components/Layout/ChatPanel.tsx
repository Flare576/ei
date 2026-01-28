import { useRef, useEffect, useCallback, forwardRef, useImperativeHandle } from "react";
import type { Message } from "../../../../src/core/types";
import { MarkdownContent } from "../Chat";

interface ChatPanelProps {
  activePersona: string | null;
  messages: Message[];
  inputValue: string;
  isProcessing: boolean;
  onInputChange: (value: string) => void;
  onSendMessage: () => void;
  onMarkMessageRead?: (messageId: string) => void;
  onRecallPending?: () => void;
}

export interface ChatPanelHandle {
  focusInput: () => void;
  scrollChat: (direction: "up" | "down") => void;
}

export const ChatPanel = forwardRef<ChatPanelHandle, ChatPanelProps>(function ChatPanel({
  activePersona,
  messages,
  inputValue,
  isProcessing,
  onInputChange,
  onSendMessage,
  onMarkMessageRead,
  onRecallPending,
}, ref) {
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const observerRef = useRef<IntersectionObserver | null>(null);

  const hasPendingMessages = messages.some(m => m.role === "human" && !m.read);

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
          {activePersona ? `Chat with ${activePersona}` : "Chat"}
        </h2>
        {hasPendingMessages && (
          <button 
            className="ei-btn ei-btn--secondary ei-recall-btn"
            onClick={onRecallPending}
            title="Recall pending messages (Up arrow)"
          >
            Recall
          </button>
        )}
      </div>

      <div className="ei-chat-panel__messages" ref={messagesContainerRef}>
        {messages.length === 0 ? (
          <div className="ei-chat-panel__empty">
            {activePersona 
              ? "No messages yet. Say hello!" 
              : "Select a persona to start chatting"}
          </div>
        ) : (
          messages.map((msg) => (
            <div 
              key={msg.id}
              data-message-id={msg.id}
              className={getMessageClasses(msg)}
              onClick={() => handleMessageClick(msg)}
              style={{ cursor: isClickable(msg) ? "pointer" : undefined }}
            >
              <div className="ei-message__bubble">
                <MarkdownContent content={msg.content} />
              </div>
              <div className="ei-message__time">
                {formatTime(msg.timestamp)}
                {msg.role === "human" && !msg.read && (
                  <span className="ei-message__status"> (pending)</span>
                )}
              </div>
            </div>
          ))
        )}
        <div ref={messagesEndRef} />
      </div>

      <div className="ei-input-area">
        <textarea
          ref={textareaRef}
          className="ei-input-area__textarea"
          value={inputValue}
          onChange={(e) => onInputChange(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={activePersona 
            ? hasPendingMessages 
              ? "Type a message... (Up arrow to recall pending)" 
              : "Type a message... (Enter to send, Shift+Enter for newline)"
            : "Select a persona first"}
          disabled={!activePersona}
          rows={1}
        />
        <button
          className="ei-input-area__send"
          onClick={onSendMessage}
          disabled={!activePersona || !inputValue.trim() || isProcessing}
        >
          Send
        </button>
      </div>
    </div>
  );
});
