import type { Command } from "./registry";
import { isReservedPersonaName } from "../../../src/core/types.js";
import { PersonaListOverlay } from "../components/PersonaListOverlay";
import { createPersonaViaEditor } from "../util/persona-editor.js";

export const personaCommand: Command = {
  name: "persona",
  aliases: ["p"],
  description: "Switch persona, list all, or create new",
  usage: "/persona [name] | /persona new <name>",
  
  async execute(args, ctx) {
    const unarchived = ctx.ei.personas().filter(p => !p.is_archived);
    
    if (args.length === 0) {
      ctx.showOverlay((hideOverlay) => (
        <PersonaListOverlay
          personas={unarchived}
          activePersonaId={ctx.ei.activePersonaId()}
          onSelect={(personaId) => {
            const persona = unarchived.find(p => p.id === personaId);
            ctx.ei.selectPersona(personaId);
            hideOverlay();
            ctx.showNotification(`Switched to ${persona?.display_name ?? personaId}`, "info");
          }}
          onDismiss={hideOverlay}
        />
      ));
      return;
    }
    
    if (args[0].toLowerCase() === "new") {
      if (args.length < 2) {
        ctx.showNotification("Usage: /p new <name>", "error");
        return;
      }
      const personaName = args.slice(1).join(" ");
      if (isReservedPersonaName(personaName)) {
        ctx.showNotification(`Cannot use reserved name "${personaName}"`, "error");
        return;
      }
      await createPersonaViaEditor({ personaName, ctx });
      return;
    }
    
    // User typed a name - resolve it to ID, then switch
    const nameOrAlias = args.join(" ");
    const personaId = await ctx.ei.resolvePersonaName(nameOrAlias);
    
    if (personaId) {
      const persona = unarchived.find(p => p.id === personaId);
      ctx.ei.selectPersona(personaId);
      ctx.showNotification(`Switched to ${persona?.display_name ?? nameOrAlias}`, "info");
    } else {
      ctx.showNotification(`No persona named "${nameOrAlias}". Run \`/p new ${nameOrAlias}\` to create.`, "warn");
    }
  }
};
