import { useKeyboard } from "@opentui/solid";
import { For, onMount, onCleanup } from "solid-js";
import type { KeyEvent, ScrollBoxRenderable } from "@opentui/core";
import type { ToolCallRecord } from "../../../src/core/types.js";
import { useKeyboardNav } from "../context/keyboard.js";

interface ToolCallsOverlayProps {
  calls: ToolCallRecord[];
  messageIndex: number;
  onDismiss: () => void;
}

function callAction(call: ToolCallRecord): string | undefined {
  const action = call.arguments?.action;
  return typeof action === "string" ? action : undefined;
}

function callTitle(call: ToolCallRecord, position: number, total: number): string {
  const action = callAction(call);
  const name = action === undefined ? call.name : `${call.name} (${action})`;
  return `[${position}/${total}] ${name}`;
}

// Strings render verbatim; everything else is shown as pretty JSON so nested
// values stay readable. Nothing is truncated, masked or reformatted.
function formatArgumentValue(value: unknown): string {
  if (typeof value === "string") return value;
  const json = JSON.stringify(value, null, 2);
  return json === undefined ? String(value) : json.replace(/\n/g, "\n    ");
}

export function ToolCallsOverlay(props: ToolCallsOverlayProps) {
  const { setOverlayActive } = useKeyboardNav();
  onMount(() => setOverlayActive(true));
  onCleanup(() => setOverlayActive(false));

  let scrollRef: ScrollBoxRenderable | null = null;

  useKeyboard((event: KeyEvent) => {
    event.preventDefault();
    const key = event.name;

    if (key === "escape" || key === "q") {
      props.onDismiss();
      return;
    }

    if (key === "up" || key === "k") {
      scrollRef?.scrollBy(-1);
      return;
    }

    if (key === "down" || key === "j") {
      scrollRef?.scrollBy(1);
      return;
    }

    if (key === "pageup") {
      if (scrollRef) scrollRef.scrollBy(-Math.max(1, Math.floor(scrollRef.height / 2)));
      return;
    }

    if (key === "pagedown") {
      if (scrollRef) scrollRef.scrollBy(Math.max(1, Math.floor(scrollRef.height / 2)));
      return;
    }
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
        width="90%"
        height="90%"
        backgroundColor="#1a1a2e"
        borderStyle="single"
        borderColor="#586e75"
        padding={1}
        flexDirection="column"
      >
        <text fg="#eee8d5" marginBottom={1}>
          {`Tool calls - message [${props.messageIndex}]`}
        </text>

        {/* paddingRight keeps wrapped text one column clear of the vertical scrollbar, which would otherwise overdraw each row's last cell. */}
        <scrollbox flexGrow={1} contentOptions={{ paddingRight: 1 }} ref={(el: ScrollBoxRenderable) => { scrollRef = el; }}>
          <For each={props.calls}>
            {(call, index) => {
              const argumentEntries = Object.entries(call.arguments ?? {});
              return (
                <box flexDirection="column" marginBottom={1}>
                  <text fg="#b58900" wrapMode="char">
                    {callTitle(call, index() + 1, props.calls.length)}
                  </text>
                  <text fg={call.error ? "#dc322f" : "#839496"} wrapMode="char">
                    {`error: ${call.error}`}
                  </text>
                  <text fg="#586e75">arguments:</text>
                  <For each={argumentEntries}>
                    {([key, value]) => (
                      <text fg="#93a1a1" wrapMode="char">
                        {`  ${key}: ${formatArgumentValue(value)}`}
                      </text>
                    )}
                  </For>
                  <text fg="#586e75">result:</text>
                  <text fg="#93a1a1" wrapMode="char">{formatArgumentValue(call.result)}</text>
                </box>
              );
            }}
          </For>
        </scrollbox>

        <text fg="#586e75" marginTop={1}>
          j/k: scroll | PgUp/PgDn: page | Esc/q: close
        </text>
      </box>
    </box>
  );
}
