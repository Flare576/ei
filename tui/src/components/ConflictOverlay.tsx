import { useKeyboard } from "@opentui/solid";
import type { StateConflictResolution } from "../../../src/core/types.js";

interface ConflictOverlayProps {
  localTimestamp: Date;
  remoteTimestamp: Date;
  onResolve: (resolution: StateConflictResolution) => void;
}

function formatTimestamp(date: Date): string {
  const y = date.getFullYear();
  const mo = (date.getMonth() + 1).toString().padStart(2, "0");
  const d = date.getDate().toString().padStart(2, "0");
  const h = date.getHours().toString().padStart(2, "0");
  const m = date.getMinutes().toString().padStart(2, "0");
  return `${y}-${mo}-${d} ${h}:${m}`;
}

export function ConflictOverlay(props: ConflictOverlayProps) {
  useKeyboard((event) => {
    event.preventDefault();

    const key = event.name.toLowerCase();

    if (key === "l") {
      props.onResolve("local");
    } else if (key === "s") {
      props.onResolve("server");
    } else if (key === "y") {
      props.onResolve("yolo");
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
        width={60}
        backgroundColor="#1a1a2e"
        borderStyle="single"
        borderColor="#586e75"
        padding={2}
        flexDirection="column"
      >
        <text fg="#dc322f">
          State Conflict Detected
        </text>
        <text> </text>
        <text fg="#93a1a1">
          Both local and server state exist.
        </text>
        <text> </text>
        <text fg="#eee8d5">
          {`  Local:  ${formatTimestamp(props.localTimestamp)}`}
        </text>
        <text fg="#eee8d5">
          {`  Server: ${formatTimestamp(props.remoteTimestamp)}`}
        </text>
        <text> </text>
        <text fg="#b58900">
          [L] Keep Local   [S] Use Server   [Y] Yolo Merge
        </text>
        <text> </text>
        <text fg="#586e75">
          Yolo Merge combines both — safe for most cases
        </text>
      </box>
    </box>
  );
}