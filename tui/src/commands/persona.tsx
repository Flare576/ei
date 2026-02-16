import type { Command } from "./registry";
import type { PersonaSummary } from "../../../src/core/types.js";
import { isReservedPersonaName } from "../../../src/core/types.js";
import { PersonaListOverlay } from "../components/PersonaListOverlay";
import { createPersonaViaEditor } from "../util/persona-editor.js";

function findPersona(name: string, personas: PersonaSummary[]): PersonaSummary | null {
  const lower = name.toLowerCase();
  let match = personas.find(p => p.name.toLowerCase() === lower);
  if (match) return match;
  match = personas.find(p => p.name.toLowerCase().startsWith(lower));
  if (match) return match;
  return personas.find(p => p.name.toLowerCase().includes(lower)) || null;
}

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
    
    const name = args.join(" ");
    const match = findPersona(name, unarchived);
    
    if (match) {
      ctx.ei.selectPersona(match.name);
      ctx.showNotification(`Switched to ${match.name}`, "info");
    } else {
      ctx.showNotification(`No persona named "${name}". Run \`/p new ${name}\` to create.`, "warn");
    }
  }
};
