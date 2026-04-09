import { useKeyboard } from "@opentui/solid";
import { onMount, onCleanup } from "solid-js";
import type { CliRenderer } from "@opentui/core";
import { useKeyboardNav } from "../context/keyboard.js";
import { spawnPager } from "../util/editor.js";
import { buildManPage } from "../util/help-content.js";

interface HelpOverlayProps {
  onDismiss: () => void;
  renderer: CliRenderer;
}

export function HelpOverlay(props: HelpOverlayProps) {
  const { setOverlayActive } = useKeyboardNav();
  onMount(() => setOverlayActive(true));
  onCleanup(() => setOverlayActive(false));

  useKeyboard((event) => {
    event.preventDefault();
    if (event.name === "m") {
      props.onDismiss();
      void spawnPager(buildManPage(), props.renderer);
    } else {
      props.onDismiss();
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
        width={82}
        backgroundColor="#1a1a2e"
        borderStyle="single"
        borderColor="#586e75"
        padding={2}
        flexDirection="column"
        gap={1}
      >

        <box flexDirection="row" gap={2}>

          <box flexDirection="column" gap={1} width={38}>
            <box flexDirection="column">
              <text fg="#eee8d5">Keybindings</text>
              <text fg="#93a1a1">  Ctrl+E    Open $EDITOR (preserves input)</text>
              <text fg="#93a1a1">  Ctrl+C    Clear input / exit</text>
              <text fg="#93a1a1">  Ctrl+B    Toggle sidebar</text>
              <text fg="#93a1a1">  Escape    Abort / resume queue</text>
              <text fg="#93a1a1">  PgUp/Dn  Scroll messages</text>
            </box>

            <box flexDirection="column">
              <text fg="#eee8d5">Core</text>
              <text fg="#93a1a1">  /set          Edit global settings</text>
              <text fg="#93a1a1">  /q  /q!       Quit  (! = skip sync)</text>
              <text fg="#93a1a1">  /provider     Manage LLM providers</text>
              <text fg="#93a1a1">  /me           Edit your data</text>
              <text fg="#93a1a1">  /d  /d &lt;name&gt; Edit persona details</text>
            </box>
          </box>

          <box flexDirection="column" gap={1} width={38}>
            <box flexDirection="column">
              <text fg="#eee8d5">Persona</text>
              <text fg="#93a1a1">  /p  /p new  /p update</text>
              <text fg="#93a1a1">  /context   Message context</text>
              <text fg="#93a1a1">  /pause  /resume</text>
            </box>

            <box flexDirection="column">
              <text fg="#eee8d5">Rooms</text>
              <text fg="#93a1a1">  /r  /r new    Room picker / create</text>
              <text fg="#93a1a1">  /activate     Advance active node</text>
              <text fg="#93a1a1">  /silence      Pass your turn</text>
            </box>

            <box flexDirection="column">
              <text fg="#eee8d5">Extended</text>
              <text fg="#93a1a1">  /tools        Tool providers</text>
              <text fg="#93a1a1">  /auth spotify Spotify OAuth</text>
              <text fg="#93a1a1">  /queue  /dlq  Inspect queues</text>
            </box>
          </box>

        </box>

        <box flexDirection="column">
          <text fg="#586e75">  m - full manual  |  any key - dismiss</text>
          <text fg="#2a2a3e">  Ei - 永 (ei) - eternal</text>
        </box>

      </box>
    </box>
  );
}
