import { useKeyboard } from "@opentui/solid";
import { For, createSignal, createMemo } from "solid-js";
import type { KeyEvent } from "@opentui/core";
import type { Quote } from "../../../src/core/types.js";

interface QuotesOverlayProps {
  quotes: Quote[];
  messageIndex: number;
  onClose: () => void;
  onEdit: () => Promise<void>;
  onDelete: (quoteId: string) => Promise<void>;
}

export function QuotesOverlay(props: QuotesOverlayProps) {
  const [selectedIndex, setSelectedIndex] = createSignal(0);
  const [confirmDelete, setConfirmDelete] = createSignal(false);

  createMemo(() => {
    if (selectedIndex() >= props.quotes.length) {
      setSelectedIndex(Math.max(0, props.quotes.length - 1));
    }
  });

  useKeyboard((event: KeyEvent) => {
    const key = event.name;
    const listLength = props.quotes.length;

    if (confirmDelete()) {
      event.preventDefault();
      if (key === "y") {
        const quote = props.quotes[selectedIndex()];
        if (quote) {
          void props.onDelete(quote.id);
        }
        setConfirmDelete(false);
        if (props.quotes.length <= 1) {
          props.onClose();
        }
      } else if (key === "n" || key === "escape") {
        setConfirmDelete(false);
      }
      return;
    }

    if (key === "j" || key === "down") {
      event.preventDefault();
      setSelectedIndex((prev) => Math.min(prev + 1, listLength - 1));
      return;
    }

    if (key === "k" || key === "up") {
      event.preventDefault();
      setSelectedIndex((prev) => Math.max(prev - 1, 0));
      return;
    }

    if (key === "e") {
      event.preventDefault();
      void props.onEdit();
      return;
    }

    if (key === "d") {
      event.preventDefault();
      if (listLength > 0) {
        setConfirmDelete(true);
      }
      return;
    }

    if (key === "escape") {
      event.preventDefault();
      props.onClose();
      return;
    }
  });

  const truncateText = (text: string, maxLen: number = 60): string => {
    const singleLine = text.replace(/\n/g, " ").trim();
    return singleLine.length > maxLen ? singleLine.slice(0, maxLen - 3) + "..." : singleLine;
  };

  const formatTimestamp = (timestamp: string): string => {
    const date = new Date(timestamp);
    return date.toLocaleDateString() + " " + date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  };

  return (
    <box
      position="absolute"
      width="100%"
      height="100%"
      left={0}
      top={0}
      backgroundColor="#000000"
      alignItems="center"
      justifyContent="center"
    >
      <box
        width={70}
        height="70%"
        backgroundColor="#1a1a2e"
        borderStyle="single"
        borderColor="#586e75"
        padding={2}
        flexDirection="column"
      >
        <text fg="#eee8d5" marginBottom={1}>
          Quotes from message [{props.messageIndex}]
        </text>

        <box visible={props.quotes.length === 0}>
          <text fg="#586e75">No quotes in this message</text>
        </box>

        <scrollbox height="100%" visible={props.quotes.length > 0}>
          <For each={props.quotes}>
            {(quote, index) => {
              const isSelected = () => selectedIndex() === index();
              const displayText = truncateText(quote.text);
              const speaker = quote.speaker === "human" ? "You" : quote.speaker;

              return (
                <box
                  backgroundColor={isSelected() ? "#2d3748" : "transparent"}
                  paddingLeft={1}
                  paddingRight={1}
                  marginBottom={1}
                  flexDirection="column"
                >
                  <text fg={isSelected() ? "#b58900" : "#839496"}>
                    {isSelected() ? "▶ " : "  "}{speaker} ({formatTimestamp(quote.timestamp)})
                  </text>
                  <text fg={isSelected() ? "#eee8d5" : "#93a1a1"} marginLeft={2}>
                    "{displayText}"
                  </text>
                </box>
              );
            }}
          </For>
        </scrollbox>

        <text> </text>

        <box visible={confirmDelete()}>
          <text fg="#dc322f">Delete this quote? (y/N)</text>
        </box>

        <box visible={!confirmDelete()}>
          <text fg="#586e75">
            j/k: navigate | e: edit in $EDITOR | d: delete | Esc: close
          </text>
        </box>
      </box>
    </box>
  );
}
