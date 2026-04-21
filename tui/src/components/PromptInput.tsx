import { createEffect, createMemo, createSignal } from "solid-js";
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
import { toolsCommand } from "../commands/tools";
import { authCommand } from '../commands/auth';
import { dedupeCommand } from "../commands/dedupe";
import { roomCommand } from "../commands/room.js";
import { activateCommand } from "../commands/activate.js";
import { silenceCommand } from "../commands/silence.js";
import { captureCommand } from "../commands/capture.js";
import { openCYPEditor } from "../util/cyp-editor.js";
import { useOverlay } from "../context/overlay";
import { CommandSuggest } from "./CommandSuggest";
import { useKeyboard } from "@opentui/solid";
import type { KeyEvent } from "@opentui/core";
import { RoomMode } from "../../../src/core/types/enums.js";

const TEXTAREA_KEYBINDINGS: KeyBinding[] = [
  { name: "return", action: "submit" },
  { name: "return", meta: true, action: "newline" },
  { name: "j", ctrl: true, action: "newline" },
];

export function PromptInput() {
  const ei = useEi();
  const {
    sendMessage,
    activePersonaId,
    stopProcessor,
    showNotification,
    activeRoomId,
    getRoom,
    roomMessages,
    roomActivePath,
    personas,
    sendFfaMessage,
    submitHumanRoomMessage,
    recallHumanRoomMessage,
    activateRoom,
    selectCYPBranch,
    humanRoomMessagePending,
  } = ei;
  const { registerTextarea, registerEditorHandler, exitApp, renderer, resetHistoryIndex } = useKeyboardNav();
  const { showOverlay, hideOverlay, overlayRenderer } = useOverlay();

  registerCommand(helpCommand);
  registerCommand(quitCommand);
  registerCommand(meCommand);
  registerCommand(quotesCommand);
  registerCommand(editorCommand);
  registerCommand(personaCommand);
  registerCommand(roomCommand);
  registerCommand(detailsCommand);
  registerCommand(newCommand);
  registerCommand(settingsCommand);
  registerCommand(providerCommand);
  registerCommand(setSyncCommand);
  registerCommand(contextCommand);
  registerCommand(deleteCommand);
  registerCommand(queueCommand);
  registerCommand(dlqCommand);
  registerCommand(toolsCommand);
  registerCommand(dedupeCommand);
  registerCommand(activateCommand);
  registerCommand(silenceCommand);
  registerCommand(captureCommand);
  registerCommand(authCommand);
  registerCommand(pauseCommand);
  registerCommand(resumeCommand);
  registerCommand(archiveCommand);
  registerCommand(unarchiveCommand);

  let textareaRef: TextareaRenderable | undefined;

  const [inputText, setInputText] = createSignal("");
  const [suggestIndex, setSuggestIndex] = createSignal(0);

  const allPersonasResponded = createMemo(() => {
    const roomId = activeRoomId();
    if (!roomId) return false;
    const room = getRoom(roomId);
    if (!room?.active_node_id) return false;
    const respondedIds = new Set(
      roomMessages()
        .filter(m => m.parent_id === room.active_node_id && m.role === "persona" && m.persona_id)
        .map(m => m.persona_id!)
    );
    const judgeId = room.judge_persona_id;
    const nonJudgeIds = room.persona_ids.filter(id => id !== judgeId);
    return nonJudgeIds.every(id => respondedIds.has(id));
  });

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

  createEffect(() => {
    if (activeRoomId() && !humanRoomMessagePending()) {
      const room = getRoom(activeRoomId()!);
      if (room?.mode !== RoomMode.FreeForAll && allPersonasResponded() && !humanRoomMessagePending()) {
        showNotification("Use /silence to pass", "info");
      }
    }
  });

  useKeyboard((event: KeyEvent) => {
    if (event.name === "up" && activeRoomId() && humanRoomMessagePending()) {
      const room = getRoom(activeRoomId()!);
      if (room?.mode !== RoomMode.FreeForAll) {
        // Lock check: if any child of active_node has children, the node is explored — don't allow recall
        const activeNodeId = room?.active_node_id;
        const allMessages = roomMessages();
        const childrenOfActiveNode = allMessages.filter(m => m.parent_id === activeNodeId);
        const isLocked = childrenOfActiveNode.some(child =>
          allMessages.some(m => m.parent_id === child.id)
        );
        if (isLocked) {
          showNotification("Cannot recall — this path has already been explored", "warn");
          event.preventDefault();
          return;
        }
        const pendingMsg = allMessages.find(
          m => m.parent_id === room?.active_node_id && m.role === "human"
        );
        const recalled = recallHumanRoomMessage();
        if (recalled) {
          const content = pendingMsg?.content ?? pendingMsg?.silence_reason ?? "";
          textareaRef?.setText(content);
          setInputText(content);
          textareaRef?.gotoBufferEnd();
        }
        event.preventDefault();
        return;
      }
    }

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
    const text = textareaRef?.plainText?.trim() ?? "";

    if (activeRoomId()) {
      const room = getRoom(activeRoomId()!);

      if (room?.mode !== RoomMode.FreeForAll && !text) {
        if (humanRoomMessagePending() && allPersonasResponded()) {
          if (room?.mode === RoomMode.ChooseYourPath && room.active_node_id) {
            await openCYPEditor({
              roomId: activeRoomId()!,
              activeNodeId: room.active_node_id,
              messages: roomMessages(),
              activePath: roomActivePath(),
              personas: personas(),
              selectBranch: selectCYPBranch,
              showNotification,
              renderer,
            });
          } else {
            await activateRoom();
          }
        }
        return;
      }
    }

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
                                 text === "/dlq" ||
                                 text.startsWith("/dedupe");

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

    if (activeRoomId()) {
      const room = getRoom(activeRoomId()!);
      if (room?.mode === RoomMode.FreeForAll) {
        textareaRef?.clear();
        setInputText("");
        await sendFfaMessage(text, undefined);
        return;
      }

      if (!humanRoomMessagePending()) {
        const msgId = submitHumanRoomMessage(text, undefined);
        if (msgId !== null) {
          textareaRef?.clear();
          setInputText("");
        }
        return;
      }

      if (humanRoomMessagePending() && allPersonasResponded()) {
        await activateRoom();
        return;
      }

      showNotification("Waiting for participants to respond...", "info");
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
    if (activeRoomId() && humanRoomMessagePending()) return "Response Submitted - Press [Up] to recall";
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
