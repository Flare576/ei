import type { Command } from "./registry.js";
import { runSpotifyAuth } from "./spotify-auth.js";

export const authCommand: Command = {
  name: "auth",
  aliases: [],
  description: "Authenticate with a service (e.g. /auth spotify)",
  usage: "/auth <service>  — supported: spotify",

  async execute(args, ctx) {
    const service = args[0]?.toLowerCase();

    if (!service) {
      ctx.showNotification("Usage: /auth <service>  (supported: spotify)", "error");
      return;
    }

    switch (service) {
      case "spotify":
        await runSpotifyAuth(ctx);
        break;
      default:
        ctx.showNotification(`Unknown service: ${service}. Supported: spotify`, "error");
    }
  },
};
