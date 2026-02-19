import type { Command } from "./registry.js";
import { spawnEditor } from "../util/editor.js";

export const editorCommand: Command = {
  name: "editor",
  aliases: ["e", "edit"],
  description: "Open $EDITOR",
  usage: "/editor - Opens editor (Ctrl+E preserves current input)",
  
  async execute(_args, ctx) {
    if (!ctx.renderer) {
      ctx.showNotification("Editor not available", "error");
      return;
    }
    
    let currentText = ctx.getInputText();
    
    if (currentText.startsWith("/editor") || currentText.startsWith("/edit") || currentText.startsWith("/e")) {
      currentText = "";
    }
    
    const result = await spawnEditor({
      initialContent: currentText,
      filename: "message.txt",
      renderer: ctx.renderer,
    });
    
    if (result.aborted) {
      ctx.showNotification("Editor cancelled", "info");
      return;
    }
    
    if (!result.success) {
      ctx.showNotification("Editor failed to open", "error");
      return;
    }
    
    if (result.content === null) {
      ctx.showNotification("No changes made", "info");
      return;
    }
    
    ctx.setInputText(result.content.trimEnd());
    ctx.showNotification("Input updated from editor", "info");
  }
};
