import YAML from "yaml";
import type { Command } from "./registry";
import { isReservedPersonaName } from "../../../src/core/types.js";
import { logger } from "../util/logger.js";
import { PersonaListOverlay } from "../components/PersonaListOverlay";
import { LoadingOverlay } from "../components/LoadingOverlay.js";
import { PersonPickerOverlay } from "../components/PersonPickerOverlay.js";
import type { PersonPickerItem } from "../components/PersonPickerOverlay.js";
import { ConfirmOverlay } from "../components/ConfirmOverlay.js";
import { spawnEditor } from "../util/editor.js";
import {
  descriptionEntryToYAML,
  descriptionFromYAML,
  personaPreviewToYAML,
  personaPreviewFromYAML,
} from "../util/yaml-serializers.js";

export const personaCommand: Command = {
  name: "persona",
  aliases: ["p"],
  description: "Switch persona, list all, create new, or update from person",
  usage: "/persona [name] | /persona new <name> | /persona update <personaName> [personName]",

  async execute(args, ctx) {
    const unarchived = ctx.ei.personas().filter(p => !p.is_archived);

    if (args.length === 0) {
      ctx.showOverlay((hideOverlay, _hideForEditor) => (
        <PersonaListOverlay
          personas={unarchived}
          activePersonaId={ctx.ei.activePersonaId()}
          onSelect={(personaId) => {
            const persona = unarchived.find(p => p.id === personaId);
            ctx.ei.selectPersona(personaId);
            hideOverlay();
            ctx.showNotification(`Switched to ${persona?.display_name ?? personaId}`, "info");
          }}
          onDismiss={hideOverlay}
        />
      ), ctx.renderer);
      return;
    }

    if (args[0].toLowerCase() === "new") {
      if (args.length < 2) {
        ctx.showNotification("Usage: /p new <name>", "error");
        return;
      }
      const personaName = args.slice(1).join(" ");
      if (isReservedPersonaName(personaName)) {
        ctx.showNotification(`Cannot use reserved name "${personaName}"`, "error");
        return;
      }

      // Step 1: description editor
      const descResult = await spawnEditor({
        initialContent: descriptionEntryToYAML(personaName),
        filename: `${personaName}-description.yaml`,
        renderer: ctx.renderer,
      });

      if (descResult.aborted || descResult.content === null) {
        ctx.showNotification("Cancelled", "info");
        return;
      }

      let parsed: { description: string; relationship?: string };
      try {
        parsed = descriptionFromYAML(descResult.content);
      } catch (e) {
        logger.error("[persona:new] description parse error", e);
        ctx.showNotification(`Parse error: ${e instanceof Error ? e.message : String(e)}`, "error");
        return;
      }

      if (!parsed.description) {
        ctx.showNotification("No description provided", "error");
        return;
      }

      // Step 2: generate preview with loading overlay
      let dismissed = false;
      const overlayCallbacks = { hideOverlay: null as (() => void) | null, hideForEditor: null as (() => void) | null };

      const previewPromise = new Promise<import('../../../src/prompts/generation/types.js').PersonaGenerationResult | null>((resolve) => {
        ctx.showOverlay((hideOverlay, hideForEditor) => {
          overlayCallbacks.hideOverlay = hideOverlay;
          overlayCallbacks.hideForEditor = hideForEditor;
          return (
            <LoadingOverlay
              message={`Generating persona preview for "${personaName}"...`}
              onCancel={() => {
                dismissed = true;
                hideOverlay();
                resolve(null);
              }}
            />
          );
        }, ctx.renderer);

        ctx.ei.generatePersonaPreview(personaName, parsed.description, parsed.relationship)
          .then(result => {
            if (!dismissed && overlayCallbacks.hideOverlay) {
              resolve(result);
            }
          })
          .catch(e => {
            if (!dismissed && overlayCallbacks.hideOverlay) {
              overlayCallbacks.hideOverlay();
              logger.error("[persona:new] generation failed", e);
              ctx.showNotification(`Generation failed: ${e instanceof Error ? e.message : String(e)}`, "error");
              resolve(null);
            }
          });
      });

      const preview = await previewPromise;
      if (!preview) return;

      overlayCallbacks.hideForEditor?.();

      let editorContent = personaPreviewToYAML(preview, personaName);
      while (true) {
        const reviewResult = await spawnEditor({
          initialContent: editorContent,
          filename: `${personaName}-preview.yaml`,
          renderer: ctx.renderer,
        });

        if (reviewResult.aborted) {
          ctx.showNotification("Cancelled", "info");
          return;
        }

        editorContent = reviewResult.content ?? editorContent;

        let previewParsed: ReturnType<typeof personaPreviewFromYAML>;
        try {
          previewParsed = personaPreviewFromYAML(editorContent);
        } catch (e) {
          const shouldReEdit = await new Promise<boolean>(resolve => {
            ctx.showOverlay((hideOverlay, hideForEditor) => (
              <ConfirmOverlay
                message={`Parse error:\n${e instanceof Error ? e.message : String(e)}\n\nRe-edit?`}
                onConfirm={() => { hideForEditor(); resolve(true); }}
                onCancel={() => { hideOverlay(); resolve(false); }}
              />
            ), ctx.renderer);
          });
          if (shouldReEdit) continue;
          ctx.showNotification("Changes discarded", "info");
          return;
        }

        if (!previewParsed.long_description?.trim()) {
          const shouldReEdit = await new Promise<boolean>(resolve => {
            ctx.showOverlay((hideOverlay, hideForEditor) => (
              <ConfirmOverlay
                message={`A long description is required — it drives traits, topics, and persona voice.\n\nRe-edit?`}
                onConfirm={() => { hideForEditor(); resolve(true); }}
                onCancel={() => { hideOverlay(); resolve(false); }}
              />
            ), ctx.renderer);
          });
          if (shouldReEdit) continue;
          ctx.showNotification("Changes discarded", "info");
          return;
        }

        // Step 4: create
        const personaId = await ctx.ei.createPersona({
          name: personaName,
          ...previewParsed,
        });
        await ctx.ei.refreshPersonas();
        ctx.ei.selectPersona(personaId);
        ctx.showNotification(`Created ${personaName}`, "info");
        return;
      }
    }

    if (args[0].toLowerCase() === "update") {
      if (args.length < 2) {
        ctx.showNotification("Usage: /p update <personaName> [personName]", "error");
        return;
      }
      const personaName = args[1];
      const personName = args.length >= 3 ? args.slice(2).join(" ") : undefined;

      // Step 0: resolve persona (offer to create if not found)
      let personaId = await ctx.ei.resolvePersonaName(personaName);
      if (!personaId) {
        ctx.showNotification(`No persona named "${personaName}". Use /persona new ${personaName} to create one first.`, "error");
        return;
      }
      const persona = await ctx.ei.getPersona(personaId);
      if (!persona) {
        ctx.showNotification(`Could not load persona "${personaName}"`, "error");
        return;
      }

      const human = await ctx.ei.getHuman();

      let selectedPerson: (typeof human.people)[0];
      if (!personName) {
        if (persona.pending_update) {
          const previewContent = personaPreviewToYAML(
            {
              long_description: persona.pending_update.long_description,
              short_description: persona.pending_update.short_description ?? '',
              traits: persona.pending_update.traits.map(t => ({ ...t, strength: t.strength ?? 0.5, sentiment: t.sentiment ?? 0 })),
              topics: persona.pending_update.topics,
            },
            persona.display_name,
            undefined,
            persona.long_description,
          );
          const applyHeader = [
            `# Set _apply: true to apply these changes. Leave false to dismiss without applying.`,
            `# :cq to cancel (pending changes will remain).`,
            `_apply: false`,
            ``,
          ].join('\n');
          const reviewResult = await spawnEditor({
            initialContent: applyHeader + previewContent,
            filename: `${personaId}-pending-update.yaml`,
            renderer: ctx.renderer,
          });

          if (reviewResult.aborted) {
            ctx.showNotification("Cancelled — pending changes preserved", "info");
            return;
          }

          if (reviewResult.content === null) {
            await ctx.ei.updatePersona(personaId, { pending_update: undefined });
            ctx.showNotification(`Dismissed pending changes for ${persona.display_name}`, "info");
            return;
          }

          const content = reviewResult.content;
          let shouldApply = false;
          let previewParsed: ReturnType<typeof personaPreviewFromYAML>;
          try {
            const raw = YAML.parse(content) as Record<string, unknown>;
            shouldApply = raw._apply === true;
            previewParsed = personaPreviewFromYAML(content);
          } catch (e) {
            logger.error("[persona:update] pending update parse error", e);
            ctx.showNotification(`Parse error: ${e instanceof Error ? e.message : String(e)}`, "error");
            return;
          }

          if (!shouldApply) {
            const goBack = await new Promise<boolean>((resolve) => {
              ctx.showOverlay((hideOverlay, hideForEditor) => (
                <ConfirmOverlay
                  message={`You made edits but _apply is still false — changes won't be applied.\n\nConfirm = go back and edit\nCancel = dismiss without applying`}
                  onConfirm={() => { hideForEditor(); resolve(true); }}
                  onCancel={() => { hideOverlay(); resolve(false); }}
                />
              ), ctx.renderer);
            });

            if (goBack) {
              ctx.showNotification("Pending changes preserved", "info");
              return;
            }

            await ctx.ei.updatePersona(personaId, { pending_update: undefined });
            ctx.showNotification(`Dismissed pending changes for ${persona.display_name}`, "info");
            return;
          }

          await ctx.ei.updatePersona(personaId, {
            long_description: previewParsed.long_description,
            short_description: previewParsed.short_description,
            traits: previewParsed.traits,
            topics: previewParsed.topics,
            pending_update: undefined,
          });
          ctx.showNotification(`Applied changes to ${persona.display_name}`, "info");
          return;
        }

        const linked = (human.people ?? []).find(p =>
          p.identifiers?.some(id => id.type.toLowerCase() === 'ei persona' && id.value === personaId)
        );
        if (!linked) {
          ctx.showNotification(`No pending update or linked person for "${personaName}". Try: /p update ${personaName} <personName>`, "error");
          return;
        }
        selectedPerson = linked;
      } else {
        const matches = (human.people ?? []).filter(p =>
          p.name.toLowerCase().includes(personName.toLowerCase())
        );

        if (matches.length === 0) {
          ctx.showNotification(`No person named "${personName}" in your data`, "error");
          return;
        }

        if (matches.length > 1) {
          const people: PersonPickerItem[] = matches.map(p => ({
            id: p.id,
            name: p.name,
            relationship: p.relationship,
            description: p.description,
          }));

          const choice = await new Promise<typeof matches[0] | null>((resolve) => {
            ctx.showOverlay((hideOverlay, _hideForEditor) => (
              <PersonPickerOverlay
                title={`Multiple matches for "${personName}"`}
                people={people}
                onSelect={(item) => {
                  hideOverlay();
                  const found = matches.find(m => m.id === item.id);
                  resolve(found ?? null);
                }}
                onDismiss={() => {
                  hideOverlay();
                  resolve(null);
                }}
              />
            ), ctx.renderer);
          });

          if (!choice) return;
          selectedPerson = choice;
        } else {
          selectedPerson = matches[0];
        }
      }

      // Step 3: generate preview with loading overlay
      let dismissed = false;
      const overlayCallbacks2 = { hideOverlay: null as (() => void) | null, hideForEditor: null as (() => void) | null };

      const previewPromise = new Promise<import('../../../src/prompts/generation/types.js').PersonaGenerationResult | null>((resolve) => {
        ctx.showOverlay((hideOverlay, hideForEditor) => {
          overlayCallbacks2.hideOverlay = hideOverlay;
          overlayCallbacks2.hideForEditor = hideForEditor;
          return (
            <LoadingOverlay
              message={`Generating preview for "${persona.display_name}" from "${selectedPerson.name}"...`}
              onCancel={() => {
                dismissed = true;
                hideOverlay();
                resolve(null);
              }}
            />
          );
        }, ctx.renderer);

        ctx.ei.generatePersonaPreview(
          persona.display_name,
          selectedPerson.description ?? '',
          selectedPerson.relationship,
          personaId
        )
          .then(result => {
            if (!dismissed && overlayCallbacks2.hideOverlay) {
              resolve(result);
            }
          })
          .catch(e => {
            if (!dismissed && overlayCallbacks2.hideOverlay) {
              overlayCallbacks2.hideOverlay();
              logger.error("[persona:update] generation failed", e);
              ctx.showNotification(`Generation failed: ${e instanceof Error ? e.message : String(e)}`, "error");
              resolve(null);
            }
          });
      });

      const preview = await previewPromise;
      if (!preview) return;

      overlayCallbacks2.hideForEditor?.();

      // Step 4: review editor
      const updatePreviewYAML = personaPreviewToYAML(
        preview,
        persona.display_name,
        selectedPerson.name,
        preview.previous_long_description
      );
      const reviewResult = await spawnEditor({
        initialContent: updatePreviewYAML,
        filename: `${personaId}-update-preview.yaml`,
        renderer: ctx.renderer,
      });

      if (reviewResult.aborted) {
        ctx.showNotification("Cancelled", "info");
        return;
      }

      // Step 5: parse + update
      let previewParsed: ReturnType<typeof personaPreviewFromYAML>;
      try {
        previewParsed = personaPreviewFromYAML(reviewResult.content ?? updatePreviewYAML);
      } catch (e) {
        logger.error("[persona:update] preview parse error", e);
        ctx.showNotification(`Parse error: ${e instanceof Error ? e.message : String(e)}`, "error");
        return;
      }

      await ctx.ei.updatePersona(personaId, {
        long_description: previewParsed.long_description,
        short_description: previewParsed.short_description,
        ...(previewParsed.aliases ? { aliases: previewParsed.aliases } : {}),
        traits: previewParsed.traits,
        topics: previewParsed.topics,
      });

      const existingIdentifiers = selectedPerson.identifiers ?? [];
      const alreadyLinked = existingIdentifiers.some(id => id.type.toLowerCase() === 'ei persona' && id.value === personaId);
      if (!alreadyLinked) {
        const isPrimaryFirst = existingIdentifiers.length === 0;
        const updatedIdentifiers = [...existingIdentifiers, { type: 'Ei Persona', value: personaId, ...(isPrimaryFirst ? { is_primary: true } : {}) }];
        await ctx.ei.upsertPerson({ ...selectedPerson, identifiers: updatedIdentifiers });
      }

      ctx.showNotification(`Updated ${persona.display_name}`, "info");
      return;
    }

    // User typed a name - resolve it to ID, then switch
    const nameOrAlias = args.join(" ");
    const personaId = await ctx.ei.resolvePersonaName(nameOrAlias);

    if (personaId) {
      const persona = unarchived.find(p => p.id === personaId);
      ctx.ei.selectPersona(personaId);
      ctx.showNotification(`Switched to ${persona?.display_name ?? nameOrAlias}`, "info");
    } else {
      ctx.showNotification(`No persona named "${nameOrAlias}". Run \`/p new ${nameOrAlias}\` to create.`, "warn");
    }
  }
};
