import type { Command } from "./registry.js";

export const thinkingCommand: Command = {
  name: "thinking",
  aliases: [],
  description: "Toggle whether the active Persona's thinking is shown",
  usage: "/thinking",

  async execute(_args, ctx) {
    if (ctx.ei.activeRoomId()) {
      ctx.showNotification("Thinking display is only available in 1:1 conversations", "warn");
      return;
    }

    const personaId = ctx.ei.activePersonaId();
    if (!personaId) {
      ctx.showNotification("No active persona", "warn");
      return;
    }

    const persona = await ctx.ei.getPersona(personaId);
    if (!persona) {
      ctx.showNotification("Persona not found", "error");
      return;
    }

    const next = !(persona.show_thinking ?? true);
    await ctx.ei.updatePersona(personaId, { show_thinking: next });
    ctx.showNotification(`Thinking display ${next ? "on" : "off"} for ${persona.display_name}`, "info");
  },
};
