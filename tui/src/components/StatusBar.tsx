import { Show } from "solid-js";
import { useEi } from "../context/ei";
import { useKeyboardNav } from "../context/keyboard";

export function StatusBar() {
  const { activePersonaId, personas, queueStatus, notification } = useEi();
  const { focusedPanel, sidebarVisible } = useKeyboardNav();

  const getActiveDisplayName = () => {
    const id = activePersonaId();
    if (!id) return null;
    const persona = personas().find(p => p.id === id);
    return persona?.display_name ?? id;
  };

  const getQueueIndicator = () => {
    const status = queueStatus();
    let label: string;
    if (status.state === "busy") {
      label = `Processing (${status.pending_count})`;
    } else if (status.state === "paused") {
      label = `Paused (${status.pending_count})`;
    } else if (status.pending_count > 0) {
      label = `Waiting (${status.pending_count})`;
    } else {
      label = "Ready";
    }
    if (status.dlq_count > 0) {
      label += ` [DLQ:${status.dlq_count}]`;
    }
    return label;
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
            <Show when={getActiveDisplayName()} fallback="No persona selected">
              {getActiveDisplayName()}
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

      <Show when={!sidebarVisible()}>
        <text fg="#586e75" marginRight={2}>
          [S]
        </text>
      </Show>

      <text fg={queueStatus().state === "busy" ? "#b58900" : queueStatus().dlq_count > 0 ? "#dc322f" : queueStatus().pending_count > 0 ? "#2aa198" : "#586e75"}>
        {getQueueIndicator()}
      </text>
    </box>
  );
}
