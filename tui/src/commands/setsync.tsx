import type { Command } from "./registry.js";
import { ConfirmOverlay } from "../components/ConfirmOverlay.js";

export const setSyncCommand: Command = {
  name: "setsync",
  aliases: ["ss"],
  description: "Set sync credentials (requires restart)",
  usage: "/setsync <username> <passphrase>",

  async execute(args, ctx) {
    if (args.length < 2) {
      ctx.showNotification("Usage: /setsync <username> <passphrase>", "error");
      return;
    }

    const [username, passphrase] = args;

    const confirmed = await new Promise<boolean>((resolve) => {
      ctx.showOverlay((hideOverlay) => (
        <ConfirmOverlay
          message={`Set sync credentials for "${username}"?\n\nThis requires a restart. Just re-run ei once it closes!`}
          onConfirm={() => {
            hideOverlay();
            resolve(true);
          }}
          onCancel={() => {
            hideOverlay();
            resolve(false);
          }}
        />
      ));
    });

    if (!confirmed) {
      ctx.showNotification("Sync setup cancelled", "info");
      return;
    }

    await ctx.ei.updateSettings({ sync: { username, passphrase } });
    ctx.showNotification("Sync credentials saved, restarting...", "info");
    await ctx.exitApp();
  },
};
