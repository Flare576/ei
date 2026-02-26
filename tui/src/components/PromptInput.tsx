import { createEffect, createSignal } from "solid-js";
import { getAllCommands } from "../commands/registry";
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
import { settingsCommand } from "../commands/settings";
import { contextCommand } from "../commands/context.js";
import { deleteCommand } from "../commands/delete";
import { quotesCommand } from "../commands/quotes";
import { providerCommand } from "../commands/provider";
import { setSyncCommand } from "../commands/setsync";
import { queueCommand } from "../commands/queue";
import { dlqCommand } from "../commands/dlq";
import { useOverlay } from "../context/overlay";
import { CommandSuggest } from "./CommandSuggest";
import { useKeyboard } from "@opentui/solid";
import type { KeyEvent } from "@opentui/core";

const TEXTAREA_KEYBINDINGS: KeyBinding[] = [
  { name: "return", action: "submit" },
  { name: "return", meta: true, action: "newline" },
  { name: "j", ctrl: true, action: "newline" },
];

export function PromptInput() {
  const ei = useEi();
  const { sendMessage, activePersonaId, stopProcessor, showNotification } = ei;
  const { registerTextarea, registerEditorHandler, exitApp, renderer, resetHistoryIndex } = useKeyboardNav();
  const { showOverlay, hideOverlay, overlayRenderer } = useOverlay();

  registerCommand(helpCommand);
  registerCommand(quitCommand);
  registerCommand(meCommand);
  registerCommand(quotesCommand);
  registerCommand(editorCommand);
  registerCommand(personaCommand);
  registerCommand(detailsCommand);
  registerCommand(archiveCommand);
  registerCommand(unarchiveCommand);
  registerCommand(newCommand);
  registerCommand(pauseCommand);
  registerCommand(resumeCommand);
  registerCommand(modelCommand);
  registerCommand(settingsCommand);
  registerCommand(providerCommand);
  registerCommand(setSyncCommand);
  registerCommand(contextCommand);
  registerCommand(deleteCommand);
  registerCommand(queueCommand);
  registerCommand(dlqCommand);

  let textareaRef: TextareaRenderable | undefined;

  const [inputText, setInputText] = createSignal("");
  const [suggestIndex, setSuggestIndex] = createSignal(0);

  const suggestMatches = () => {
    const raw = inputText().trim();
    if (!raw.startsWith("/")) return [];
    const query = raw.slice(1).split(/\s/)[0].replace(/!$/, "").toLowerCase();
    return getAllCommands().filter(
      (cmd) =>
        cmd.name.startsWith(query) ||
        cmd.aliases.some((a) => a.startsWith(query))
    );
  };

  const suggestVisible = () => suggestMatches().length > 0 && !overlayRenderer();

  createEffect(() => {
    inputText();
    setSuggestIndex(0);
  });

  createEffect(() => {
    activePersonaId();
    resetHistoryIndex();
  });

  useKeyboard((event: KeyEvent) => {
    if (!suggestVisible()) return;

    if (event.name === "up") {
      event.preventDefault();
      setSuggestIndex(i => Math.max(0, i - 1));
      return;
    }
    if (event.name === "down") {
      event.preventDefault();
      setSuggestIndex(i => Math.min(suggestMatches().length - 1, i + 1));
      return;
    }
    if (event.name === "tab" || event.name === "right") {
      event.preventDefault();
      const match = suggestMatches()[suggestIndex()];
      if (match) {
        textareaRef?.setText(`/${match.name} `);
        setInputText(`/${match.name} `);
        textareaRef?.gotoBufferEnd();
        setSuggestIndex(0);
      }
      return;
    }
    if (event.name === "escape") {
      event.preventDefault();
      textareaRef?.clear();
      setInputText("");
      setSuggestIndex(0);
      return;
    }
  });

  const getCommandContext = (): CommandContext => ({
    showOverlay,
    hideOverlay,
    showNotification,
    exitApp,
    stopProcessor,
    ei,
    renderer,
    setInputText: (text: string) => {
      textareaRef?.setText(text);
      setInputText(text);
    },
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
                                 text.startsWith("/settings") ||
                                 text.startsWith("/set ") ||
                                 text === "/set" ||
                                 text.startsWith("/p") ||
                                 text.startsWith("/quotes") ||
                                 text.startsWith("/q ") ||
                                 text.startsWith("/context") ||
                                 text.startsWith("/messages") ||
                                 text === "/queue" ||
                                 text === "/dlq";

      if (!isEditorCmd && !opensEditorForData) {
        textareaRef?.clear();
        setInputText("");
      }
      await parseAndExecute(text, getCommandContext());
      if (opensEditorForData) {
        textareaRef?.clear();
        setInputText("");
      }
      setSuggestIndex(0);
      return;
    }

    textareaRef?.clear();
    setInputText("");
    resetHistoryIndex();
    setSuggestIndex(0);
    if (!activePersonaId()) return;
    await sendMessage(text);
  };

  const handleEditor = async () => {
    await editorCommand.execute([], getCommandContext());
  };

  registerEditorHandler(handleEditor);

  const getPlaceholder = () => {
    if (!activePersonaId()) return "Select a persona...";
    return "Type your message... (Enter to send, Ctrl+E for editor)";
  };

  return (
    <box
      flexDirection="column"
      flexShrink={0}
    >
      <CommandSuggest
        input={inputText}
        highlightIndex={suggestIndex}
      />
      <box
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
          onContentChange={() => setInputText(textareaRef?.plainText ?? "")}
          placeholder={getPlaceholder()}
          textColor="#eee8d5"
          backgroundColor="#0f3460"
          cursorColor="#eee8d5"
          minHeight={1}
          maxHeight={6}
          keyBindings={overlayRenderer() ? [] : TEXTAREA_KEYBINDINGS}
        />
      </box>
    </box>
  );
}
