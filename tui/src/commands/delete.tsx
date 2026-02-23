import type { Command } from "./registry";
import { PersonaListOverlay } from "../components/PersonaListOverlay";
import { ConfirmOverlay } from "../components/ConfirmOverlay";

export const deleteCommand: Command = {
  name: "delete",
  aliases: ["del"],
  description: "*Permanently* delete a persona",
  usage: "/delete [name]",
  
  async execute(args, ctx) {
    const allPersonas = ctx.ei.personas();
    const deletable = allPersonas.filter(p => p.id !== ctx.ei.activePersonaId());
    
    const confirmAndDelete = async (personaId: string, displayName: string) => {
      const confirmed = await new Promise<boolean>((resolve) => {
        ctx.showOverlay((hideOverlay) => (
          <ConfirmOverlay
            message={`Delete "${displayName}"?\nThis cannot be undone.`}
            onConfirm={() => { hideOverlay(); resolve(true); }}
            onCancel={() => { hideOverlay(); resolve(false); }}
          />
        ));
      });
      
      if (confirmed) {
        await ctx.ei.deletePersona(personaId);
        ctx.showNotification(`Deleted ${displayName}`, "info");
      } else {
        ctx.showNotification("Cancelled", "info");
      }
    };
    
    if (args.length === 0) {
      if (deletable.length === 0) {
        ctx.showNotification("No personas available to delete", "info");
        return;
      }
      ctx.showOverlay((hideOverlay) => (
        <PersonaListOverlay
          personas={deletable}
          activePersonaId={null}
          title="Select persona to delete"
          onSelect={async (personaId) => {
            const persona = deletable.find(p => p.id === personaId);
            hideOverlay();
            await confirmAndDelete(personaId, persona?.display_name ?? personaId);
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
    
    if (personaId === ctx.ei.activePersonaId()) {
      ctx.showNotification("Cannot delete active persona. Switch to another first.", "error");
      return;
    }
    
    const persona = allPersonas.find(p => p.id === personaId);
    await confirmAndDelete(personaId, persona?.display_name ?? nameOrAlias);
  }
};
