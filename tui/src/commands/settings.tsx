import type { Command } from "./registry.js";
import { spawnEditor } from "../util/editor.js";
import { settingsToYAML, settingsFromYAML } from "../util/yaml-serializers.js";
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
        await ctx.ei.updateSettings(newSettings);
        ctx.showNotification("Settings updated", "info");
        return;
        
      } catch (parseError) {
        const errorMsg = parseError instanceof Error ? parseError.message : String(parseError);
        logger.debug("[settings] YAML parse error, prompting for re-edit", { iteration: editorIteration, error: errorMsg });
        
        const shouldReEdit = await new Promise<boolean>((resolve) => {
          ctx.showOverlay((hideOverlay) => (
            <ConfirmOverlay
              message={`YAML parse error:\n${errorMsg}\n\nRe-edit?`}
              onConfirm={() => {
                hideOverlay();
                resolve(true);
              }}
              onCancel={() => {
                hideOverlay();
                resolve(false);
              }}
            />
          ));
        });
        
        if (shouldReEdit) {
          yamlContent = result.content;
          await new Promise(r => setTimeout(r, 50));
          continue;
        } else {
          ctx.showNotification("Changes discarded", "info");
          return;
        }
      }
    }
  }
};
