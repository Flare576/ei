import { useKeyboard } from "@opentui/solid";
import { For, createSignal, createMemo, onMount, onCleanup } from "solid-js";
import type { KeyEvent } from "@opentui/core";
import { useKeyboardNav } from "../context/keyboard.js";

export interface GeneratedDocItem {
  slug: string;
  subject: string;
  created_at: string;
}

interface GeneratedDocsOverlayProps {
  docs: GeneratedDocItem[];
  onWrite: (doc: GeneratedDocItem) => void;
  onReRun: (doc: GeneratedDocItem) => void;
  onDismiss: () => void;
}

export function GeneratedDocsOverlay(props: GeneratedDocsOverlayProps) {
  const { setOverlayActive } = useKeyboardNav();
  onMount(() => setOverlayActive(true));
  onCleanup(() => setOverlayActive(false));

  const [selectedIndex, setSelectedIndex] = createSignal(0);

  const clampedIndex = createMemo(() =>
    Math.min(selectedIndex(), Math.max(0, props.docs.length - 1))
  );

  useKeyboard((event: KeyEvent) => {
    const key = event.name;
    const listLength = props.docs.length;

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

    if (key === "return" || key === "w") {
      event.preventDefault();
      if (listLength > 0) props.onWrite(props.docs[clampedIndex()]);
      return;
    }

    if (key === "r") {
      event.preventDefault();
      if (listLength > 0) props.onReRun(props.docs[clampedIndex()]);
      return;
    }

    if (key === "escape") {
      event.preventDefault();
      props.onDismiss();
      return;
    }
  });

  const formatDate = (iso: string) => {
    try {
      return new Date(iso).toLocaleDateString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
      });
    } catch {
      return iso.slice(0, 10);
    }
  };

  const truncate = (s: string, max: number) =>
    s.length > max ? s.slice(0, max - 3) + "..." : s;

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
        width={72}
        height="80%"
        backgroundColor="#1a1a2e"
        borderStyle="single"
        borderColor="#586e75"
        padding={2}
        flexDirection="column"
      >
        <text fg="#eee8d5" marginBottom={1}>
          Generated Documents
        </text>

        <scrollbox height="100%">
          <For each={props.docs}>
            {(doc, index) => {
              const isSelected = () => clampedIndex() === index();
              const label = () =>
                `  ${truncate(doc.subject, 48)}    ${formatDate(doc.created_at)}`;

              return (
                <box
                  backgroundColor={isSelected() ? "#2d3748" : "transparent"}
                  paddingLeft={1}
                  paddingRight={1}
                >
                  <text fg={isSelected() ? "#eee8d5" : "#839496"}>
                    {label()}
                  </text>
                </box>
              );
            }}
          </For>
        </scrollbox>

        <text> </text>
        <text fg="#586e75">
          j/k: navigate | Enter/w: write file | r: re-run | Esc: cancel
        </text>
        <text fg="#dc322f">
          ⚠ Re-running replaces the existing file — write first to keep it
        </text>
      </box>
    </box>
  );
}
