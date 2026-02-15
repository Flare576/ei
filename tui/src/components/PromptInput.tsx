import type { TextareaRenderable, KeyBinding } from "@opentui/core";
import { useEi } from "../context/ei";
import { useKeyboardNav } from "../context/keyboard";
import { parseAndExecute, registerCommand, type CommandContext } from "../commands/registry";
import { quitCommand } from "../commands/quit";
import { helpCommand } from "../commands/help";
import { personaCommand } from "../commands/persona";
import { archiveCommand, unarchiveCommand } from "../commands/archive";
import { useOverlay } from "../context/overlay";

// Enter submits, Ctrl+J or Meta+Enter for newline
const TEXTAREA_KEYBINDINGS: KeyBinding[] = [
  { name: "return", action: "submit" },
  { name: "return", meta: true, action: "newline" },
  { name: "j", ctrl: true, action: "newline" },
];

export function PromptInput() {
  const ei = useEi();
  const { sendMessage, activePersona, stopProcessor, showNotification } = ei;
  const { registerTextarea, exitApp } = useKeyboardNav();
  const { showOverlay, hideOverlay, overlayRenderer } = useOverlay();

  // Register commands (idempotent - safe to call multiple times)
  registerCommand(quitCommand);
  registerCommand(helpCommand);
  registerCommand(personaCommand);
  registerCommand(archiveCommand);
  registerCommand(unarchiveCommand);

  const handleSubmit = async () => {
    const text = textareaRef?.plainText?.trim();
    if (!text) return;
    
    // Clear input immediately
    textareaRef?.clear();
    
    // Check if it's a command
    if (text.startsWith("/")) {
      const ctx: CommandContext = {
        showOverlay,
        hideOverlay,
        showNotification,
        exitApp,
        stopProcessor,
        ei,
      };
      await parseAndExecute(text, ctx);
      return;
    }
    
    // Regular message - requires active persona
    if (!activePersona()) return;
    await sendMessage(text);
  };

  const getPlaceholder = () => {
    if (!activePersona()) return "Select a persona...";
    return "Type your message... (Enter to send, Ctrl+J for newline)";
  };

  let textareaRef: TextareaRenderable | undefined;

  return (
    <box 
      flexShrink={0}
      border={["top"]}
      borderStyle="single" 
      backgroundColor="#0f3460"
      paddingLeft={1}
      paddingRight={1}
      paddingTop={0.5}
      paddingBottom={0.5}
    >
      <textarea
        ref={(r: TextareaRenderable) => {
          textareaRef = r;
          registerTextarea(r);
        }}
        focused={!overlayRenderer()}
        onSubmit={() => void handleSubmit()}
        placeholder={getPlaceholder()}
        textColor="#eee8d5"
        backgroundColor="#0f3460"
        minHeight={1}
        maxHeight={6}
        keyBindings={overlayRenderer() ? [] : TEXTAREA_KEYBINDINGS}
      />
    </box>
  );
}
