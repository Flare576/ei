import type { Command } from "./registry";
import { isReservedPersonaName } from "../../../src/core/types.js";
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
  usage: "/persona [name] | /persona new <name> | /persona update <personaName> <personName>",

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
              ctx.showNotification(`Generation failed: ${e instanceof Error ? e.message : String(e)}`, "error");
              resolve(null);
            }
          });
      });

      const preview = await previewPromise;
      if (!preview) return;

      overlayCallbacks.hideForEditor?.();

      // Step 3: review editor
      const previewYAML = personaPreviewToYAML(preview, personaName);
      const reviewResult = await spawnEditor({
        initialContent: previewYAML,
        filename: `${personaName}-preview.yaml`,
        renderer: ctx.renderer,
      });

      if (reviewResult.aborted) {
        ctx.showNotification("Cancelled", "info");
        return;
      }

      let previewParsed: ReturnType<typeof personaPreviewFromYAML>;
      try {
        previewParsed = personaPreviewFromYAML(reviewResult.content ?? previewYAML);
      } catch (e) {
        ctx.showNotification(`Parse error: ${e instanceof Error ? e.message : String(e)}`, "error");
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

    if (args[0].toLowerCase() === "update") {
      if (args.length < 3) {
        ctx.showNotification("Usage: /p update <personaName> <personName>", "error");
        return;
      }
      const personaName = args[1];
      const personName = args.slice(2).join(" ");

      // Step 0: resolve persona (offer to create if not found)
      let personaId = await ctx.ei.resolvePersonaName(personaName);
      if (!personaId) {
        const shouldCreate = await new Promise<boolean>(resolve => {
          ctx.showOverlay((hideOverlay) => (
            <ConfirmOverlay
              message={`No persona named "${personaName}". Create one?`}
              onConfirm={() => { hideOverlay(); resolve(true); }}
              onCancel={() => { hideOverlay(); resolve(false); }}
            />
          ), ctx.renderer);
        });
        if (!shouldCreate) return;
        personaId = await ctx.ei.createPersona({ name: personaName });
        await ctx.ei.refreshPersonas();
      }
      const persona = await ctx.ei.getPersona(personaId);
      if (!persona) {
        ctx.showNotification(`Could not load persona "${personaName}"`, "error");
        return;
      }

      // Step 1: find matching people
      const human = await ctx.ei.getHuman();
      const matches = (human.people ?? []).filter(p =>
        p.name.toLowerCase().includes(personName.toLowerCase())
      );

      if (matches.length === 0) {
        ctx.showNotification(`No person named "${personName}" in your data`, "error");
        return;
      }

      // Step 2: disambiguation if multiple matches
      let selectedPerson: typeof matches[0];
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
      const alreadyLinked = existingIdentifiers.some(id => id.type === 'Ei Persona' && id.value === personaId);
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
