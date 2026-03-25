import type { Command } from "./registry";

export const activateCommand: Command = {
  name: "activate",
  aliases: [],
  description: "Advance active node in current room",
  usage: "/activate | /activate <num>",

  async execute(args, ctx) {
    const roomId = ctx.ei.activeRoomId();
    if (!roomId) {
      ctx.showNotification("Not in a room. Use /room to switch to a room first.", "error");
      return;
    }

    if (args.length === 0) {
      await ctx.ei.activateRoom();
      return;
    }

    const num = parseInt(args[0], 10);
    if (isNaN(num) || num < 1) {
      ctx.showNotification("Usage: /activate <num> (1-based message index)", "error");
      return;
    }

    const messages = ctx.ei.roomMessages();
    const target = messages[num - 1];
    if (!target) {
      ctx.showNotification(`No message at index ${num} (room has ${messages.length} messages)`, "error");
      return;
    }

    await ctx.ei.selectCYPBranch(target.id);
  },
};
