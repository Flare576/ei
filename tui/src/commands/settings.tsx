import type { Command } from "./registry.js";
import { spawnEditor } from "../util/editor.js";
import { settingsToYAML, settingsFromYAML, validateModelProvider } from "../util/yaml-serializers.js";
import { logger } from "../util/logger.js";
import { ConfirmOverlay } from "../components/ConfirmOverlay.js";

export const settingsCommand: Command = {
  name: "settings",
  aliases: ["set"],
  description: "Edit your settings in $EDITOR",
  usage: "/settings",
  
  async execute(_args, ctx) {
    const human = await ctx.ei.getHuman();
    let yamlContent = settingsToYAML(human.settings);
    let editorIteration = 0;
    
    while (true) {
      editorIteration++;
      logger.debug("[settings] starting editor iteration", { iteration: editorIteration });
      
      const result = await spawnEditor({
        initialContent: yamlContent,
        filename: "settings.yaml",
        renderer: ctx.renderer,
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
        const newSettings = settingsFromYAML(result.content, human.settings);
        // Validate provider name in default_model (case-insensitive match + auto-correct)
        const llmAccounts = human.settings?.accounts?.filter(a => a.type === "llm") ?? [];
        newSettings.default_model = validateModelProvider(newSettings.default_model, llmAccounts);

        if (newSettings.opencode?.extraction_model) {
          newSettings.opencode.extraction_model = validateModelProvider(
            newSettings.opencode.extraction_model,
            llmAccounts
          );
        }

        if (newSettings.claudeCode?.extraction_model) {
          newSettings.claudeCode.extraction_model = validateModelProvider(
            newSettings.claudeCode.extraction_model,
            llmAccounts
          );
        }

        await ctx.ei.updateSettings(newSettings);
        ctx.showNotification("Settings updated", "info");
        return;
        
      } catch (parseError) {
        const errorMsg = parseError instanceof Error ? parseError.message : String(parseError);
        logger.debug("[settings] YAML parse error, prompting for re-edit", { iteration: editorIteration, error: errorMsg });
        
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
          return;
        }
      }
    }
  }
};
