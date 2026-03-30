import type { Command } from "./registry";
import { openModelOverlay } from "./provider.js";
import type { ModelListItem } from "../components/ModelListOverlay.js";
import type { ProviderAccount } from "../../../src/core/types.js";

async function buildModelList(ctx: Parameters<Command["execute"]>[1]): Promise<ModelListItem[]> {
  const human = await ctx.ei.getHuman();
  const accounts = (human.settings?.accounts ?? []).filter(
    (a: ProviderAccount) => a.type === "llm" && a.enabled !== false
  );
  const items: ModelListItem[] = [];
  for (const account of accounts) {
    for (const model of account.models ?? []) {
      items.push({
        display: `${account.name}:${model.name}`,
        guid: model.id,
        providerId: account.id,
      });
    }
  }
  return items;
}

export const modelCommand: Command = {
  name: "model",
  aliases: [],
  description: "Set the LLM model for the current persona",
  usage: "/model | /model Provider:model",
  execute: async (args, ctx) => {
    const personaId = ctx.ei.activePersonaId();
    if (!personaId) {
      ctx.showNotification("No persona selected", "error");
      return;
    }

    if (args.length === 0) {
      await openModelOverlay(ctx);
      return;
    }

    const modelSpec = args.join(" ");

    const models = await buildModelList(ctx);

    const match = models.find(
      (m) => m.display.toLowerCase() === modelSpec.toLowerCase()
    );

    if (match) {
      await ctx.ei.updatePersona(personaId, { model: match.guid });
      ctx.showNotification(`Model set to ${match.display}`, "info");
      return;
    }

    ctx.showNotification(
      `Invalid model. Use /model or /providers to see available models.`,
      "error"
    );
  },
};
