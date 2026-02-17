import type { Command } from "./registry";
import { PersonaListOverlay } from "../components/PersonaListOverlay";

export const archiveCommand: Command = {
  name: "archive",
  aliases: [],
  description: "Archive a persona or list archived personas",
  usage: "/archive [name]",
  
  async execute(args, ctx) {
    const allPersonas = ctx.ei.personas();
    const archived = allPersonas.filter(p => p.is_archived);
    
    if (args.length === 0) {
      if (archived.length === 0) {
        ctx.showNotification("No archived personas", "info");
        return;
      }
      ctx.showOverlay((hideOverlay) => (
        <PersonaListOverlay
          personas={archived}
          activePersonaId={null}
          title="Archived Personas (Enter to unarchive)"
          onSelect={async (personaId) => {
            const persona = archived.find(p => p.id === personaId);
            hideOverlay();
            await ctx.ei.unarchivePersona(personaId);
            ctx.ei.selectPersona(personaId);
            ctx.showNotification(`Unarchived and switched to ${persona?.display_name ?? personaId}`, "info");
          }}
          onDismiss={hideOverlay}
        />
      ));
      return;
    }
    
    const nameOrAlias = args.join(" ");
    const personaId = await ctx.ei.resolvePersonaName(nameOrAlias);
    
    if (!personaId) {
      ctx.showNotification(`Persona '${nameOrAlias}' not found`, "error");
      return;
    }
    
    const persona = allPersonas.find(p => p.id === personaId);
    
    if (persona?.is_archived) {
      ctx.showNotification(`'${persona.display_name}' is already archived`, "warn");
      return;
    }
    
    if (ctx.ei.activePersonaId() === personaId) {
      ctx.showNotification("Cannot archive active persona", "error");
      return;
    }
    
    await ctx.ei.archivePersona(personaId);
    ctx.showNotification(`Archived ${persona?.display_name ?? nameOrAlias}`, "info");
  }
};

export const unarchiveCommand: Command = {
  name: "unarchive",
  aliases: [],
  description: "Unarchive a persona and switch to it",
  usage: "/unarchive <name>",
  
  async execute(args, ctx) {
    if (args.length === 0) {
      ctx.showNotification("Usage: /unarchive <name>", "warn");
      return;
    }
    
    const nameOrAlias = args.join(" ");
    const personaId = await ctx.ei.resolvePersonaName(nameOrAlias);
    
    if (!personaId) {
      ctx.showNotification(`Archived persona '${nameOrAlias}' not found`, "error");
      return;
    }
    
    const persona = ctx.ei.personas().find(p => p.id === personaId);
    
    if (!persona?.is_archived) {
      ctx.showNotification(`'${persona?.display_name ?? nameOrAlias}' is not archived`, "warn");
      return;
    }
    
    await ctx.ei.unarchivePersona(personaId);
    ctx.ei.selectPersona(personaId);
    ctx.showNotification(`Unarchived and switched to ${persona.display_name}`, "info");
  }
};
