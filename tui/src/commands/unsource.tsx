import type { Command } from "./registry";
import { ConfirmOverlay } from "../components/ConfirmOverlay";
import { PersonaListOverlay } from "../components/PersonaListOverlay";

export const unsourceCommand: Command = {
  name: "unsource",
  aliases: [],
  description: "Remove knowledge extracted from a specific document source",
  usage: "/unsource <sourceTag>",

  async execute(args, ctx) {
    if (args.length === 0) {
      const human = await ctx.ei.getHuman();
      const docs = human.settings?.document?.processed_documents ?? {};
      const sources = Object.keys(docs);

      if (sources.length === 0) {
        ctx.showNotification("No imported documents found. Use /import first.", "warn");
        return;
      }

      const items = sources.map(f => ({
        id: `import:document:${f}`,
        display_name: `import:document:${f}`,
        aliases: [] as string[],
        is_paused: false,
        is_archived: false,
        unread_count: 0,
        has_pending_update: false,
      }));

      ctx.showOverlay((hideOverlay) => (
        <PersonaListOverlay
          personas={items}
          activePersonaId={null}
          title="Select source to unsource"
          onSelect={async (sourceTag) => {
            hideOverlay();
            await unsourceCommand.execute([sourceTag], ctx);
          }}
          onDismiss={hideOverlay}
        />
      ), ctx.renderer);
      return;
    }

    const rawArg = args.join(" ").trim();

    let sourceTag = rawArg;
    if (!rawArg.includes(":")) {
      const human = await ctx.ei.getHuman();
      const docs = human.settings?.document?.processed_documents ?? {};
      const allSources = Object.keys(docs).map(f => `import:document:${f}`);
      const matches = allSources.filter(s => s.endsWith(rawArg) || s.includes(rawArg));
      if (matches.length === 1) {
        sourceTag = matches[0];
      } else if (matches.length > 1) {
        ctx.showNotification(`Ambiguous: "${rawArg}" matches multiple sources. Use /unsource with no args to pick.`, "warn");
        return;
      }
    }

    const preview = ctx.ei.getUnsourcePreview(sourceTag);

    const totalDelete =
      preview.toDelete.facts.length +
      preview.toDelete.topics.length +
      preview.toDelete.people.length;
    const totalStrip =
      preview.toStrip.facts.length +
      preview.toStrip.topics.length +
      preview.toStrip.people.length;

    if (
      totalDelete === 0 &&
      preview.toDelete.quotes.length === 0 &&
      totalStrip === 0
    ) {
      ctx.showNotification(`No knowledge found for source: ${sourceTag}`, "warn");
      return;
    }

    const confirmed = await new Promise<boolean>((resolve) => {
      const msg = [
        `Unsource: ${sourceTag}`,
        "",
        `Delete: ${preview.toDelete.facts.length} facts, ${preview.toDelete.topics.length} topics, ${preview.toDelete.people.length} people, ${preview.toDelete.quotes.length} quotes`,
        `Strip source: ${preview.toStrip.facts.length} facts, ${preview.toStrip.topics.length} topics, ${preview.toStrip.people.length} people`,
        "",
        "This cannot be undone. Proceed? [y/N]",
      ].join("\n");

      ctx.showOverlay((hideOverlay, _hideForEditor) => (
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

    const result = await ctx.ei.executeUnsource(preview);
    const deletedTotal = result.deleted.facts + result.deleted.topics + result.deleted.people + result.deleted.quotes;
    const strippedTotal = result.stripped.facts + result.stripped.topics + result.stripped.people;
    ctx.showNotification(
      `Unsourced ${sourceTag}: deleted ${deletedTotal} items, stripped source from ${strippedTotal} items`,
      "info"
    );
  },
};
