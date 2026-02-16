import type { Command } from "./registry.js";
import { openPersonaEditor } from "../util/persona-editor.js";

export const detailsCommand: Command = {
  name: "details",
  aliases: ["d"],
  description: "Edit current persona details in $EDITOR",
  usage: "/details",
  
  async execute(_args, ctx) {
    const personaName = ctx.ei.activePersona();
    if (!personaName) {
      ctx.showNotification("No active persona", "error");
      return;
    }
    
    const persona = await ctx.ei.getPersona(personaName);
    if (!persona) {
      ctx.showNotification(`Persona "${personaName}" not found`, "error");
      return;
    }
    
    await openPersonaEditor({
      personaName,
      persona,
      ctx,
    });
  }
};
