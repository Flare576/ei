import { Show } from "solid-js";
import { useEi } from "../context/ei";
import { useKeyboardNav } from "../context/keyboard";

export function StatusBar() {
  const { activePersona, queueStatus } = useEi();
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

  return (
    <box
      height={1}
      backgroundColor="#16213e"
      paddingLeft={1}
      paddingRight={1}
      flexDirection="row"
    >
      <box flexGrow={1}>
        <text fg="#586e75">
          <Show when={activePersona()} fallback="No persona selected">
            {activePersona()}
          </Show>
        </text>
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
