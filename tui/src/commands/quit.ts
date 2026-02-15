import type { Command } from "./registry";

export const quitCommand: Command = {
  name: "quit",
  aliases: ["q"],
  description: "Exit the application",
  usage: "/quit or /q (add ! to force quit without saving)",
  execute: async (args, ctx) => {
    if (args.includes("--force")) {
      ctx.exitApp();
      return;
    }

    ctx.showNotification("Saving...", "info");
    await ctx.stopProcessor();
    ctx.exitApp();
  },
};
