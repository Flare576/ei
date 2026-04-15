import { useKeyboard } from "@opentui/solid";
import { For, createMemo, createSignal, onMount, onCleanup, createEffect } from "solid-js";
import type { RoomMessage, PersonaSummary } from "../../../src/core/types.js";
import type { ScrollBoxRenderable } from "@opentui/core";
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

type LineKind = 'normal' | 'masked' | 'your-turn';

interface TreeLine {
  messageId: string;
  globalNum: number;
  prefix: string;
  speaker: string;
  preview: string;
  stateIndicator: string;
  kind: LineKind;
  isMaskedOrPlaceholder: boolean;
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
  const [navError, setNavError] = createSignal<string>("");

  let scrollRef: ScrollBoxRenderable | null = null;

  createEffect(() => {
    const hid = highlightedId();
    const lines = visibleLines();
    const idx = lines.findIndex(l => l.messageId === hid);
    if (idx < 0 || !scrollRef) return;
    const top = scrollRef.scrollTop;
    const visible = scrollRef.height;
    if (idx < top) {
      scrollRef.scrollTo(idx);
    } else if (idx >= top + visible) {
      scrollRef.scrollTo(idx - visible + 1);
    }
  });

  const activeRoomPathIds = createMemo(() => new Set(props.activeRoomPath.map((m) => m.id)));

  const incompleteFamilies = createMemo<Set<string>>(() => {
    const result = new Set<string>();
    const { childrenMap } = treeData();
    childrenMap.forEach((children, parentId) => {
      const hasPersonaChild = children.some(c => c.role === "persona");
      const hasHumanChild = children.some(c => c.role === "human");
      if (hasPersonaChild && !hasHumanChild) result.add(parentId);
    });
    return result;
  });

  const ICON_COL = 74;
  const NUM_WIDTH = 7;

  const visibleLines = createMemo<TreeLine[]>(() => {
    const { ordered, idToNum, childrenMap } = treeData();
    if (ordered.length === 0) return [];

    const stack = viewStack();
    const viewRootId = stack.length > 0 ? stack[stack.length - 1] : null;
    const subtreeIds = viewRootId ? getSubtreeIds(viewRootId, childrenMap) : null;
    const incomplete = incompleteFamilies();

    const lines: TreeLine[] = [];

    function buildPrefix(ancestorIsLast: boolean[], isLast: boolean, isDisplayRoot: boolean): string {
      if (isDisplayRoot) return "";
      let p = "";
      for (const anc of ancestorIsLast) p += anc ? "   " : "\u2502  ";
      return p + (isLast ? "\u2514\u2500 " : "\u251C\u2500 ");
    }

    function formatLine(numStr: string, prefix: string, speaker: string, content: string, icon: string): string {
      const prefixLen = prefix.length;
      const available = ICON_COL - NUM_WIDTH - prefixLen - speaker.length - 4 - 1;
      const trimmed = content.length > available ? content.slice(0, Math.max(available - 1, 8)) + "\u2026" : content;
      const body = `${numStr}  ${prefix}${speaker}: "${trimmed}"`;
      return body.padEnd(ICON_COL) + " " + icon;
    }

    function pushLine(msgId: string, prefix: string, speaker: string, content: string, icon: string, kind: LineKind, globalNum: number) {
      const numStr = ` ${String(globalNum).padStart(3)} `;
      const formatted = formatLine(numStr, prefix, speaker, content, icon);
      lines.push({
        messageId: msgId,
        globalNum,
        prefix,
        speaker,
        preview: formatted,
        stateIndicator: icon,
        kind,
        isMaskedOrPlaceholder: kind === 'masked' || kind === 'your-turn',
      });
    }

    function visit(msgId: string, isLast: boolean, ancestorIsLast: boolean[], isDisplayRoot: boolean) {
      const msg = props.messages.find((m) => m.id === msgId);
      if (!msg) return;
      if (subtreeIds && !subtreeIds.has(msgId)) return;

      const children = childrenMap.get(msgId) ?? [];
      const prefix = buildPrefix(ancestorIsLast, isLast, isDisplayRoot);
      const globalNum = idToNum.get(msgId) ?? 0;

      let kind: LineKind = 'normal';
      if (msg.parent_id && incomplete.has(msg.parent_id)) kind = 'masked';

      let icon: string;
      if (msgId === props.activeNodeId) icon = "\u25CF";
      else if (activeRoomPathIds().has(msgId)) icon = "\u25CB";
      else if (kind === 'masked') icon = "\uD83D\uDD12";
      else if (children.length === 0) icon = "\u00B7";
      else icon = "\u25CB";

      let speaker = "You";
      if (msg.role === "persona" && msg.persona_id) {
        speaker = props.personas.find((p) => p.id === msg.persona_id)?.display_name ?? msg.persona_id;
      }

      const content = kind === 'masked' ? "[hidden]" : getMessageContent(msg).replace(/\n/g, " ");
      pushLine(msgId, prefix, speaker, content, icon, kind, globalNum);

      const nextAncestors = isDisplayRoot ? [] : [...ancestorIsLast, isLast];
      const hasHumanChild = children.some(c => c.role === "human");
      const hasPersonaChild = children.some(c => c.role === "persona");
      const needsYourTurn = hasPersonaChild && !hasHumanChild;

      for (let i = 0; i < children.length; i++) {
        const childIsLast = !needsYourTurn && i === children.length - 1;
        visit(children[i].id, childIsLast, nextAncestors, false);
      }

      if (needsYourTurn) {
        const ytPrefix = buildPrefix(nextAncestors, true, false);
        const numStr = ` --  `;
        const formatted = formatLine(numStr, ytPrefix, "You", "[Your turn]", "\u270F\uFE0F");
        lines.push({
          messageId: `your-turn-${msgId}`,
          globalNum: 0,
          prefix: ytPrefix,
          speaker: "You",
          preview: formatted,
          stateIndicator: "\u270F\uFE0F",
          kind: 'your-turn',
          isMaskedOrPlaceholder: true,
        });
      }
    }

    const displayRootId = viewRootId ?? (ordered[0]?.id ?? null);
    if (displayRootId) visit(displayRootId, true, [], true);

    return lines;
  });

  useKeyboard((event) => {
    event.preventDefault();
    const key = event.name;

    if (navError()) setNavError("");

    if (key === "q" || key === "escape") {
      props.onDismiss();
      return;
    }

    if (key === "o") {
      setViewStack((prev) => prev.slice(0, -1));
      return;
    }

    if (key === "i") {
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

    if (key === "pageup") {
      if (scrollRef) {
        const half = Math.max(1, Math.floor(scrollRef.height / 2));
        scrollRef.scrollBy(-half);
        const lines = visibleLines();
        const newTop = scrollRef.scrollTop;
        const targetLine = lines[newTop];
        if (targetLine) setHighlightedId(targetLine.messageId);
      }
      return;
    }

    if (key === "pagedown") {
      if (scrollRef) {
        const half = Math.max(1, Math.floor(scrollRef.height / 2));
        scrollRef.scrollBy(half);
        const lines = visibleLines();
        const newTop = scrollRef.scrollTop;
        const targetLine = lines[Math.min(newTop + scrollRef.height - 1, lines.length - 1)];
        if (targetLine) setHighlightedId(targetLine.messageId);
      }
      return;
    }

    if (key === "backspace") {
      setNumBuffer((prev) => prev.slice(0, -1));
      return;
    }

    if (key === "return") {
      const buf = numBuffer();
      let targetId: string | undefined;

      if (buf.length > 0) {
        const num = parseInt(buf, 10);
        const { numToId } = treeData();
        targetId = numToId.get(num);
        if (!targetId) {
          setNavError(`No node at position ${num}`);
          setNumBuffer("");
          return;
        }
      } else {
        const hid = highlightedId();
        const line = visibleLines().find(l => l.messageId === hid);
        if (!line || line.isMaskedOrPlaceholder) return;
        targetId = hid;
      }

      if (targetId) {
        const targetMsg = props.messages.find(m => m.id === targetId);
        if (targetMsg?.parent_id && incompleteFamilies().has(targetMsg.parent_id)) {
          setNavError(`Node is masked — a sibling response is missing`);
          setNumBuffer("");
          return;
        }
        setNavError("");
        setNumBuffer("");
        void props.onSelectBranch(targetId).then(() => props.onDismiss());
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
    return `${name}  \u25CF active  \u25CB activated  \u00B7 unexplored  \uD83D\uDD12 masked  \u270F\uFE0F  your turn`;
  });

  const footerText = createMemo(() => {
    const err = navError();
    if (err) return `! ${err}  (press any key to continue)`;
    const buf = numBuffer();
    const bufPart = buf.length > 0 ? `  |  #${buf}_` : "";
    return `[i] zoom in  [o] zoom out  [q] quit  |  Type number or highlight + Enter to activate${bufPart}`;
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

        <scrollbox height="100%" marginTop={1} marginBottom={1} ref={(el: ScrollBoxRenderable) => { scrollRef = el; }}>
          <For each={visibleLines()}>
            {(line) => {
              const isHighlighted = () => line.messageId === highlightedId();
              const fg = () => {
                if (isHighlighted()) return "#b58900";
                if (line.kind === 'masked') return "#44475a";
                if (line.kind === 'your-turn') return "#6272a4";
                return "#93a1a1";
              };
              return (
                <box
                  visible={true}
                  backgroundColor={isHighlighted() ? "#2d3748" : "transparent"}
                  paddingLeft={1}
                >
                  <text fg={fg()}>{line.preview}</text>
                </box>
              );
            }}
          </For>
        </scrollbox>

        <box paddingLeft={1} paddingRight={1} paddingBottom={1}>
          <text fg={navError() ? "#dc322f" : "#586e75"}>{footerText()}</text>
        </box>
      </box>
    </box>
  );
}
