import type { Command } from "./registry.js";

export const editorCommand: Command = {
  name: "editor",
  aliases: ["e", "edit"],
  description: "Edit current input in $EDITOR (use Ctrl+E instead)",
  usage: "/editor - Use Ctrl+E for better experience",
  
  async execute(_args, ctx) {
    ctx.showNotification("Use Ctrl+E to open editor", "info");
  }
};
