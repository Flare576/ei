import { spawnEditor } from "./editor.js";
import { newProviderToYAML, newProviderFromYAML, providerToYAML, providerFromYAML } from "./yaml-serializers.js";
import type { CommandContext } from "../commands/registry.js";
import type { ProviderAccount, HumanSettings } from "../../../src/core/types.js";
import { logger } from "./logger.js";
import { ConfirmOverlay } from "../components/ConfirmOverlay.js";

export interface NewProviderEditorResult {
  created: boolean;
  account: ProviderAccount | null;
  cancelled: boolean;
}

export interface EditProviderEditorResult {
  success: boolean;
  account: ProviderAccount | null;
  cancelled: boolean;
  deleted?: boolean;
}

export async function createProviderViaEditor(ctx: CommandContext, name?: string): Promise<NewProviderEditorResult> {
  let yamlContent = newProviderToYAML(name);
  
  while (true) {
    const result = await spawnEditor({
      initialContent: yamlContent,
      filename: "new-provider.yaml",
      renderer: ctx.renderer,
    });
    
    if (result.aborted) {
      ctx.showNotification("Creation cancelled", "info");
      return { created: false, account: null, cancelled: true };
    }
    
    if (!result.success) {
      ctx.showNotification("Editor failed to open", "error");
      return { created: false, account: null, cancelled: false };
    }
    
    if (result.content === null) {
      ctx.showNotification("No content - provider not created", "info");
      return { created: false, account: null, cancelled: true };
    }
    
    try {
      const account = newProviderFromYAML(result.content);
      
      if ((account.models ?? []).length === 0) {
        throw new Error("Provider must have at least one model. Add a model under the models: section.");
      }
      
      const human = await ctx.ei.getHuman();
      const accounts = [...(human.settings?.accounts ?? []), account];
      const updates: Partial<HumanSettings> = { accounts };
      
      if (!human.settings?.conversation_model) {
        updates.conversation_model = account.default_model
          ? `${account.name}:${account.default_model}`
          : account.name;
      }
      if (!human.settings?.extraction_model) {
        updates.extraction_model = account.default_model
          ? `${account.name}:${account.default_model}`
          : account.name;
      }
      await ctx.ei.updateSettings(updates);
      
      ctx.showNotification(`Created provider "${account.name}"`, "info");
      return { created: true, account, cancelled: false };
      
    } catch (parseError) {
      const errorMsg = parseError instanceof Error ? parseError.message : String(parseError);
      logger.debug("[provider-editor] YAML parse error in new provider", { error: errorMsg });
      
      const shouldReEdit = await new Promise<boolean>((resolve) => {
        ctx.showOverlay((hideOverlay, hideForEditor) => (
          <ConfirmOverlay
            message={`YAML parse error:\n${errorMsg}\n\nRe-edit?`}
            onConfirm={() => {
              hideForEditor();
              resolve(true);
            }}
            onCancel={() => {
              hideOverlay();
              resolve(false);
            }}
          />
        ), ctx.renderer);
      });
      
      if (shouldReEdit) {
        yamlContent = result.content;
        continue;
      } else {
        ctx.showNotification("Creation cancelled", "info");
        return { created: false, account: null, cancelled: true };
      }
    }
  }
}

export async function openProviderEditor(account: ProviderAccount, ctx: CommandContext): Promise<EditProviderEditorResult> {
  let yamlContent = providerToYAML(account);
  
  while (true) {
    const result = await spawnEditor({
      initialContent: yamlContent,
      filename: `${account.name}-provider.yaml`,
      renderer: ctx.renderer,
    });
    
    if (result.aborted) {
      ctx.showNotification("Editor cancelled", "info");
      return { success: false, account: null, cancelled: true };
    }
    
    if (!result.success) {
      ctx.showNotification("Editor failed to open", "error");
      return { success: false, account: null, cancelled: false };
    }
    
    if (result.content === null) {
      ctx.showNotification("No changes made", "info");
      return { success: true, account, cancelled: false };
    }
    
    try {
      const parseResult = providerFromYAML(result.content, account);
      
      if (parseResult._delete) {
        const human = await ctx.ei.getHuman();
        const accounts = (human.settings?.accounts ?? []).filter(a => a.id !== account.id);
        await ctx.ei.updateSettings({ accounts });
        ctx.showNotification(`Deleted provider "${account.name}"`, "info");
        return { success: true, account: null, cancelled: false, deleted: true };
      }

      const updated = parseResult.account;

      if ((updated.models ?? []).length === 0) {
        throw new Error("Provider must have at least one model. Remove _delete: true from at least one model, or add a new model.");
      }
      
      const human = await ctx.ei.getHuman();
      const accounts = [...(human.settings?.accounts ?? [])];
      const idx = accounts.findIndex(a => a.id === account.id);
      if (idx >= 0) {
        accounts[idx] = updated;
      } else {
        accounts.push(updated);
      }
      await ctx.ei.updateSettings({ accounts });
      
      ctx.showNotification(`Updated provider "${updated.name}"`, "info");
      return { success: true, account: updated, cancelled: false };
      
    } catch (parseError) {
      const errorMsg = parseError instanceof Error ? parseError.message : String(parseError);
      logger.debug("[provider-editor] YAML parse error", { error: errorMsg });
      
      const shouldReEdit = await new Promise<boolean>((resolve) => {
        ctx.showOverlay((hideOverlay, hideForEditor) => (
          <ConfirmOverlay
            message={`YAML parse error:\n${errorMsg}\n\nRe-edit?`}
            onConfirm={() => {
              hideForEditor();
              resolve(true);
            }}
            onCancel={() => {
              hideOverlay();
              resolve(false);
            }}
          />
        ), ctx.renderer);
      });
      
      if (shouldReEdit) {
        yamlContent = result.content;
        continue;
      } else {
        ctx.showNotification("Changes discarded", "info");
        return { success: false, account: null, cancelled: true };
      }
    }
  }
}

