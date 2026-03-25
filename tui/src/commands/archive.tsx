import type { Command } from "./registry";
import { ArchivedItemsOverlay } from "../components/ArchivedItemsOverlay";

export const archiveCommand: Command = {
  name: "archive",
  aliases: [],
  description: "Archive a persona or list archived personas and rooms",
  usage: "/archive [name]",
  
  async execute(args, ctx) {
    const allPersonas = ctx.ei.personas();
    const archivedPersonas = allPersonas.filter(p => p.is_archived);
    
    if (args.length === 0) {
      const archivedRooms = ctx.ei.getArchivedRooms();
      if (archivedPersonas.length === 0 && archivedRooms.length === 0) {
        ctx.showNotification("No archived personas or rooms", "info");
        return;
      }
      ctx.showOverlay((hideOverlay, _hideForEditor) => (
        <ArchivedItemsOverlay
          personas={archivedPersonas}
          rooms={archivedRooms}
          onSelect={async (item) => {
            hideOverlay();
            if (item.kind === "persona") {
              await ctx.ei.unarchivePersona(item.id);
              ctx.ei.selectPersona(item.id);
              ctx.showNotification(`Unarchived and switched to ${item.display_name}`, "info");
            } else {
              await ctx.ei.updateRoom(item.id, { is_archived: false });
              ctx.ei.selectRoom(item.id);
              ctx.showNotification(`Room "${item.display_name}" unarchived`, "info");
            }
          }}
          onDismiss={hideOverlay}
        />
      ), ctx.renderer);
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
  description: "Unarchive a persona or room and switch to it",
  usage: "/unarchive <name>",
  
  async execute(args, ctx) {
    if (args.length === 0) {
      ctx.showNotification("Usage: /unarchive <name>", "warn");
      return;
    }
    
    const nameOrAlias = args.join(" ");
    const personaId = await ctx.ei.resolvePersonaName(nameOrAlias);
    
    if (personaId) {
      const persona = ctx.ei.personas().find(p => p.id === personaId);
      
      if (!persona?.is_archived) {
        ctx.showNotification(`'${persona?.display_name ?? nameOrAlias}' is not archived`, "warn");
        return;
      }
      
      await ctx.ei.unarchivePersona(personaId);
      ctx.ei.selectPersona(personaId);
      ctx.showNotification(`Unarchived and switched to ${persona.display_name}`, "info");
      return;
    }
    
    const roomId = ctx.ei.resolveRoomName(nameOrAlias);
    if (roomId) {
      const room = ctx.ei.getRoom(roomId);
      if (!room?.is_archived) {
        ctx.showNotification(`Room '${room?.display_name ?? nameOrAlias}' is not archived`, "warn");
        return;
      }
      await ctx.ei.updateRoom(roomId, { is_archived: false });
      ctx.ei.selectRoom(roomId);
      ctx.showNotification(`Room "${room?.display_name ?? nameOrAlias}" unarchived`, "info");
      return;
    }
    
    ctx.showNotification(`Archived persona or room '${nameOrAlias}' not found`, "error");
  }
};
