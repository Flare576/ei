import type { Command } from "./registry";
import type { PersonaSummary } from "../../../src/core/types.js";
import { PersonaListOverlay } from "../components/PersonaListOverlay";

function findPersonaByName(name: string, personas: PersonaSummary[]): PersonaSummary | null {
  const lower = name.toLowerCase();
  return personas.find(p => p.name.toLowerCase() === lower) || null;
}

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
          activePersona={null}
          title="Archived Personas (Enter to unarchive)"
          onSelect={async (name) => {
            hideOverlay();
            await ctx.ei.unarchivePersona(name);
            ctx.ei.selectPersona(name);
            ctx.showNotification(`Unarchived and switched to ${name}`, "info");
          }}
          onDismiss={hideOverlay}
        />
      ));
      return;
    }
    
    const name = args.join(" ");
    const persona = findPersonaByName(name, allPersonas);
    
    if (!persona) {
      ctx.showNotification(`Persona '${name}' not found`, "error");
      return;
    }
    
    if (persona.is_archived) {
      ctx.showNotification(`'${persona.name}' is already archived`, "warn");
      return;
    }
    
    if (ctx.ei.activePersona() === persona.name) {
      ctx.showNotification("Cannot archive active persona", "error");
      return;
    }
    
    await ctx.ei.archivePersona(persona.name);
    ctx.showNotification(`Archived ${persona.name}`, "info");
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
    
    const name = args.join(" ");
    const archived = ctx.ei.personas().filter(p => p.is_archived);
    const persona = findPersonaByName(name, archived);
    
    if (!persona) {
      ctx.showNotification(`Archived persona '${name}' not found`, "error");
      return;
    }
    
    await ctx.ei.unarchivePersona(persona.name);
    ctx.ei.selectPersona(persona.name);
    ctx.showNotification(`Unarchived and switched to ${persona.name}`, "info");
  }
};
