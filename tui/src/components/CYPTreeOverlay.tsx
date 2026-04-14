import { useKeyboard } from "@opentui/solid";
import { For, createMemo, createSignal, onMount, onCleanup } from "solid-js";
import type { RoomMessage, PersonaSummary } from "../../../src/core/types.js";
import { useKeyboardNav } from "../context/keyboard.js";
import { buildCYPTree, getSubtreeIds } from "../util/cyp-tree.js";

export interface CYPTreeOverlayProps {
  roomId: string;
  roomName?: string;
  messages: RoomMessage[];
  activeNodeId: string;
  activeRoomPath: RoomMessage[];
  personas: PersonaSummary[];
  onSelectBranch: (messageId: string) => Promise<void>;
  onDismiss: () => void;
}

interface TreeLine {
  messageId: string;
  globalNum: number;
  prefix: string;
  speaker: string;
  preview: string;
  stateIndicator: string;
}

function getMessageContent(m: RoomMessage): string {
  if (m.content) return m.content;
  if (m.verbal_response) return m.verbal_response;
  if (m.action_response) return m.action_response;
  if (m.silence_reason) return `(${m.silence_reason})`;
  return "";
}

export function CYPTreeOverlay(props: CYPTreeOverlayProps) {
  const { setOverlayActive } = useKeyboardNav();
  onMount(() => setOverlayActive(true));
  onCleanup(() => setOverlayActive(false));

  const treeData = createMemo(() => buildCYPTree(props.messages));

  const [highlightedId, setHighlightedId] = createSignal<string>(props.activeNodeId);
  const [viewStack, setViewStack] = createSignal<string[]>([]);
  const [numBuffer, setNumBuffer] = createSignal<string>("");

  const activeRoomPathIds = createMemo(() => new Set(props.activeRoomPath.map((m) => m.id)));

  const visibleLines = createMemo<TreeLine[]>(() => {
    const { ordered, idToNum, childrenMap } = treeData();
    if (ordered.length === 0) return [];

    const stack = viewStack();
    const viewRootId = stack.length > 0 ? stack[stack.length - 1] : null;

    const subtreeIds = viewRootId
      ? getSubtreeIds(viewRootId, childrenMap)
      : null;

    const lines: TreeLine[] = [];

    function visit(
      msgId: string,
      isLast: boolean,
      ancestorIsLast: boolean[],
      isDisplayRoot: boolean
    ) {
      const msg = props.messages.find((m) => m.id === msgId);
      if (!msg) return;

      if (subtreeIds && !subtreeIds.has(msgId)) return;

      const children = childrenMap.get(msgId) ?? [];

      let prefix = "";
      if (!isDisplayRoot) {
        for (const anc of ancestorIsLast) {
          prefix += anc ? "   " : "\u2502  ";
        }
        prefix += isLast ? "\u2514\u2500 " : "\u251C\u2500 ";
      }

      const globalNum = idToNum.get(msgId) ?? 0;

      let stateIndicator: string;
      if (msgId === props.activeNodeId) {
        stateIndicator = "\u25CF";
      } else if (activeRoomPathIds().has(msgId)) {
        stateIndicator = "\u25CB";
      } else if (children.length === 0 && msg.parent_id === props.activeNodeId) {
        stateIndicator = "?";
      } else if (children.length === 0) {
        stateIndicator = "\u00B7";
      } else {
        stateIndicator = " ";
      }

      let speaker = "You";
      if (msg.role === "persona" && msg.persona_id) {
        speaker =
          props.personas.find((p) => p.id === msg.persona_id)?.display_name ??
          msg.persona_id;
      }

      const rawContent = getMessageContent(msg);
      const preview = rawContent.replace(/\n/g, " ").slice(0, 50);

      lines.push({ messageId: msgId, globalNum, prefix, speaker, preview, stateIndicator });

      for (let i = 0; i < children.length; i++) {
        const child = children[i];
        const childIsLast = i === children.length - 1;
        const nextAncestors = isDisplayRoot ? [] : [...ancestorIsLast, isLast];
        visit(child.id, childIsLast, nextAncestors, false);
      }
    }

    const displayRootId = viewRootId ?? (ordered[0]?.id ?? null);
    if (displayRootId) {
      visit(displayRootId, true, [], true);
    }

    return lines;
  });

  useKeyboard((event) => {
    event.preventDefault();
    const key = event.name;

    if (key === "q" || key === "escape") {
      props.onDismiss();
      return;
    }

    if (key === "u") {
      setViewStack((prev) => prev.slice(0, -1));
      return;
    }

    if (key === "e") {
      const hid = highlightedId();
      if (hid) {
        setViewStack((prev) => [...prev, hid]);
      }
      return;
    }

    if (key === "up" || key === "k") {
      const lines = visibleLines();
      const idx = lines.findIndex((l) => l.messageId === highlightedId());
      if (idx > 0) setHighlightedId(lines[idx - 1].messageId);
      return;
    }

    if (key === "down" || key === "j") {
      const lines = visibleLines();
      const idx = lines.findIndex((l) => l.messageId === highlightedId());
      if (idx < lines.length - 1) setHighlightedId(lines[idx + 1].messageId);
      return;
    }

    if (key === "backspace") {
      setNumBuffer((prev) => prev.slice(0, -1));
      return;
    }

    if (key === "return") {
      const buf = numBuffer();
      if (buf.length > 0) {
        const num = parseInt(buf, 10);
        const { numToId } = treeData();
        const targetId = numToId.get(num);
        if (targetId) {
          void props.onSelectBranch(targetId).then(() => props.onDismiss());
        }
        setNumBuffer("");
      }
      return;
    }

    if (key && key.length === 1 && key >= "0" && key <= "9") {
      setNumBuffer((prev) => prev + key);
      return;
    }
  });

  const headerText = createMemo(() => {
    const name = props.roomName ?? props.roomId;
    return `${name}  \u25CF active  \u25CB activated  \u00B7 unexplored  ? pending`;
  });

  const footerText = createMemo(() => {
    const buf = numBuffer();
    const bufPart = buf.length > 0 ? `  |  #${buf}_` : "";
    return `[e] enter  [u] up  [q] quit  |  Type number + Enter to navigate${bufPart}`;
  });

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
        width="95%"
        height="95%"
        backgroundColor="#1a1a2e"
        borderStyle="single"
        borderColor="#586e75"
        flexDirection="column"
      >
        <box paddingLeft={1} paddingRight={1} paddingTop={1}>
          <text fg="#eee8d5">{headerText()}</text>
        </box>

        <scrollbox height="100%" marginTop={1} marginBottom={1}>
          <For each={visibleLines()}>
            {(line) => {
              const isHighlighted = () => line.messageId === highlightedId();
              return (
                <box
                  visible={true}
                  backgroundColor={isHighlighted() ? "#2d3748" : "transparent"}
                  paddingLeft={1}
                >
                  <text fg={isHighlighted() ? "#b58900" : "#93a1a1"}>
                    {` ${String(line.globalNum).padStart(3)}  ${line.prefix}${line.speaker}: "${line.preview}"  ${line.stateIndicator}`}
                  </text>
                </box>
              );
            }}
          </For>
        </scrollbox>

        <box paddingLeft={1} paddingRight={1} paddingBottom={1}>
          <text fg="#586e75">{footerText()}</text>
        </box>
      </box>
    </box>
  );
}
