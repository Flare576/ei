import type { Command } from "./registry.js";
import { ToolCallsOverlay } from "../components/ToolCallsOverlay.js";

export const toolCallsCommand: Command = {
  name: "toolcalls",
  aliases: [],
  description: "Show the tool calls a Persona made for a message",
  usage: "/toolcalls [N]",

  async execute(args, ctx) {
    if (ctx.ei.activeRoomId()) {
      ctx.showNotification("Tool calls are only available in 1:1 conversations", "warn");
      return;
    }

    const messages = ctx.ei.messages();
    let index: number;

    if (args.length === 0) {
      index = 0;
      for (let i = messages.length - 1; i >= 0; i--) {
        if (messages[i].role === "system") {
          index = i + 1;
          break;
        }
      }
      if (index === 0) {
        ctx.showNotification("No Persona message to show tool calls for", "info");
        return;
      }
    } else {
      const raw = args.join(" ");
      index = args.length === 1 && /^\d+$/.test(args[0]) ? parseInt(args[0], 10) : 0;
      if (index < 1 || index > messages.length) {
        ctx.showNotification(`No message at index [${raw}]`, "error");
        return;
      }
    }

    const target = messages[index - 1];
    const calls = target.role === "system" ? target.tool_calls : undefined;
    if (!calls || calls.length === 0) {
      ctx.showNotification(`There are no tool calls on this message [${index}]`, "info");
      return;
    }

    ctx.showOverlay((hide) => (
      <ToolCallsOverlay calls={calls} messageIndex={index} onDismiss={hide} />
    ), ctx.renderer);
  },
};
