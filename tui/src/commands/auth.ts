import type { Command } from "./registry.js";
import { runSpotifyAuth } from "./spotify-auth.js";
import { runSlackAuth } from "./slack-auth.js";

export const authCommand: Command = {
  name: "auth",
  aliases: [],
  description: "Authenticate with a service (e.g. /auth spotify)",
  usage: "/auth <service>  — supported: spotify, slack",

  async execute(args, ctx) {
    const service = args[0]?.toLowerCase();

    if (!service) {
      ctx.showNotification("Usage: /auth <service>  (supported: spotify, slack)", "error");
      return;
    }

    switch (service) {
      case "spotify":
        await runSpotifyAuth(ctx);
        break;
      case "slack":
        await runSlackAuth(ctx);
        break;
      default:
        ctx.showNotification(`Unknown service: ${service}. Supported: spotify, slack`, "error");
    }
  },
};
