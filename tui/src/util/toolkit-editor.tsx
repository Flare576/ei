import { spawnEditor } from "./editor.js";
import { toolkitToYAML, toolkitFromYAML } from "./yaml-serializers.js";
import type { CommandContext } from "../commands/registry.js";
import type { ToolProvider, ToolDefinition } from "../../../src/core/types.js";
import { logger } from "./logger.js";
import { ConfirmOverlay } from "../components/ConfirmOverlay.js";

export interface EditToolkitResult {
  success: boolean;
  cancelled: boolean;
}

export async function openToolkitEditor(
  provider: ToolProvider,
  tools: ToolDefinition[],
  ctx: CommandContext
): Promise<EditToolkitResult> {
  let yamlContent = toolkitToYAML(provider, tools);

  while (true) {
    const result = await spawnEditor({
      initialContent: yamlContent,
      filename: `${provider.name}-toolkit.yaml`,
      renderer: ctx.renderer,
    });

    if (result.aborted) {
      ctx.showNotification("Editor cancelled", "info");
      return { success: false, cancelled: true };
    }

    if (!result.success) {
      ctx.showNotification("Editor failed to open", "error");
      return { success: false, cancelled: false };
    }

    if (result.content === null) {
      ctx.showNotification("No changes made", "info");
      return { success: true, cancelled: false };
    }

    try {
      const { updates, toolUpdates } = toolkitFromYAML(result.content, provider, tools);

      await ctx.ei.updateToolProvider(provider.id, updates);
      for (const { id, enabled } of toolUpdates) {
        await ctx.ei.updateTool(id, { enabled });
      }

      ctx.showNotification(`Updated toolkit "${provider.display_name}"`, "info");
      return { success: true, cancelled: false };

    } catch (parseError) {
      const errorMsg = parseError instanceof Error ? parseError.message : String(parseError);
      logger.debug("[toolkit-editor] YAML parse error", { error: errorMsg });

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
        return { success: false, cancelled: true };
      }
    }
  }
}
