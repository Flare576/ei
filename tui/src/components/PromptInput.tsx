import type { TextareaRenderable, KeyBinding } from "@opentui/core";
import { useEi } from "../context/ei";
import { useKeyboardNav } from "../context/keyboard";

// Enter submits, Ctrl+J or Meta+Enter for newline
const TEXTAREA_KEYBINDINGS: KeyBinding[] = [
  { name: "return", action: "submit" },
  { name: "return", meta: true, action: "newline" },
  { name: "j", ctrl: true, action: "newline" },
];

export function PromptInput() {
  const { sendMessage, activePersona } = useEi();
  const { registerTextarea } = useKeyboardNav();

  const handleSubmit = () => {
    const text = textareaRef?.plainText?.trim();
    if (!text || !activePersona()) return;
    
    sendMessage(text);
    textareaRef?.clear();
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
        focused={true}
        onSubmit={handleSubmit}
        placeholder={getPlaceholder()}
        textColor="#eee8d5"
        backgroundColor="#0f3460"
        minHeight={1}
        maxHeight={6}
        keyBindings={TEXTAREA_KEYBINDINGS}
      />
    </box>
  );
}
