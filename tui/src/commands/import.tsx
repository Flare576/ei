import type { Command } from "./registry";

export const importCommand: Command = {
  name: "import",
  aliases: [],
  description: "Import a document into Ei's knowledge base",
  usage: "/import <path/to/document>",

  async execute(args, ctx) {
    if (args.length === 0) {
      ctx.showNotification("Usage: /import <path/to/document>", "warn");
      return;
    }

    const filePath = args.join(" ");

    ctx.showNotification(`Importing ${filePath}...`, "info");

    try {
      const result = await ctx.ei.importDocument(filePath);
      ctx.showNotification(
        `Importing ${result.documentName} — ${result.chunksQueued} chunk(s) queued for segmentation`,
        "info"
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      ctx.showNotification(`Import failed: ${message}`, "error");
    }
  },
};
