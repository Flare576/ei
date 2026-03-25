import type { Command } from "./registry";
import { RoomMode } from "../../../src/core/types/enums.js";

export const silenceCommand: Command = {
  name: "silence",
  aliases: [],
  description: "Pass your turn with optional reason",
  usage: "/silence [reason]",

  async execute(args, ctx) {
    const rawReason = args.join(" ").replace(/^["']|["']$/g, "").trim();
    const reason = rawReason || "passed";

    const roomId = ctx.ei.activeRoomId();
    if (roomId) {
      const room = ctx.ei.getRoom(roomId);
      if (room?.mode === RoomMode.FreeForAll) {
        await ctx.ei.sendFfaMessage(null, reason);
      } else {
        ctx.ei.submitHumanRoomMessage(null, reason);
      }
      ctx.showNotification(`Silence recorded: "${reason}"`, "info");
      return;
    }

    await ctx.ei.sendSilenceMessage(reason);
    ctx.showNotification("Silence recorded", "info");
  },
};
