import type { Command } from "./registry";

import { ProviderListOverlay, type ProviderListItem } from "../components/ProviderListOverlay";
import { createProviderViaEditor, openProviderEditor } from "../util/provider-editor.js";

/**
 * Build provider list from user's ProviderAccount settings.
 */
async function getProviderList(ctx: Parameters<Command["execute"]>[1]): Promise<ProviderListItem[]> {
  const human = await ctx.ei.getHuman();
  const accounts = human.settings?.accounts?.filter(a => a.type === "llm") ?? [];
  
  return accounts.map(acc => ({
    id: acc.id,
    displayName: acc.name,
    key: acc.name,
    defaultModel: acc.default_model,
    enabled: acc.enabled ?? true,
  }));
}

/**
 * Extract the provider key from a persona's current model spec.
 * "Local LLM:llama-3" -> "Local LLM"
 * "Local LLM" -> "Local LLM"
 * undefined -> null
 */
function getActiveProviderKey(model?: string): string | null {
  if (!model) return null;
  return model.includes(":") ? model.split(":")[0] : model;
}

/**
 * Set a provider (with optional default model) on the active persona.
 */
async function setProviderOnPersona(
  providerKey: string,
  defaultModel: string | undefined,
  ctx: Parameters<Command["execute"]>[1]
): Promise<void> {
  const personaId = ctx.ei.activePersonaId();
  if (!personaId) {
    ctx.showNotification("No persona selected", "error");
    return;
  }
  
  const modelSpec = defaultModel ? `${providerKey}:${defaultModel}` : providerKey;
  await ctx.ei.updatePersona(personaId, { model: modelSpec });
  ctx.showNotification(`Provider set to ${modelSpec}`, "info");
}

/**
 * Find a matching provider by name (case-insensitive).
 */
function findProvider(providers: ProviderListItem[], name: string): ProviderListItem | undefined {
  const lower = name.toLowerCase();
  return providers.find(p => 
    p.key.toLowerCase() === lower || p.displayName.toLowerCase() === lower
  );
}

export const providerCommand: Command = {
  name: "provider",
  aliases: ["providers"],
  description: "Manage LLM providers, set provider for current persona",
  usage: "/provider [name] | /provider new",
  
  async execute(args, ctx) {
    const personaId = ctx.ei.activePersonaId();
    const persona = personaId ? await ctx.ei.getPersona(personaId) : null;
    const activeKey = getActiveProviderKey(persona?.model);
    const providers = await getProviderList(ctx);
    
    // No args -> show overlay
    if (args.length === 0) {
      if (providers.length === 0) {
        ctx.showNotification("No providers configured. Use /provider new to create one.", "info");
        return;
      }
      ctx.showOverlay((hideOverlay) => (
        <ProviderListOverlay
          providers={providers}
          activeProviderKey={activeKey}
          onSelect={async (provider) => {
            hideOverlay();
            await setProviderOnPersona(provider.key, provider.defaultModel, ctx);
          }}
          onEdit={async (provider) => {
            hideOverlay();
            await new Promise(r => setTimeout(r, 50));
            const human = await ctx.ei.getHuman();
            const account = human.settings?.accounts?.find(a => a.id === provider.id);
            if (account) {
              await openProviderEditor(account, ctx);
            }
          }}
          onNew={async () => {
            hideOverlay();
            await new Promise(r => setTimeout(r, 50));
            await createProviderViaEditor(ctx);
          }}
          onDismiss={hideOverlay}
        />
      ));
      return;
    }
    
    // /provider new
    if (args[0].toLowerCase() === "new") {
      await createProviderViaEditor(ctx);
      return;
    }
    
    // /provider <name> -> set that provider directly
    const name = args.join(" ");
    const match = findProvider(providers, name);
    
    if (match) {
      await setProviderOnPersona(match.key, match.defaultModel, ctx);
    } else {
      ctx.showNotification(`No provider named "${name}". Run \`/provider new\` to create.`, "warn");
    }
  }
};
