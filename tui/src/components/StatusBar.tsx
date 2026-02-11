import { Show } from "solid-js";
import { useEi } from "../context/ei";
import { useKeyboardNav } from "../context/keyboard";

export function StatusBar() {
  const { activePersona, queueStatus, notification } = useEi();
  const { focusedPanel } = useKeyboardNav();

  const getQueueIndicator = () => {
    const status = queueStatus();
    if (status.state === "busy") {
      return `Processing (${status.pending_count})`;
    }
    if (status.state === "paused") {
      return "Paused";
    }
    return "Ready";
  };

  const getFocusIndicator = () => {
    const panel = focusedPanel();
    return panel.charAt(0).toUpperCase() + panel.slice(1);
  };

  const getNotificationColor = () => {
    const n = notification();
    if (!n) return "#586e75";
    if (n.level === "error") return "#dc322f";
    if (n.level === "warn") return "#b58900";
    return "#2aa198";
  };

  return (
    <box
      height={1}
      backgroundColor="#16213e"
      paddingLeft={1}
      paddingRight={1}
      flexDirection="row"
    >
      <box flexGrow={1}>
        <Show when={notification()} fallback={
          <text fg="#586e75">
            <Show when={activePersona()} fallback="No persona selected">
              {activePersona()}
            </Show>
          </text>
        }>
          <text fg={getNotificationColor()}>
            {notification()?.message}
          </text>
        </Show>
      </box>

      <text fg="#586e75" marginRight={2}>
        [{getFocusIndicator()}]
      </text>

      <text fg={queueStatus().state === "busy" ? "#b58900" : "#586e75"}>
        {getQueueIndicator()}
      </text>
    </box>
  );
}
