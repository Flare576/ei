import type { Command } from "./registry";

export const quitCommand: Command = {
  name: "quit",
  aliases: ["q"],
  description: "Exit the application",
  usage: "/quit or /q (add ! or 'force' to force quit without syncing)",
  execute: async (args, ctx) => {
    const forceQuit = args.includes("--force") || args.includes("force");
    
    if (forceQuit) {
      ctx.showNotification("Force quitting...", "info");
      await ctx.stopProcessor();
      ctx.renderer.setTerminalTitle("");
      ctx.renderer.destroy();
      process.exit(0);
    }

    ctx.showNotification("Saving and syncing...", "info");
    await ctx.exitApp();
  },
};
