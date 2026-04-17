import type { Command } from "./registry.js";
import { spawnEditor } from "../util/editor.js";
import { contextToYAML, contextFromYAML, ffaContextToYAML, ffaContextFromYAML } from "../util/yaml-serializers.js";
import { logger } from "../util/logger.js";
import { ConfirmOverlay } from "../components/ConfirmOverlay.js";
import { CYPTreeOverlay } from "../components/CYPTreeOverlay.js";
import { MAPScoreOverlay } from "../components/MAPScoreOverlay.js";
import { RoomMode } from "../../../src/core/types/enums.js";

export const contextCommand: Command = {
  name: "context",
  aliases: ["messages"],
  description: "Edit message context status in $EDITOR",
  usage: "/context",

  async execute(_args, ctx) {
    const personaId = ctx.ei.activePersonaId();
    const roomId = ctx.ei.activeRoomId();

    if (roomId) {
      const room = ctx.ei.getRoom(roomId);
      if (!room) {
        ctx.showNotification("Room not found", "warn");
        return;
      }

      if (room.mode === RoomMode.ChooseYourPath) {
        const activeNodeId = room.active_node_id;
        if (!activeNodeId) {
          ctx.showNotification("No active node in room", "warn");
          return;
        }
        ctx.showOverlay((hideOverlay) => (
          <CYPTreeOverlay
            roomId={roomId}
            roomName={room.display_name}
            messages={ctx.ei.roomMessages()}
            activeNodeId={activeNodeId}
            activeRoomPath={ctx.ei.roomActivePath()}
            personas={ctx.ei.personas()}
            onSelectBranch={(msgId) => ctx.ei.selectCYPBranch(msgId)}
            onDismiss={hideOverlay}
          />
        ), ctx.renderer);
        return;
      }

      if (room.mode === RoomMode.FreeForAll) {
        const allMessages = ctx.ei.roomMessages();
        if (allMessages.length === 0) {
          ctx.showNotification("No messages to edit", "info");
          return;
        }

        const personas = ctx.ei.personas();
        const speakerMap = new Map(personas.map((p) => [p.id, p.display_name]));

        const originalStatus = new Map(allMessages.map((m) => [m.id, m.context_status]));

        let yamlContent = ffaContextToYAML(allMessages, speakerMap);
        let editorIteration = 0;

        while (true) {
          editorIteration++;
          logger.debug("[context] ffa starting editor iteration", { iteration: editorIteration });

          const result = await spawnEditor({
            initialContent: yamlContent,
            filename: "ffa-context.yaml",
            renderer: ctx.renderer,
          });

          logger.debug("[context] ffa editor returned", {
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
            const parsed = ffaContextFromYAML(result.content);

            if (parsed.deletedMessageIds.length > 0) {
              const count = parsed.deletedMessageIds.length;
              const hasImplicit = parsed.implicitDeleteCount > 0;
              const confirmed = await new Promise<boolean>((resolve) => {
                ctx.showOverlay((hideOverlay) => (
                  <ConfirmOverlay
                    message={`Delete ${count} message${count === 1 ? "" : "s"}?${hasImplicit ? `\n(includes ${parsed.implicitDeleteCount} persona response${parsed.implicitDeleteCount === 1 ? "" : "s"})` : ""}`}
                    onConfirm={() => { hideOverlay(); resolve(true); }}
                    onCancel={() => { hideOverlay(); resolve(false); }}
                  />
                ), ctx.renderer);
              });
              if (!confirmed) {
                ctx.showNotification("Delete cancelled", "info");
                return;
              }
              await ctx.ei.deleteRoomMessages(roomId, parsed.deletedMessageIds);
            }

            for (const msg of parsed.messages) {
              const orig = originalStatus.get(msg.id);
              if (orig !== undefined && orig !== msg.context_status) {
                await ctx.ei.setRoomMessageContextStatus(roomId, msg.id, msg.context_status);
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
            logger.debug("[context] ffa YAML parse error, prompting for re-edit", {
              iteration: editorIteration,
              error: errorMsg,
            });

            const shouldReEdit = await new Promise<boolean>((resolve) => {
              ctx.showOverlay((hideOverlay, hideForEditor) => (
                <ConfirmOverlay
                  message={`YAML parse error:\n${errorMsg}\n\nRe-edit?`}
                  onConfirm={() => {
                    logger.debug("[context] ffa user confirmed re-edit");
                    hideForEditor();
                    resolve(true);
                  }}
                  onCancel={() => {
                    logger.debug("[context] ffa user cancelled re-edit");
                    hideOverlay();
                    resolve(false);
                  }}
                />
              ), ctx.renderer);
            });

            logger.debug("[context] ffa shouldReEdit", { shouldReEdit, iteration: editorIteration });

            if (shouldReEdit) {
              yamlContent = result.content;
              logger.debug("[context] ffa continuing to next iteration");
              continue;
            } else {
              ctx.showNotification("Changes discarded", "info");
              return;
            }
          }
        }
      }

      if (room.mode === RoomMode.MessagesAgainstPersona) {
        if (!room.judge_persona_id) {
          ctx.showNotification("No judge configured for this room", "warn");
          return;
        }
        const human = await ctx.ei.getHuman();
        const humanName =
          human.settings?.name_display ||
          human.facts?.find((f) => f.name === "Nickname/Preferred Name")?.description ||
          "You";
        ctx.showOverlay((hideOverlay) => (
          <MAPScoreOverlay
            roomId={roomId}
            roomName={room.display_name}
            messages={ctx.ei.roomMessages()}
            activeNodeId={room.active_node_id ?? ""}
            activeRoomPath={ctx.ei.roomActivePath()}
            personas={ctx.ei.personas()}
            judgePersonaId={room.judge_persona_id!}
            humanName={humanName}
            onDismiss={hideOverlay}
          />
        ), ctx.renderer);
        return;
      }

      ctx.showNotification("Unknown room mode", "warn");
      return;
    }

    if (!personaId) {
      ctx.showNotification("No active chat", "warn");
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
          ctx.showOverlay((hideOverlay, hideForEditor) => (
            <ConfirmOverlay
              message={`YAML parse error:\n${errorMsg}\n\nRe-edit?`}
              onConfirm={() => {
                logger.debug("[context] user confirmed re-edit");
                hideForEditor();
                resolve(true);
              }}
              onCancel={() => {
                logger.debug("[context] user cancelled re-edit");
                hideOverlay();
                resolve(false);
              }}
            />
          ), ctx.renderer);
        });

        logger.debug("[context] shouldReEdit", { shouldReEdit, iteration: editorIteration });

        if (shouldReEdit) {
          yamlContent = result.content;
          logger.debug("[context] continuing to next iteration");
          continue;
        } else {
          ctx.showNotification("Changes discarded", "info");
          return;
        }
      }
    }
  },
};
