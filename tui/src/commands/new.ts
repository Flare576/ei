import type { Command } from "./registry";

export const newCommand: Command = {
  name: "new",
  aliases: [],
  description: "Toggle context boundary - persona forgets earlier messages",
  usage: "/new",
  execute: async (_args, ctx) => {
    const personaName = ctx.ei.activePersona();
    if (!personaName) {
      ctx.showNotification("No persona selected", "error");
      return;
    }

    const persona = ctx.ei.personas().find(p => p.name === personaName);
    const messages = ctx.ei.messages();
    const lastMessage = messages[messages.length - 1];
    
    const boundaryIsActive = persona?.context_boundary && 
      (!lastMessage || persona.context_boundary > lastMessage.timestamp);

    if (boundaryIsActive) {
      await ctx.ei.setContextBoundary(personaName, null);
      ctx.showNotification("Context boundary cleared - previous messages restored", "info");
    } else {
      const timestamp = new Date().toISOString();
      await ctx.ei.setContextBoundary(personaName, timestamp);
      ctx.showNotification("Context boundary set - conversation starts fresh", "info");
    }
  },
};
