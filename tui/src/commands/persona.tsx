import type { Command } from "./registry";
import type { PersonaSummary } from "../../../src/core/types.js";
import { PersonaListOverlay } from "../components/PersonaListOverlay";
import { ConfirmOverlay } from "../components/ConfirmOverlay";

// Helper: Find persona by partial match (exact > starts-with > contains)
function findPersona(name: string, personas: PersonaSummary[]): PersonaSummary | null {
  const lower = name.toLowerCase();
  // Exact match
  let match = personas.find(p => p.name.toLowerCase() === lower);
  if (match) return match;
  // Starts with
  match = personas.find(p => p.name.toLowerCase().startsWith(lower));
  if (match) return match;
  // Contains
  return personas.find(p => p.name.toLowerCase().includes(lower)) || null;
}

export const personaCommand: Command = {
  name: "persona",
  aliases: ["p"],
  description: "Switch persona or list all personas",
  usage: "/persona [name]",
  
  async execute(args, ctx) {
    const unarchived = ctx.ei.personas().filter(p => !p.is_archived);
    
    if (args.length === 0) {
      // Show persona list overlay
      ctx.showOverlay((hideOverlay) => (
        <PersonaListOverlay
          personas={unarchived}
          activePersona={ctx.ei.activePersona()}
          onSelect={(name) => {
            ctx.ei.selectPersona(name);
            hideOverlay();
            ctx.showNotification(`Switched to ${name}`, "info");
          }}
          onDismiss={hideOverlay}
        />
      ));
      return;
    }
    
    const name = args.join(" ");
    const match = findPersona(name, unarchived);
    
    if (match) {
      ctx.ei.selectPersona(match.name);
      ctx.showNotification(`Switched to ${match.name}`, "info");
    } else {
      // Prompt to create
      ctx.showOverlay((hideOverlay) => (
        <ConfirmOverlay
          message={`Create persona '${name}'?`}
          onConfirm={async () => {
            await ctx.ei.createPersona({ name });
            ctx.ei.selectPersona(name);
            hideOverlay();
            ctx.showNotification(`Created and switched to ${name}`, "info");
          }}
          onCancel={() => {
            hideOverlay();
            ctx.showNotification("Cancelled", "info");
          }}
        />
      ));
    }
  }
};
