import type { Command } from "./registry.js";
import { spawnEditor } from "../util/editor.js";
import { contextToYAML, contextFromYAML } from "../util/yaml-serializers.js";
import { logger } from "../util/logger.js";
import { ConfirmOverlay } from "../components/ConfirmOverlay.js";

export const contextCommand: Command = {
  name: "context",
  aliases: ["messages"],
  description: "Edit message context status in $EDITOR",
  usage: "/context",

  async execute(_args, ctx) {
    const personaId = ctx.ei.activePersonaId();
    if (!personaId) {
      ctx.showNotification("No active persona", "error");
      return;
    }

    const messages = ctx.ei.messages();
    if (messages.length === 0) {
      ctx.showNotification("No messages to edit", "info");
      return;
    }

    const originalStatus = new Map(messages.map((m) => [m.id, m.context_status]));

    let yamlContent = contextToYAML(messages);
    let editorIteration = 0;

    while (true) {
      editorIteration++;
      logger.debug("[context] starting editor iteration", { iteration: editorIteration });

      const result = await spawnEditor({
        initialContent: yamlContent,
        filename: "context.yaml",
        renderer: ctx.renderer,
      });

      logger.debug("[context] editor returned", {
        iteration: editorIteration,
        aborted: result.aborted,
        success: result.success,
        hasContent: result.content !== null,
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
        const parsed = contextFromYAML(result.content);

        if (parsed.deletedMessageIds.length > 0) {
          await ctx.ei.deleteMessages(personaId, parsed.deletedMessageIds);
        }

        for (const msg of parsed.messages) {
          const orig = originalStatus.get(msg.id);
          if (orig !== undefined && orig !== msg.context_status) {
            await ctx.ei.setMessageContextStatus(personaId, msg.id, msg.context_status);
          }
        }

        const deleteCount = parsed.deletedMessageIds.length;
        const notification =
          deleteCount > 0
            ? `Context updated (${deleteCount} message${deleteCount === 1 ? "" : "s"} deleted)`
            : "Context updated";

        ctx.showNotification(notification, "info");
        return;
      } catch (parseError) {
        const errorMsg = parseError instanceof Error ? parseError.message : String(parseError);
        logger.debug("[context] YAML parse error, prompting for re-edit", {
          iteration: editorIteration,
          error: errorMsg,
        });

        const shouldReEdit = await new Promise<boolean>((resolve) => {
          ctx.showOverlay((hideOverlay) => (
            <ConfirmOverlay
              message={`YAML parse error:\n${errorMsg}\n\nRe-edit?`}
              onConfirm={() => {
                logger.debug("[context] user confirmed re-edit");
                hideOverlay();
                resolve(true);
              }}
              onCancel={() => {
                logger.debug("[context] user cancelled re-edit");
                hideOverlay();
                resolve(false);
              }}
            />
          ));
        });

        logger.debug("[context] shouldReEdit", { shouldReEdit, iteration: editorIteration });

        if (shouldReEdit) {
          yamlContent = result.content;
          logger.debug("[context] continuing to next iteration");
          await new Promise((r) => setTimeout(r, 50));
          continue;
        } else {
          ctx.showNotification("Changes discarded", "info");
          return;
        }
      }
    }
  },
};
