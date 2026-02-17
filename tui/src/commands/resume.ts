import type { Command } from "./registry";

export const resumeCommand: Command = {
  name: "resume",
  aliases: ["unpause"],
  description: "Resume a paused persona",
  usage: "/resume [persona]",
  execute: async (args, ctx) => {
    let personaId: string | null;
    
    if (args.length > 0) {
      personaId = await ctx.ei.resolvePersonaName(args.join(" "));
      if (!personaId) {
        ctx.showNotification(`Persona '${args.join(" ")}' not found`, "error");
        return;
      }
    } else {
      personaId = ctx.ei.activePersonaId();
      if (!personaId) {
        ctx.showNotification("No persona selected", "error");
        return;
      }
    }

    const persona = ctx.ei.personas().find(p => p.id === personaId);
    if (!persona) {
      ctx.showNotification("Persona not found", "error");
      return;
    }
    
    if (!persona.is_paused) {
      ctx.showNotification(`${persona.display_name} is not paused`, "warn");
      return;
    }

    await ctx.ei.updatePersona(personaId, { is_paused: false, pause_until: undefined });
    ctx.showNotification(`Resumed ${persona.display_name}`, "info");
  },
};
