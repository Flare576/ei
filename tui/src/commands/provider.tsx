import type { Command } from "./registry";

import { ModelListOverlay, type ModelListItem } from "../components/ModelListOverlay";
import { createProviderViaEditor, openProviderEditor } from "../util/provider-editor.js";
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

async function getActiveModelGuid(ctx: Parameters<Command["execute"]>[1]): Promise<string | null> {
  const personaId = ctx.ei.activePersonaId();
  if (!personaId) return null;
  const persona = await ctx.ei.getPersona(personaId);
  return persona?.model ?? null;
}

async function assignModelGuid(
  guid: string,
  display: string,
  ctx: Parameters<Command["execute"]>[1]
): Promise<void> {
  const personaId = ctx.ei.activePersonaId();
  if (!personaId) {
    ctx.showNotification("No persona selected", "error");
    return;
  }
  await ctx.ei.updatePersona(personaId, { model: guid });
  ctx.showNotification(`Model set to ${display}`, "info");
}

export async function openModelOverlay(ctx: Parameters<Command["execute"]>[1]): Promise<void> {
  const models = await buildModelList(ctx);

  if (models.length === 0) {
    ctx.showNotification("No models configured. Use /provider new to create one.", "info");
    return;
  }

  const activeGuid = await getActiveModelGuid(ctx);

  ctx.showOverlay((hideOverlay, hideForEditor) => (
    <ModelListOverlay
      models={models}
      activeModelGuid={activeGuid}
      onSelect={async (item) => {
        hideOverlay();
        await assignModelGuid(item.guid, item.display, ctx);
      }}
      onEdit={async (item) => {
        hideForEditor();
        const human = await ctx.ei.getHuman();
        const account = human.settings?.accounts?.find((a: ProviderAccount) => a.id === item.providerId);
        if (account) {
          await openProviderEditor(account, ctx);
        }
      }}
      onNew={async () => {
        hideOverlay();
        await createProviderViaEditor(ctx);
      }}
      onDismiss={hideOverlay}
    />
  ), ctx.renderer);
}

export const providerCommand: Command = {
  name: "provider",
  aliases: ["providers"],
  description: "Manage LLM providers and models",
  usage: "/provider [new]",

  async execute(args, ctx) {
    if (args.length === 0) {
      await openModelOverlay(ctx);
      return;
    }

    if (args[0].toLowerCase() === "new") {
      await createProviderViaEditor(ctx);
      return;
    }

    ctx.showNotification(`Unknown provider subcommand: ${args[0]}. Use /provider or /provider new.`, "warn");
  }
};
