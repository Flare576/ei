import type { Command } from "./registry.js";
import { spawnEditor } from "../util/editor.js";
import { quotesToYAML, quotesFromYAML } from "../util/yaml-serializers.js";
import { logger } from "../util/logger.js";
import { ConfirmOverlay } from "../components/ConfirmOverlay.js";
import { QuotesOverlay } from "../components/QuotesOverlay.js";
import type { Quote } from "../../../src/core/types.js";

async function openQuotesInEditor(
  ctx: Parameters<Command["execute"]>[1],
  quotes: Quote[],
  label: string
): Promise<void> {
  if (quotes.length === 0) {
    ctx.showNotification(`No ${label} found`, "info");
    return;
  }

  let yamlContent = quotesToYAML(quotes);
  let editorIteration = 0;

  while (true) {
    editorIteration++;
    logger.debug("[quotes] starting editor iteration", { iteration: editorIteration });

    const result = await spawnEditor({
      initialContent: yamlContent,
      filename: "quotes.yaml",
      renderer: ctx.renderer,
    });

    logger.debug("[quotes] editor returned", {
      iteration: editorIteration,
      aborted: result.aborted,
      success: result.success,
      hasContent: result.content !== null,
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

    try {
      const parsed = quotesFromYAML(result.content);

      for (const id of parsed.deletedQuoteIds) {
        await ctx.ei.removeQuote(id);
      }

      for (const quote of parsed.quotes) {
        await ctx.ei.updateQuote(quote.id, quote);
      }

      const deleteCount = parsed.deletedQuoteIds.length;
      const updateCount = parsed.quotes.length;

      ctx.showNotification(`Updated ${updateCount} quotes, deleted ${deleteCount}`, "info");
      return;
    } catch (parseError) {
      const errorMsg = parseError instanceof Error ? parseError.message : String(parseError);
      logger.debug("[quotes] YAML parse error, prompting for re-edit", {
        iteration: editorIteration,
        error: errorMsg,
      });

      const shouldReEdit = await new Promise<boolean>((resolve) => {
        ctx.showOverlay((hideOverlay) => (
          <ConfirmOverlay
            message={`YAML parse error:\n${errorMsg}\n\nRe-edit?`}
            onConfirm={() => {
              logger.debug("[quotes] user confirmed re-edit");
              hideOverlay();
              resolve(true);
            }}
            onCancel={() => {
              logger.debug("[quotes] user cancelled re-edit");
              hideOverlay();
              resolve(false);
            }}
          />
        ));
      });

      logger.debug("[quotes] shouldReEdit", { shouldReEdit, iteration: editorIteration });

      if (shouldReEdit) {
        yamlContent = result.content;
        logger.debug("[quotes] continuing to next iteration");
        await new Promise((r) => setTimeout(r, 50));
        continue;
      } else {
        ctx.showNotification("Changes discarded", "info");
        return;
      }
    }
  }
}

export const quotesCommand: Command = {
  name: "quotes",
  aliases: ["quote"],
  description: "Manage quotes",
  usage: "/quotes [N | search \"term\" | me | <persona>]",

  async execute(args, ctx) {
    if (args.length === 0) {
      const all = await ctx.ei.getQuotes();
      await openQuotesInEditor(ctx, all, "quotes");
      return;
    }

    if (args[0] === "search" && args.length > 1) {
      const term = args.slice(1).join(" ").replace(/^"|"$/g, "");
      const results = await ctx.ei.searchHumanData(term, { types: ["quote"], limit: 20 });
      await openQuotesInEditor(ctx, results.quotes, `quotes matching "${term}"`);
      return;
    }

    if (args[0] === "me") {
      const humanQuotes = await ctx.ei.getQuotes({ speaker: "human" });
      await openQuotesInEditor(ctx, humanQuotes, "your quotes");
      return;
    }

    if (/^\d+$/.test(args[0])) {
      const index = parseInt(args[0], 10);
      const messages = ctx.ei.messages();
      
      if (index < 1 || index > messages.length) {
        ctx.showNotification(`No message at index [${index}]`, "error");
        return;
      }

      const targetMessage = messages[index - 1];
      const allQuotes = await ctx.ei.getQuotes();
      const messageQuotes = allQuotes.filter(q => q.message_id === targetMessage.id);

      ctx.showOverlay((hide) => (
        <QuotesOverlay
          quotes={messageQuotes}
          messageIndex={index}
          onClose={hide}
          onEdit={async () => {
            hide();
            await new Promise((r) => setTimeout(r, 50));
            await openQuotesInEditor(ctx, messageQuotes, `quotes from message [${index}]`);
          }}
          onDelete={async (quoteId) => {
            await ctx.ei.removeQuote(quoteId);
            ctx.showNotification("Quote deleted", "info");
          }}
        />
      ));
      return;
    }

    const speaker = args.join(" ");
    const speakerQuotes = await ctx.ei.getQuotes({ speaker });
    await openQuotesInEditor(ctx, speakerQuotes, `${speaker}'s quotes`);
  },
};
