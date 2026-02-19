import type { Command } from "./registry";

export const newCommand: Command = {
  name: "new",
  aliases: [],
  description: "Toggle context boundary (new convo)",
  usage: "/new",
  execute: async (_args, ctx) => {
    const personaId = ctx.ei.activePersonaId();
    if (!personaId) {
      ctx.showNotification("No persona selected", "error");
      return;
    }

    const persona = ctx.ei.personas().find(p => p.id === personaId);
    const messages = ctx.ei.messages();
    const lastMessage = messages[messages.length - 1];
    
    const boundaryIsActive = persona?.context_boundary && 
      (!lastMessage || persona.context_boundary > lastMessage.timestamp);

    if (boundaryIsActive) {
      await ctx.ei.setContextBoundary(personaId, null);
      ctx.showNotification("Context boundary cleared - previous messages restored", "info");
    } else {
      const timestamp = new Date().toISOString();
      await ctx.ei.setContextBoundary(personaId, timestamp);
      ctx.showNotification("Context boundary set - conversation starts fresh", "info");
    }
  },
};
