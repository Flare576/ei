import type { Command } from "./registry";

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

    const integrationMap: Record<string, "opencode" | "claudeCode" | "cursor"> = {
      opencode: "opencode",
      claudecode: "claudeCode",
      cursor: "cursor",
    };
    const integrationKey = integrationMap[args[0].toLowerCase()];
    if (integrationKey) {
      const human = await ctx.ei.getHuman();
      const intSettings = human.settings?.[integrationKey];
      if (!intSettings?.integration) {
        ctx.showNotification(`${args[0]} integration not enabled. Enable in /settings.`, "warn");
        return;
      }
      // Reset last_sync to epoch to force immediate scan on next processor tick
      await ctx.ei.updateHuman({
        settings: {
          ...human.settings,
          [integrationKey]: {
            ...intSettings,
            last_sync: new Date(0).toISOString(),
          },
        },
      });
      ctx.showNotification(`${args[0]} scan will start on next cycle`, "info");
      return;
    }

    ctx.showNotification("Named capture not yet supported. Use /room or /persona to switch first.", "warn");
  },
};
