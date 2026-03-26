import type { Command } from "./registry.js";
import { openPersonaEditor } from "../util/persona-editor.js";
import { openRoomEditor } from "../util/room-editor.js";

export const detailsCommand: Command = {
  name: "details",
  aliases: ["d"],
  description: "Edit persona details in $EDITOR",
  usage: "/details [persona] - Edit specified or current persona",
  
  async execute(args, ctx) {
    if (args.length === 0 && ctx.ei.activeRoomId()) {
      const roomId = ctx.ei.activeRoomId()!;
      await openRoomEditor({ roomId, ctx });
      return;
    }

    let personaId: string | null;
    
    if (args.length > 0) {
      const nameOrAlias = args.join(" ");
      personaId = await ctx.ei.resolvePersonaName(nameOrAlias);
      if (!personaId) {
        ctx.showNotification(`Persona "${nameOrAlias}" not found`, "error");
        return;
      }
    } else {
      personaId = ctx.ei.activePersonaId();
    }
    
    if (!personaId) {
      ctx.showNotification("No active persona", "error");
      return;
    }
    
    const persona = await ctx.ei.getPersona(personaId);
    if (!persona) {
      ctx.showNotification(`Persona not found`, "error");
      return;
    }
    
    await openPersonaEditor({
      personaId,
      persona,
      ctx,
    });
  }
};
