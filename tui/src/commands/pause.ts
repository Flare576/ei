import type { Command } from "./registry";
import { parseDuration, formatDuration } from "../util/duration";

export const pauseCommand: Command = {
  name: "pause",
  aliases: [],
  description: "Pause persona (optionally for a duration)",
  usage: "/pause [duration] - e.g., /pause 2h, /pause 1d",
  execute: async (args, ctx) => {
    const personaId = ctx.ei.activePersonaId();
    if (!personaId) {
      ctx.showNotification("No persona selected", "error");
      return;
    }

    const personas = ctx.ei.personas();
    const persona = personas.find(p => p.id === personaId);
    const visibleActive = personas.filter(p => !p.is_archived && !p.is_paused);
    
    if (visibleActive.length <= 1) {
      ctx.showNotification("Cannot pause - at least one persona must remain active", "error");
      return;
    }

    const displayName = persona?.display_name ?? personaId;
    let pauseUntil: string;
    let message: string;

    if (args.length > 0) {
      const durationMs = parseDuration(args[0]);
      if (!durationMs) {
        ctx.showNotification(`Invalid duration: ${args[0]}. Use formats like 2h, 1d, 1w`, "error");
        return;
      }
      const resumeTime = new Date(Date.now() + durationMs);
      pauseUntil = resumeTime.toISOString();
      message = `Paused ${displayName} for ${formatDuration(durationMs)}`;
    } else {
      pauseUntil = "0";
      message = `Paused ${displayName} indefinitely`;
    }

    await ctx.ei.updatePersona(personaId, { is_paused: true, pause_until: pauseUntil });
    ctx.showNotification(message, "info");
  },
};
