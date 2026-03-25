import type { Command } from "./registry";

const INTEGRATION_TRIGGERS = new Set(["opencode", "claudecode", "cursor"]);

export const captureCommand: Command = {
  name: "capture",
  aliases: [],
  description: "Trigger extraction on current chat",
  usage: "/capture | /capture opencode",

  async execute(args, ctx) {
    if (args.length === 0) {
      if (ctx.ei.activeRoomId()) {
        ctx.ei.captureRoom();
        ctx.showNotification("Extraction queued for room", "info");
      } else {
        ctx.ei.capturePersona();
        ctx.showNotification("Extraction queued", "info");
      }
      return;
    }

    const sub = args[0].toLowerCase();

    if (INTEGRATION_TRIGGERS.has(sub)) {
      ctx.ei.capturePersona();
      ctx.showNotification("Note: Integration scanning runs automatically. Enable in /settings.", "info");
      return;
    }

    ctx.showNotification("Named capture not yet supported. Use /room or /persona to switch first.", "warn");
  },
};
