import { useKeyboard } from "@opentui/solid";

interface WelcomeOverlayProps {
  onDismiss: () => void;
}

export function WelcomeOverlay(props: WelcomeOverlayProps) {
  useKeyboard((event) => {
    event.preventDefault();
    props.onDismiss();
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
        width={70}
        backgroundColor="#1a1a2e"
        borderStyle="single"
        borderColor="#586e75"
        padding={2}
        flexDirection="column"
      >
        <text fg="#eee8d5">
          Welcome to Ei!
        </text>
        <text> </text>

        <text fg="#dc322f">
          No LLM provider detected.
        </text>
        <text> </text>

        <text fg="#93a1a1">
          To get started, you need a local LLM running or a provider configured.
        </text>
        <text> </text>

        <text fg="#93a1a1">
          Options:
        </text>
        <text fg="#93a1a1">
          1. Start a local LLM (LM Studio, Ollama) on port 1234
        </text>
        <text fg="#93a1a1">
          2. Run /provider new to configure a cloud provider
        </text>
        <text> </text>

        <text fg="#657b83">
          Once configured, restart Ei or run /provider new to add your provider.
        </text>
        <text> </text>

        <text fg="#586e75">
          Press any key to dismiss
        </text>
        <text> </text>
        <text fg="#2a2a3e">
          Ei - 永 (ei) - eternal
        </text>
      </box>
    </box>
  );
}
