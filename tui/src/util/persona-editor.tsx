import { spawnEditor } from "./editor.js";
import { personaToYAML, personaFromYAML, newPersonaToYAML, newPersonaFromYAML } from "./yaml-serializers.js";
import type { CommandContext } from "../commands/registry.js";
import type { PersonaEntity } from "../../../src/core/types.js";
import { logger } from "./logger.js";
import { ConfirmOverlay } from "../components/ConfirmOverlay.js";

export interface PersonaEditorOptions {
  personaId: string;
  persona: PersonaEntity;
  ctx: CommandContext;
}

export interface PersonaEditorResult {
  success: boolean;
  cancelled: boolean;
  personaWasModified: boolean;
}

export interface NewPersonaEditorOptions {
  personaName: string;
  ctx: CommandContext;
}

export interface NewPersonaEditorResult {
  created: boolean;
  cancelled: boolean;
}

export async function createPersonaViaEditor(options: NewPersonaEditorOptions): Promise<NewPersonaEditorResult> {
  const { personaName, ctx } = options;
  
  let yamlContent = newPersonaToYAML(personaName);
  
  while (true) {
    const result = await spawnEditor({
      initialContent: yamlContent,
      filename: `${personaName}-new.yaml`,
      renderer: ctx.renderer,
    });
    
    if (result.aborted) {
      ctx.showNotification("Creation cancelled", "info");
      return { created: false, cancelled: true };
    }
    
    if (!result.success) {
      ctx.showNotification("Editor failed to open", "error");
      return { created: false, cancelled: false };
    }
    
    if (result.content === null) {
      ctx.showNotification("No content - persona not created", "info");
      return { created: false, cancelled: true };
    }
    
    try {
      const parsed = newPersonaFromYAML(result.content);
      
      const personaId = await ctx.ei.createPersona({ 
        name: personaName,
        ...parsed,
      });
      // Ensure store has the new persona before selecting
      // (onPersonaAdded fires refreshPersonas but doesn't await it)
      await ctx.ei.refreshPersonas();
      ctx.ei.selectPersona(personaId);
      
      ctx.showNotification(`Created ${personaName}`, "info");
      return { created: true, cancelled: false };
      
    } catch (parseError) {
      const errorMsg = parseError instanceof Error ? parseError.message : String(parseError);
      logger.debug("[persona-editor] YAML parse error in new persona", { error: errorMsg });
      
      const shouldReEdit = await new Promise<boolean>((resolve) => {
        ctx.showOverlay((hideOverlay) => (
          <ConfirmOverlay
            message={`YAML parse error:\n${errorMsg}\n\nRe-edit?`}
            onConfirm={() => {
              logger.debug("[persona-editor] user confirmed re-edit (new)");
              hideOverlay();
              resolve(true);
            }}
            onCancel={() => {
              logger.debug("[persona-editor] user cancelled re-edit (new)");
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
        ctx.showNotification("Creation cancelled", "info");
        return { created: false, cancelled: true };
      }
    }
  }
}

export async function openPersonaEditor(options: PersonaEditorOptions): Promise<PersonaEditorResult> {
  const { personaId, persona, ctx } = options;
  let yamlContent = personaToYAML(persona);
  
  while (true) {
    const result = await spawnEditor({
      initialContent: yamlContent,
      filename: `${personaId}-details.yaml`,
      renderer: ctx.renderer,
    });
    
    if (result.aborted) {
      ctx.showNotification("Editor cancelled", "info");
      return { success: false, cancelled: true, personaWasModified: false };
    }
    
    if (!result.success) {
      ctx.showNotification("Editor failed to open", "error");
      return { success: false, cancelled: false, personaWasModified: false };
    }
    
    if (result.content === null) {
      ctx.showNotification("No changes made", "info");
      return { success: true, cancelled: false, personaWasModified: false };
    }
    
    try {
      const parsed = personaFromYAML(result.content, persona);
      
      await ctx.ei.updatePersona(personaId, parsed.updates);
      
      ctx.showNotification(`Updated ${persona.display_name}`, "info");
      return { success: true, cancelled: false, personaWasModified: true };
      
    } catch (parseError) {
      const errorMsg = parseError instanceof Error ? parseError.message : String(parseError);
      logger.debug("[persona-editor] YAML parse error", { error: errorMsg });
      
      const shouldReEdit = await new Promise<boolean>((resolve) => {
        ctx.showOverlay((hideOverlay) => (
          <ConfirmOverlay
            message={`YAML parse error:\n${errorMsg}\n\nRe-edit?`}
            onConfirm={() => {
              logger.debug("[persona-editor] user confirmed re-edit");
              hideOverlay();
              resolve(true);
            }}
            onCancel={() => {
              logger.debug("[persona-editor] user cancelled re-edit");
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
        return { success: false, cancelled: true, personaWasModified: false };
      }
    }
  }
}
