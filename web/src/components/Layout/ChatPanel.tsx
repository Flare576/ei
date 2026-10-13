import { useRef, useEffect, useLayoutEffect, useCallback, useState, useMemo, forwardRef, useImperativeHandle } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useStickToBottom } from "use-stick-to-bottom";
import { TOOLS_RAN_NO_REPLY_SILENCE_REASON, type Message, type Quote } from "../../../../src/core/types";
import type { ThemeDefinition } from "../../../../src/core/types/entities.js";
import type { GenerationResult } from "../../comfyui";
import { MarkdownContent } from "../Chat";
import { Tooltip } from './Tooltip';
import { decodeTheme, themeToStyleString, isBuiltInTheme } from "../../../../src/core/utils/theme-codec.js";

function getContent(msg: { content?: string }): string {
  return msg.content ?? '';
}

/** Where a clicked message sat in the scroller, so its reply can be put back after rows change height. */
interface ToggleAnchor {
  index: number;
  messageId: string;
  /** Row top and reply top, in pixels below the top of the scroller. */
  rowOffset: number;
  replyOffset: number;
}

/** The reply is the last thing in the bubble; any thinking block comes before it. */
function replyElementOf(row: HTMLElement): Element {
  return row.querySelector(".ei-message__bubble")?.lastElementChild ?? row;
}

const USER_SCROLL_EVENTS = ["wheel", "touchstart", "pointerdown", "keydown"] as const;

/** Calls back once on the next input that can scroll the chat; returns a function that stops listening. */
function onNextUserScroll(callback: () => void): () => void {
  const stop = () => {
    for (const type of USER_SCROLL_EVENTS) window.removeEventListener(type, handle);
  };
  const handle = () => {
    stop();
    callback();
  };
  for (const type of USER_SCROLL_EVENTS) window.addEventListener(type, handle, { passive: true });
  return stop;
}

function getToolCallsButton(message: Message): { icon: string; label: string } | null {
  const toolCalls = message.tool_calls;
  if (!toolCalls || toolCalls.length === 0) return null;
  // A call that is not positively classified read-only is treated as a write.
  if (toolCalls.some(call => call.kind !== "read")) {
    return { icon: "🧧", label: "Show tool calls (includes write)" };
  }
  return { icon: "🔧", label: "Show tool calls (read only)" };
}

function buildMessageDisplayText(message: Message): string {
  if (message.silence_reason !== undefined) return "";
  return getContent(message);
}

function renderMessageContent(
  message: Message,
  quotes: Quote[],
  activePersonaDisplayName: string | null
): React.ReactNode {
  // Silence-reason messages get muted rendering
  if (message.silence_reason !== undefined) {
    const label = message.role === "human" ? "You" : (activePersonaDisplayName ?? "Persona");
    // A turn that ran tools and produced no text is not a choice to stay silent.
    if (message.silence_reason === TOOLS_RAN_NO_REPLY_SILENCE_REASON) {
      return (
        <span className="silence-reason">
          [{label} ran tools but sent no reply]
        </span>
      );
    }
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
  contextBoundary?: string;
  quotes?: Quote[];
  personaTheme?: string;
  customThemes?: ThemeDefinition[];
  onInputChange: (value: string) => void;
  onSendMessage: (content: string | null, silenceReason?: string) => void;
  onMarkMessageRead?: (messageId: string) => void;
  onRecallPending?: () => void;
  onSetContextBoundary?: (timestamp: string | null) => void;
  onQuoteClick?: (quote: Quote) => void;
  onScissorsClick?: (message: Message) => void;
  onToolCallsClick?: (message: Message) => void;
  showThinking?: boolean;
  /** False while the active persona's thinking setting has not loaded yet; the icon stays but its action is inert. */
  thinkingSettingKnown?: boolean;
  /** Persists the flipped setting; resolves true once it has been applied, false if it could not be. */
  onToggleThinking?: () => Promise<boolean>;
  onImageGenerate?: (message: Message) => void;
  messageImages?: Record<string, {blobUrl: string, result: GenerationResult}>;
  generatingImageFor?: string | null;
  imageErrors?: Record<string, string>;
  onImageClick?: (messageId: string) => void;
  onImagePromptClick?: () => void;
  onCapture?: () => void;
  onKnowledgeSearch?: () => void;
}

export interface ChatPanelHandle {
  focusInput: () => void;
  scrollChat: (direction: "up" | "down") => void;
  scrollToBottom: () => void;
}

export const ChatPanel = forwardRef<ChatPanelHandle, ChatPanelProps>(function ChatPanel({
  activePersonaId,
  activePersonaDisplayName,
  messages,
  inputValue,
  contextBoundary,
  quotes = [],
  personaTheme,
  customThemes = [],
  onInputChange,
  onSendMessage,
  onMarkMessageRead,
  onRecallPending,
  onSetContextBoundary,
  onQuoteClick,
  onScissorsClick,
  onToolCallsClick,
  showThinking = true,
  thinkingSettingKnown = true,
  onToggleThinking,
  onImageGenerate,
  messageImages = {},
  generatingImageFor,
  imageErrors = {},
  onImageClick,
  onImagePromptClick,
  onCapture,
  onKnowledgeSearch,
}, ref) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const { scrollRef, contentRef, isAtBottom, scrollToBottom, stopScroll } = useStickToBottom({
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

  // use-stick-to-bottom only observes contentRef for resize — it's blind to the scroll
  // container shrinking/growing when the textarea expands in a flex layout. When the
  // container grows (textarea shrank after send), re-assert bottom position if we're
  // within the library's own 70px threshold of the new bottom.
  const scrollToBottomRef = useRef(scrollToBottom);
  useEffect(() => { scrollToBottomRef.current = scrollToBottom; }, [scrollToBottom]);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    let prevClientHeight = el.clientHeight;
    const ro = new ResizeObserver(() => {
      const newClientHeight = el.clientHeight;
      if (newClientHeight > prevClientHeight) {
        const { scrollTop, scrollHeight } = el;
        if (scrollHeight - scrollTop - newClientHeight <= 70) {
          scrollToBottomRef.current();
        }
      }
      prevClientHeight = newClientHeight;
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []); // stable: scrollToBottom accessed via ref, scrollRef is a stable ref

  const hasPendingMessages = messages.some(m => m.role === "human" && !m.read);

  useEffect(() => {
    const styleId = 'ei-persona-chat-theme';
    document.getElementById(styleId)?.remove();
    if (!personaTheme || isBuiltInTheme(personaTheme)) return;
    const custom = customThemes.find(t => t.id === personaTheme);
    if (!custom) return;
    const tokens = decodeTheme(custom.encoded);
    if (!tokens) return;
    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = `.ei-chat-panel [data-persona-theme="${personaTheme}"] {\n${themeToStyleString(tokens)}\n}`;
    document.head.appendChild(style);
    return () => { document.getElementById(styleId)?.remove(); };
  }, [personaTheme, customThemes]);

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

  const messageHeights = useMemo(() => {
    const charsPerLine = containerWidth > 0 ? Math.floor(containerWidth / 7.5) : 70;
    return messages.map(msg => {
      const text = getContent(msg);
      let height = 60;
      if (text) {
        const lines = Math.max(1, Math.ceil(text.length / charsPerLine));
        height = lines * 20 + 40;
        if (text.includes('```')) height += 120;
      }
      if (showThinking && msg.thinking) {
        const thinkingLines = msg.thinking
          .split("\n")
          .reduce((sum, line) => sum + Math.max(1, Math.ceil(line.length / charsPerLine)), 0);
        height += thinkingLines * 20 + 8;
      }
      return height;
    });
  }, [messages, containerWidth, showThinking]);

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
    enabled: messages.length > 0,
    initialOffset: () => {
      if (!scrollRef.current) return 0;
      const totalHeight = messageHeights.reduce((sum, h) => sum + h, 0);
      return Math.max(0, totalHeight - scrollRef.current.clientHeight + 32);
    },
  });

  // The thinking toggle changes the height of every row that has thinking at once. The virtualizer
  // caches the size it measured for each row, so drop that cache when the setting flips. When the
  // flip was caused by clicking a message's icon, keep that message's reply where it was on screen.
  const thinkingToggleAnchorRef = useRef<{ anchor: ToggleAnchor; release: () => void } | null>(null);
  const pendingAnchorRestoreRef = useRef<ToggleAnchor | null>(null);
  const stopAnchorCorrectionRef = useRef<(() => void) | null>(null);
  const previousShowThinkingRef = useRef(showThinking);

  const dropThinkingToggleAnchor = () => {
    thinkingToggleAnchorRef.current?.release();
    thinkingToggleAnchorRef.current = null;
  };

  // The anchor belongs to the one toggle the click started: it is dropped if that toggle fails or the
  // reader scrolls first, so a later change to the setting (editor, import) never reuses it.
  const armThinkingToggleAnchor = (icon: HTMLElement, index: number, messageId: string) => {
    dropThinkingToggleAnchor();
    const scroller = scrollRef.current;
    const row = icon.closest<HTMLElement>("[data-index]");
    if (!scroller || !row) return null;
    const scrollerTop = scroller.getBoundingClientRect().top;
    const armed = {
      anchor: {
        index,
        messageId,
        rowOffset: row.getBoundingClientRect().top - scrollerTop,
        replyOffset: replyElementOf(row).getBoundingClientRect().top - scrollerTop,
      },
      release: onNextUserScroll(() => {
        if (thinkingToggleAnchorRef.current === armed) thinkingToggleAnchorRef.current = null;
      }),
    };
    thinkingToggleAnchorRef.current = armed;
    return armed;
  };

  useLayoutEffect(() => {
    if (previousShowThinkingRef.current === showThinking) return;
    previousShowThinkingRef.current = showThinking;
    pendingAnchorRestoreRef.current = thinkingToggleAnchorRef.current?.anchor ?? null;
    dropThinkingToggleAnchor();
    rowVirtualizer.measure();
  }, [showThinking]);

  // Scrolling is only reliable once the list has re-rendered at its new total height, otherwise the
  // browser clamps the target to the old, shorter content. Rows keep being measured for a few frames
  // after that (and the virtualizer shifts the scroll position to compensate), so the reply is nudged
  // back to its recorded position until it stops moving, unless the reader scrolls first.
  useLayoutEffect(() => {
    const anchor = pendingAnchorRestoreRef.current;
    if (!anchor) return;
    if (parseFloat(contentRef.current?.style.height ?? "") !== rowVirtualizer.getTotalSize()) return;
    pendingAnchorRestoreRef.current = null;
    const scroller = scrollRef.current;
    if (!scroller || messages[anchor.index]?.id !== anchor.messageId) return;

    stopAnchorCorrectionRef.current?.();
    // Hold the clicked row in place even when the list was pinned to the bottom.
    stopScroll();
    let frameId = 0;
    let stopWatching = () => {};
    const finish = () => {
      cancelAnimationFrame(frameId);
      stopWatching();
      if (stopAnchorCorrectionRef.current === finish) stopAnchorCorrectionRef.current = null;
    };
    stopWatching = onNextUserScroll(finish);
    stopAnchorCorrectionRef.current = finish;

    let frames = 0;
    let calmFrames = 0;
    const correct = () => {
      const row = scroller.querySelector<HTMLElement>(`[data-index="${anchor.index}"]`);
      let delta = 0;
      if (row) {
        delta = replyElementOf(row).getBoundingClientRect().top - scroller.getBoundingClientRect().top - anchor.replyOffset;
      } else {
        const start = rowVirtualizer.getOffsetForIndex(anchor.index, "start")?.[0];
        if (start !== undefined) delta = start - anchor.rowOffset - scroller.scrollTop;
      }
      const before = scroller.scrollTop;
      if (Math.abs(delta) > 1) rowVirtualizer.scrollToOffset(Math.max(0, before + delta));
      // Settled: on target, or at a scroll limit where the target cannot be reached.
      calmFrames = Math.abs(delta) <= 1 || scroller.scrollTop === before ? calmFrames + 1 : 0;
      frames += 1;
      if (calmFrames >= 10 || frames >= 120) finish();
      else frameId = requestAnimationFrame(correct);
    };
    correct();
  });

  useEffect(
    () => () => {
      stopAnchorCorrectionRef.current?.();
      thinkingToggleAnchorRef.current?.release();
    },
    [],
  );

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
    scrollToBottom: () => {
      scrollToBottom();
    },
  }));

  const [isSilentMode, setIsSilentMode] = useState(false);
  const [showSendDropdown, setShowSendDropdown] = useState(false);

  useEffect(() => {
    if (!activePersonaId || !onMarkMessageRead) return;
    if (!isAtBottom) return;
    const timer = setTimeout(() => {
      messages.forEach(msg => {
        if (msg.role === "system" && !msg.read) {
          onMarkMessageRead(msg.id);
        }
      });
    }, 2000);
    return () => clearTimeout(timer);
  }, [activePersonaId, messages.length, onMarkMessageRead, messages, isAtBottom]);

  const hasScrolledRef = useRef(false);
  useLayoutEffect(() => {
    if (messages.length === 0) {
      hasScrolledRef.current = false;
      return;
    }
    if (hasScrolledRef.current) return;
    hasScrolledRef.current = true;
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages.length]);

  // Keep a stable ref to isAtBottom so the effect below can read it without
  // adding it to deps (which would re-run on every scroll-to-bottom, not just new messages).
  const isAtBottomRef = useRef(isAtBottom);
  useLayoutEffect(() => { isAtBottomRef.current = isAtBottom; });

  // useStickToBottom's resize handler uses preserveScrollPosition=true, which gates on
  // isNearBottom at the moment the ResizeObserver fires. But the new message's estimated
  // height has already pushed scrollDiff > 70px by then, so it silently skips the scroll.
  // Explicit scroll here closes that gap.
  useEffect(() => {
    if (messages.length > 0 && hasScrolledRef.current && isAtBottomRef.current) {
      scrollToBottomRef.current();
    }
  }, [messages.length]);

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

      <div style={{ position: "relative", flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }} data-persona-theme={personaTheme || undefined}>
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
            style={{ height: `${rowVirtualizer.getTotalSize()}px`, position: "relative", flexShrink: 0 }}
          >
            {rowVirtualizer.getVirtualItems().map((virtualRow) => {
              const msg = messages[virtualRow.index];
              const showBoundaryMarker = virtualRow.index === boundaryMessageIndex;

              const scissorsButton = (
                <Tooltip text="Capture a quote">
                  <button 
                    className="ei-message__scissors"
                    onClick={(e) => {
                      e.stopPropagation();
                      onScissorsClick?.(msg);
                    }}
                  >
                    ✂️
                  </button>
                </Tooltip>
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
              
              const hasThinking = typeof msg.thinking === "string" && msg.thinking.length > 0;
              const thinkingButton = onToggleThinking && hasThinking && (
                <Tooltip text={!thinkingSettingKnown ? "Loading thinking setting…" : showThinking ? "Hide thinking" : "Show thinking"}>
                  <button
                    type="button"
                    className="ei-message__thinking-toggle"
                    disabled={!thinkingSettingKnown}
                    onClick={(e) => {
                      e.stopPropagation();
                      const armed = armThinkingToggleAnchor(e.currentTarget, virtualRow.index, msg.id);
                      void onToggleThinking().then((applied) => {
                        if (!applied && armed && thinkingToggleAnchorRef.current === armed) dropThinkingToggleAnchor();
                      });
                    }}
                  >
                    💭
                  </button>
                </Tooltip>
              );

              const toolCallsButtonSpec = onToolCallsClick ? getToolCallsButton(msg) : null;
              const toolCallsButton = toolCallsButtonSpec && (
                <Tooltip text={toolCallsButtonSpec.label}>
                  <button
                    type="button"
                    className="ei-message__tool-calls"
                    aria-label={toolCallsButtonSpec.label}
                    onClick={(e) => {
                      e.stopPropagation();
                      onToolCallsClick?.(msg);
                    }}
                  >
                    {toolCallsButtonSpec.icon}
                  </button>
                </Tooltip>
              );

              const imageButton = onImageGenerate && (
                <Tooltip text={getImageButtonTitle(msg.id)} disabled={generatingImageFor === msg.id}>
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
                    disabled={generatingImageFor === msg.id}
                  >
                    {getImageButtonIcon(msg.id)}
                  </button>
                </Tooltip>
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
                        {hasThinking && showThinking && (
                          <div className="ei-message__thinking">{msg.thinking}</div>
                        )}
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
                          {getContent(msg)}
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
                          {toolCallsButton}
                          {thinkingButton}
                        </>
                      )}
                      <div className="ei-message__time">
                        {formatTime(msg.timestamp)}
                        {msg.role === "human" && !msg.read && (
                          <span className="ei-message__status"> (pending)</span>
                        )}
                      </div>
                    </div>
                    {showBoundaryMarker && (
                      <div className="ei-context-divider">
                        <span>New conversation started</span>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
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

      <div className="ei-input-area">
        {activePersonaId && onSetContextBoundary && (
          <div className="ei-input-area__controls">
            <Tooltip text={boundaryIsActive ? "Resume previous conversation context" : "Start new conversation context"}>
              <button 
                className="ei-boundary-btn"
                onClick={handleBoundaryToggle}
                disabled={messages.length === 0 && !boundaryIsActive}
              >
                {boundaryIsActive ? "↩" : "✦"}
              </button>
            </Tooltip>
            {onImagePromptClick && (
              <Tooltip text="Synthesize image from selected messages">
                <button
                  className="ei-boundary-btn ei-image-prompt-btn"
                  onClick={onImagePromptClick}
                >
                  🎨
                </button>
              </Tooltip>
            )}
            {onCapture && (
              <Tooltip text="Extract data from current conversation" align="right">
                <button
                  className="ei-boundary-btn ei-capture-btn"
                  onClick={onCapture}
                >
                  💡
                </button>
              </Tooltip>
            )}
            {onKnowledgeSearch && (
              <Tooltip text="Search Ei's memory" align="right">
                <button
                  className="ei-boundary-btn ei-knowledge-btn"
                  onClick={onKnowledgeSearch}
                >
                  🔍
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
            disabled={!activePersonaId || (!isSilentMode && !inputValue.trim())}
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
    </div>
  );
});
