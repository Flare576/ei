import type { Command } from "./registry";
import { ToolkitListOverlay, type ToolkitListItem } from "../components/ToolkitListOverlay";
import { openToolkitEditor } from "../util/toolkit-editor.js";

export const toolsCommand: Command = {
  name: "tools",
  aliases: [],
  description: "Manage tool providers (toolkits)",
  usage: "/tools",

  async execute(_args, ctx) {
    const providers = ctx.ei.getToolProviderList();
    const allTools = ctx.ei.getToolList();

    if (providers.length === 0) {
      ctx.showNotification("No toolkits available.", "info");
      return;
    }

    const toolkits: ToolkitListItem[] = providers.map(p => ({
      id: p.id,
      displayName: p.display_name,
      name: p.name,
      enabled: p.enabled,
      toolCount: allTools.filter(t => t.provider_id === p.id).length,
    }));

    ctx.showOverlay((hideOverlay) => (
      <ToolkitListOverlay
        toolkits={toolkits}
        onEdit={async (toolkit) => {
          hideOverlay();
          await new Promise(r => setTimeout(r, 50));
          const provider = providers.find(p => p.id === toolkit.id);
          if (provider) {
            const providerTools = allTools.filter(t => t.provider_id === provider.id);
            await openToolkitEditor(provider, providerTools, ctx);
          }
        }}
        onDismiss={hideOverlay}
      />
    ));
  },
};
