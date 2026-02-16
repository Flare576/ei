import type { Command } from "./registry.js";
import { openPersonaEditor } from "../util/persona-editor.js";

export const detailsCommand: Command = {
  name: "details",
  aliases: ["d"],
  description: "Edit persona details in $EDITOR",
  usage: "/details [persona] - Edit specified or current persona",
  
  async execute(args, ctx) {
    // Use argument if provided, otherwise fall back to active persona
    let personaName = args.length > 0 ? args.join(" ") : ctx.ei.activePersona();
    
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
