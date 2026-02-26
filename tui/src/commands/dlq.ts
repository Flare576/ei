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

    let yamlContent = queueItemsToYAML(items);

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
        const updates = queueItemsFromYAML(result.content);
        let recovered = 0;
        for (const update of updates) {
          await ctx.ei.updateQueueItem(update.id, update);
          if (update.state === "pending") recovered++;
        }
        const msg = recovered > 0
          ? `DLQ updated — ${recovered} item(s) requeued`
          : `DLQ updated (no items requeued)`;
        ctx.showNotification(msg, "info");
        return;
      } catch (parseError) {
        const errorMsg = parseError instanceof Error ? parseError.message : String(parseError);

        const shouldReEdit = await new Promise<boolean>((resolve) => {
          ctx.showOverlay((hideOverlay) =>
            ConfirmOverlay({
              message: `YAML error:\n${errorMsg}\n\nRe-edit?`,
              onConfirm: () => { hideOverlay(); resolve(true); },
              onCancel: () => { hideOverlay(); resolve(false); },
            })
          );
        });

        if (shouldReEdit) {
          yamlContent = result.content;
          await new Promise(r => setTimeout(r, 50));
          continue;
        }

        ctx.showNotification("Changes discarded", "warn");
        return;
      }
    }
  },
};
