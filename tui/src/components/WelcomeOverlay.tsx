import { useKeyboard } from "@opentui/solid";
import { onMount, onCleanup, For } from "solid-js";
import { useKeyboardNav } from "../context/keyboard.js";
import type { ProviderDetectionStatus } from "../util/provider-detection.js";

interface WelcomeOverlayProps {
  onDismiss: () => void;
  detectedProviders: ProviderDetectionStatus[];
  defaultModel?: string;
}

const COLUMNS = 3;

export function WelcomeOverlay(props: WelcomeOverlayProps) {
  const { setOverlayActive } = useKeyboardNav();
  onMount(() => setOverlayActive(true));
  onCleanup(() => setOverlayActive(false));

  useKeyboard((event) => {
    event.preventDefault();
    props.onDismiss();
  });

  const hasAny = () => props.detectedProviders.some((p) => p.detected);

  const rows = () => {
    const items = props.detectedProviders;
    const out: ProviderDetectionStatus[][] = [];
    for (let i = 0; i < items.length; i += COLUMNS) {
      out.push(items.slice(i, i + COLUMNS));
    }
    return out;
  };

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
        <text fg="#eee8d5">Welcome to Ei!</text>
        <text> </text>

        <box visible={hasAny()} flexDirection="column">
          <text fg="#93a1a1">Detected providers:</text>
          <text> </text>

          <For each={rows()}>
            {(row) => (
              <box flexDirection="row">
                <For each={row}>
                  {(provider) => (
                    <box width={22} flexDirection="row">
                      <text fg="#93a1a1">{provider.name}:</text>
                      <text> </text>
                      <text fg={provider.detected ? "#859900" : "#dc322f"}>
                        {provider.detected ? "[✓]" : "[✗]"}
                      </text>
                    </box>
                  )}
                </For>
              </box>
            )}
          </For>

          <text> </text>
          <box visible={!!props.defaultModel} flexDirection="row">
            <text fg="#657b83">Default model: </text>
            <text fg="#eee8d5">{props.defaultModel ?? ""}</text>
          </box>
          <text> </text>
          <text fg="#93a1a1">To chat with a smarter model, try: /provider</text>
          <text fg="#93a1a1">To change your default, use: /settings</text>
          <text fg="#93a1a1">See /help for... well, Help!</text>
        </box>

        <box visible={!hasAny()} flexDirection="column">
          <text fg="#dc322f">No LLM provider detected.</text>
          <text> </text>
          <text fg="#93a1a1">Start LMStudio (port 1234) or Ollama (port 11434), or</text>
          <text fg="#93a1a1">set one of: ANTHROPIC_API_KEY, OPENAI_API_KEY, GROQ_API_KEY,</text>
          <text fg="#93a1a1">MISTRAL_API_KEY, GEMINI_API_KEY and restart.</text>
        </box>

        <text> </text>
        <text fg="#586e75">Press any key to continue</text>
        <text> </text>
        <text fg="#2a2a3e">Ei - 永 (ei) - eternal</text>
      </box>
    </box>
  );
}
