import type { Command } from "./registry";
import { ConfirmOverlay } from "../components/ConfirmOverlay";

export const generateCommand: Command = {
  name: "generate",
  aliases: [],
  description: "Generate a knowledge document about a subject",
  usage: "/generate <subject description>",

  async execute(args, ctx) {
    if (args.length === 0) {
      ctx.showNotification("Usage: /generate <subject description>", "warn");
      return;
    }

    const subject = args.join(" ");

    const { model, isRewriteModel } = ctx.ei.checkGenerationModel();

    if (!isRewriteModel) {
      const confirmed = await new Promise<boolean>((resolve) => {
        const msg = [
          `Generating with your default model (${model}).`,
          "A high-capability model (Opus-class) is recommended.",
          "Set one via /settings → rewrite_model, or continue anyway?",
        ].join("\n");

        ctx.showOverlay((hideOverlay) => (
          <ConfirmOverlay
            message={msg}
            onConfirm={() => { hideOverlay(); resolve(true); }}
            onCancel={() => { hideOverlay(); resolve(false); }}
          />
        ), ctx.renderer);
      });

      if (!confirmed) {
        ctx.showNotification("Cancelled", "info");
        return;
      }
    }

    const dataPath = process.env.EI_DATA_PATH || "~/.local/share/ei";
    const outputPath = `${dataPath}/docs/${subject.slice(0, 40).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}_${new Date().toISOString().replace(/[:.]/g, "-")}.md`;

    ctx.showNotification(`Generating — will write to ${outputPath} when complete`, "info");

    try {
      await ctx.ei.generateDocument(subject);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      ctx.showNotification(`Generation failed: ${message}`, "error");
    }
  },
};
