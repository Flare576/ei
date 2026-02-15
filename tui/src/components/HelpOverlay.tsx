import { useKeyboard } from "@opentui/solid";
import { For } from "solid-js";
import { getAllCommands } from "../commands/registry";

interface HelpOverlayProps {
  onDismiss: () => void;
}

export function HelpOverlay(props: HelpOverlayProps) {
  useKeyboard((event) => {
    event.preventDefault();
    props.onDismiss();
  });

  const commands = getAllCommands();

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
        <text fg="#eee8d5">
          Ei - 永 (ei) - eternal
        </text>
        <text> </text>

        <text fg="#eee8d5">
          Commands:
        </text>
        <For each={commands}>
          {(cmd) => (
            <text fg="#93a1a1">
              /{cmd.name} - {cmd.description}
            </text>
          )}
        </For>
        <text> </text>

        <text fg="#eee8d5">
          Keybindings:
        </text>
        <text fg="#93a1a1">Escape - Abort operation / Resume queue</text>
        <text fg="#93a1a1">Ctrl+C - Clear input / Exit</text>
        <text fg="#93a1a1">Ctrl+B - Toggle sidebar</text>
        <text fg="#93a1a1">PageUp/Down - Scroll messages</text>
        <text> </text>

        <text fg="#586e75">
          Press any key to dismiss
        </text>
      </box>
    </box>
  );
}
