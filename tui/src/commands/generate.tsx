import type { Command } from "./registry";
import { ConfirmOverlay } from "../components/ConfirmOverlay";
import { GeneratedDocsOverlay } from "../components/GeneratedDocsOverlay";

async function doGenerate(subject: string, ctx: Parameters<Command["execute"]>[1]): Promise<void> {
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

  ctx.showNotification(`Generating knowledge document about: ${subject.slice(0, 60)}`, "info");

  try {
    await ctx.ei.generateDocument(subject);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    ctx.showNotification(`Generation failed: ${message}`, "error");
  }
}

async function writeDoc(slug: string, ctx: Parameters<Command["execute"]>[1]): Promise<void> {
  const outPath = await ctx.ei.writeGeneratedDocument(slug);
  if (!outPath) {
    ctx.showNotification(`No content found for document "${slug}"`, "error");
    return;
  }
  ctx.showNotification(`Written to ${outPath}`, "info");
}

export const generateCommand: Command = {
  name: "generate",
  aliases: [],
  description: "Generate a knowledge document | /generate <subject> to create, /generate to manage",
  usage: "/generate [subject description]",

  async execute(args, ctx) {
    if (args.length === 0) {
      const human = await ctx.ei.getHuman();
      const docs = human.settings?.document?.processed_documents ?? {};
      const generated = Object.entries(docs)
        .filter(([, r]) => r.type === "generated" && r.subject)
        .sort(([, a], [, b]) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
        .map(([slug, r]) => ({ slug, subject: r.subject!, created_at: r.created_at }));

      if (generated.length === 0) {
        ctx.showNotification(
          "No generated documents yet. Use /generate <subject description> to create one.",
          "info"
        );
        return;
      }

      ctx.showOverlay((hideOverlay) => (
        <GeneratedDocsOverlay
          docs={generated}
          onWrite={async (doc) => {
            hideOverlay();
            await writeDoc(doc.slug, ctx);
          }}
          onReRun={async (doc) => {
            hideOverlay();
            ctx.showNotification(`Re-running generation for: ${doc.subject.slice(0, 60)}`, "info");
            try {
              await ctx.ei.reRunDocument(doc.slug);
            } catch (err) {
              const message = err instanceof Error ? err.message : String(err);
              ctx.showNotification(`Re-run failed: ${message}`, "error");
            }
          }}
          onDismiss={hideOverlay}
        />
      ), ctx.renderer);
      return;
    }

    await doGenerate(args.join(" "), ctx);
  },
};
