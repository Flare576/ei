import type { Command } from "./registry";
import { RoomMode } from "../../../src/core/types/enums.js";
import { openCYPEditor } from "../util/cyp-editor.js";

export const activateCommand: Command = {
  name: "activate",
  aliases: ['a'],
  description: "Advance active node in current room",
  usage: "/activate | /activate <num>",

  async execute(args, ctx) {
    const roomId = ctx.ei.activeRoomId();
    if (!roomId) {
      ctx.showNotification("Not in a room. Use /room to switch to a room first.", "error");
      return;
    }

    if (args.length === 0) {
      const room = ctx.ei.getRoom(roomId);
      if (room?.mode === RoomMode.ChooseYourPath) {
        const activeNodeId = room.active_node_id;
        if (!activeNodeId) {
          ctx.showNotification("No active node in room", "error");
          return;
        }
        const allMessages = ctx.ei.roomMessages();
        const children = allMessages.filter((m) => m.parent_id === activeNodeId);
        const respondedIds = new Set(
          children
            .filter((m) => m.role === "persona" && m.persona_id)
            .map((m) => m.persona_id!)
        );
        const isComplete = room.persona_ids.every(
          (id) => id === room.judge_persona_id || respondedIds.has(id)
        );
        if (!isComplete) {
          ctx.showNotification("Waiting for responses...", "info");
          return;
        }
        await openCYPEditor({
          roomId,
          activeNodeId,
          messages: allMessages,
          activePath: ctx.ei.roomActivePath(),
          personas: ctx.ei.personas(),
          selectBranch: ctx.ei.selectCYPBranch,
          showNotification: ctx.showNotification,
          renderer: ctx.renderer,
        });
        return;
      }
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

    const freshRoom = ctx.ei.getRoom(roomId);
    const newActiveNodeId = freshRoom?.active_node_id;
    if (newActiveNodeId) {
      const freshMessages = ctx.ei.roomMessages();
      const children = freshMessages.filter(m => m.parent_id === newActiveNodeId);
      const respondedIds = new Set(
        children.filter(m => m.role === "persona" && m.persona_id).map(m => m.persona_id!)
      );
      const nonJudgePersonas = (freshRoom?.persona_ids ?? []).filter(
        id => id !== freshRoom?.judge_persona_id
      );
      const isComplete = nonJudgePersonas.length > 0 && nonJudgePersonas.every(id => respondedIds.has(id));

      if (isComplete) {
        await openCYPEditor({
          roomId,
          activeNodeId: newActiveNodeId,
          messages: freshMessages,
          activePath: ctx.ei.roomActivePath(),
          personas: ctx.ei.personas(),
          selectBranch: (msgId) => ctx.ei.selectCYPBranch(msgId),
          showNotification: ctx.showNotification,
          renderer: ctx.renderer,
        });
      }
    }
  },
};
