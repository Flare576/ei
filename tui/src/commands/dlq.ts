import type { Command } from "./registry.js";
import { spawnEditor } from "../util/editor.js";
import { queueItemsToYAML, queueItemsFromYAML } from "../util/yaml-serializers.js";
import { ConfirmOverlay } from "../components/ConfirmOverlay.js";

export const dlqCommand: Command = {
  name: "dlq",
  aliases: [],
  description: "Open dead-letter queue $EDITOR",
  usage: "/dlq - Inspect and recover failed queue items",

  async execute(_args, ctx) {
    const items = ctx.ei.getDLQItems();

    if (items.length === 0) {
      ctx.showNotification("DLQ is empty", "info");
      return;
    }

    const human = await ctx.ei.getHuman();
    const accounts = human.settings?.accounts ?? [];
    let yamlContent = queueItemsToYAML(items, accounts);

    while (true) {
      const result = await spawnEditor({
        initialContent: yamlContent,
        filename: "ei-dlq.yaml",
        renderer: ctx.renderer,
      });

      if (result.aborted || !result.success) {
        ctx.showNotification("DLQ edit cancelled", "info");
        return;
      }

      if (result.content === null) {
        ctx.showNotification("No changes made", "info");
        return;
      }

      try {
        const { updates, deletedIds } = queueItemsFromYAML(result.content, accounts);
        if (deletedIds.length > 0) {
          ctx.ei.deleteQueueItems(deletedIds);
        }
        let recovered = 0;
        for (const update of updates) {
          await ctx.ei.updateQueueItem(update.id, update);
          if (update.state === "pending") recovered++;
        }
        const parts: string[] = [];
        if (recovered > 0) parts.push(`${recovered} item(s) requeued`);
        if (deletedIds.length > 0) parts.push(`${deletedIds.length} deleted`);
        const msg = parts.length > 0
          ? `DLQ updated — ${parts.join(", ")}`
          : `DLQ updated (no items requeued)`;
        ctx.showNotification(msg, "info");
        return;
      } catch (parseError) {
        const errorMsg = parseError instanceof Error ? parseError.message : String(parseError);

        const shouldReEdit = await new Promise<boolean>((resolve) => {
          ctx.showOverlay((hideOverlay, hideForEditor) =>
            ConfirmOverlay({
              message: `YAML error:\n${errorMsg}\n\nRe-edit?`,
              onConfirm: () => { hideForEditor(); resolve(true); },
              onCancel: () => { hideOverlay(); resolve(false); },
            })
          , ctx.renderer);
        });

        if (shouldReEdit) {
          yamlContent = result.content;
          continue;
        }

        ctx.showNotification("Changes discarded", "warn");
        return;
      }
    }
  },
};
