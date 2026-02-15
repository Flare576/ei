import type { Command } from "./registry";

export const resumeCommand: Command = {
  name: "resume",
  aliases: ["unpause"],
  description: "Resume a paused persona",
  usage: "/resume [persona]",
  execute: async (args, ctx) => {
    const targetName = args.length > 0 ? args[0] : ctx.ei.activePersona();

    if (!targetName) {
      ctx.showNotification("No persona selected", "error");
      return;
    }

    const personas = ctx.ei.personas();
    const persona = personas.find(p => p.name === targetName);
    
    if (persona && !persona.is_paused) {
      ctx.showNotification(`${targetName} is not paused`, "warn");
      return;
    }

    await ctx.ei.updatePersona(targetName, { is_paused: false, pause_until: undefined });
    ctx.showNotification(`Resumed ${targetName}`, "info");
  },
};
