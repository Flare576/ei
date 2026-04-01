import type { Command } from "./registry.js";
import { spawnEditor } from "../util/editor.js";
import { queueItemsToYAML, queueItemsFromYAML } from "../util/yaml-serializers.js";
import { ConfirmOverlay } from "../components/ConfirmOverlay.js";

export const queueCommand: Command = {
  name: "queue",
  aliases: [],
  description: "Pause & open queue items in $EDITOR",
  usage: "/queue - Inspect and edit active queue items",

  async execute(_args, ctx) {
    const items = ctx.ei.getQueueActiveItems();

    if (items.length === 0) {
      ctx.showNotification("Queue is empty", "info");
      return;
    }

    ctx.ei.pauseQueue();
    ctx.showNotification(`Queue paused (${items.length} items)`, "info");

    const human = await ctx.ei.getHuman();
    const accounts = human.settings?.accounts ?? [];
    let yamlContent = queueItemsToYAML(items, accounts);

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
        const { updates, deletedIds } = queueItemsFromYAML(result.content, accounts);
        if (deletedIds.length > 0) {
          ctx.ei.deleteQueueItems(deletedIds);
        }
        for (const update of updates) {
          await ctx.ei.updateQueueItem(update.id, update);
        }
        ctx.ei.resumeQueue();
        const msg = deletedIds.length > 0
          ? `Queue updated (${updates.length} updated, ${deletedIds.length} deleted) — resumed`
          : `Queue updated (${updates.length} items) — resumed`;
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

        ctx.ei.resumeQueue();
        ctx.showNotification("Changes discarded — queue resumed", "warn");
        return;
      }
    }
  },
};
