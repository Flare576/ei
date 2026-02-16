import type { TextareaRenderable, KeyBinding } from "@opentui/core";
import { useEi } from "../context/ei";
import { useKeyboardNav } from "../context/keyboard";
import { parseAndExecute, registerCommand, type CommandContext } from "../commands/registry";
import { quitCommand } from "../commands/quit";
import { helpCommand } from "../commands/help";
import { personaCommand } from "../commands/persona";
import { archiveCommand, unarchiveCommand } from "../commands/archive";
import { newCommand } from "../commands/new";
import { pauseCommand } from "../commands/pause";
import { resumeCommand } from "../commands/resume";
import { modelCommand } from "../commands/model";
import { detailsCommand } from "../commands/details";
import { meCommand } from "../commands/me";
import { editorCommand } from "../commands/editor";
import { useOverlay } from "../context/overlay";

const TEXTAREA_KEYBINDINGS: KeyBinding[] = [
  { name: "return", action: "submit" },
  { name: "return", meta: true, action: "newline" },
  { name: "j", ctrl: true, action: "newline" },
];

export function PromptInput() {
  const ei = useEi();
  const { sendMessage, activePersona, stopProcessor, showNotification } = ei;
  const { registerTextarea, registerEditorHandler, exitApp, renderer } = useKeyboardNav();
  const { showOverlay, hideOverlay, overlayRenderer } = useOverlay();

  registerCommand(quitCommand);
  registerCommand(helpCommand);
  registerCommand(personaCommand);
  registerCommand(archiveCommand);
  registerCommand(unarchiveCommand);
  registerCommand(newCommand);
  registerCommand(pauseCommand);
  registerCommand(resumeCommand);
  registerCommand(modelCommand);
  registerCommand(detailsCommand);
  registerCommand(meCommand);
  registerCommand(editorCommand);

  let textareaRef: TextareaRenderable | undefined;

  const getCommandContext = (): CommandContext => ({
    showOverlay,
    hideOverlay,
    showNotification,
    exitApp,
    stopProcessor,
    ei,
    renderer,
    setInputText: (text: string) => textareaRef?.setText(text),
    getInputText: () => textareaRef?.plainText || "",
  });

  const handleSubmit = async () => {
    const text = textareaRef?.plainText?.trim();
    if (!text) return;
    
    if (text.startsWith("/")) {
      const isEditorCmd = text.startsWith("/editor") ||
                          text.startsWith("/edit") ||
                          text.startsWith("/e ") ||
                          text === "/e";
      const opensEditorForData = text.startsWith("/me") || 
                                 text.startsWith("/details") || 
                                 text.startsWith("/d ") ||
                                 text === "/d" ||
                                 text.startsWith("/p");
      
      if (!isEditorCmd && !opensEditorForData) {
        textareaRef?.clear();
      }
      await parseAndExecute(text, getCommandContext());
      if (opensEditorForData) {
        textareaRef?.clear();
      }
      return;
    }
    
    textareaRef?.clear();
    if (!activePersona()) return;
    await sendMessage(text);
  };

  const handleEditor = async () => {
    await editorCommand.execute([], getCommandContext());
  };

  registerEditorHandler(handleEditor);

  const getPlaceholder = () => {
    if (!activePersona()) return "Select a persona...";
    return "Type your message... (Enter to send, Ctrl+E for editor)";
  };

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
        cursorColor="#eee8d5"
        minHeight={1}
        maxHeight={6}
        keyBindings={overlayRenderer() ? [] : TEXTAREA_KEYBINDINGS}
      />
    </box>
  );
}
