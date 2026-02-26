import type { Command } from "./registry.js";
import { spawnEditor } from "../util/editor.js";
import { queueItemsToYAML, queueItemsFromYAML } from "../util/yaml-serializers.js";
import { ConfirmOverlay } from "../components/ConfirmOverlay.js";

export const queueCommand: Command = {
  name: "queue",
  aliases: [],
  description: "Pause the queue and open all pending/processing items in $EDITOR",
  usage: "/queue - Inspect and edit active queue items",

  async execute(_args, ctx) {
    const items = ctx.ei.getQueueActiveItems();

    if (items.length === 0) {
      ctx.showNotification("Queue is empty", "info");
      return;
    }

    ctx.ei.pauseQueue();
    ctx.showNotification(`Queue paused (${items.length} items)`, "info");

    let yamlContent = queueItemsToYAML(items);

    while (true) {
      const result = await spawnEditor({
        initialContent: yamlContent,
        filename: "ei-queue.yaml",
        renderer: ctx.renderer,
      });

      if (result.aborted || !result.success) {
        ctx.ei.resumeQueue();
        ctx.showNotification("Queue resumed (no changes)", "info");
        return;
      }

      if (result.content === null) {
        ctx.ei.resumeQueue();
        ctx.showNotification("No changes — queue resumed", "info");
        return;
      }

      try {
        const updates = queueItemsFromYAML(result.content);
        for (const update of updates) {
          await ctx.ei.updateQueueItem(update.id, update);
        }
        ctx.ei.resumeQueue();
        ctx.showNotification(`Queue updated (${updates.length} items) — resumed`, "info");
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

        ctx.ei.resumeQueue();
        ctx.showNotification("Changes discarded — queue resumed", "warn");
        return;
      }
    }
  },
};
