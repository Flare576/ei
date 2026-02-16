import type { Command } from "./registry.js";
import { spawnEditor } from "../util/editor.js";
import { humanToYAML, humanFromYAML } from "../util/yaml-serializers.js";
import { logger } from "../util/logger.js";
import { ConfirmOverlay } from "../components/ConfirmOverlay.js";

export const meCommand: Command = {
  name: "me",
  aliases: [],
  description: "Edit your facts, traits, topics, and people in $EDITOR",
  usage: "/me",
  
  async execute(_args, ctx) {
    const human = await ctx.ei.getHuman();
    let yamlContent = humanToYAML(human);
    let editorIteration = 0;
    
    while (true) {
      editorIteration++;
      logger.debug("[me] starting editor iteration", { iteration: editorIteration });
      
      const result = await spawnEditor({
        initialContent: yamlContent,
        filename: "human-data.yaml",
        renderer: ctx.renderer,
      });
      
      logger.debug("[me] editor returned", { iteration: editorIteration, aborted: result.aborted, success: result.success, hasContent: result.content !== null });
      
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
        const parsed = humanFromYAML(result.content);
        
        for (const id of parsed.deletedFactIds) {
          await ctx.ei.removeDataItem("fact", id);
        }
        for (const id of parsed.deletedTraitIds) {
          await ctx.ei.removeDataItem("trait", id);
        }
        for (const id of parsed.deletedTopicIds) {
          await ctx.ei.removeDataItem("topic", id);
        }
        for (const id of parsed.deletedPersonIds) {
          await ctx.ei.removeDataItem("person", id);
        }
        
        for (const fact of parsed.facts) {
          await ctx.ei.upsertFact(fact);
        }
        for (const trait of parsed.traits) {
          await ctx.ei.upsertTrait(trait);
        }
        for (const topic of parsed.topics) {
          await ctx.ei.upsertTopic(topic);
        }
        for (const person of parsed.people) {
          await ctx.ei.upsertPerson(person);
        }
        
        const deleteCount = parsed.deletedFactIds.length + 
                           parsed.deletedTraitIds.length + 
                           parsed.deletedTopicIds.length + 
                           parsed.deletedPersonIds.length;
        const updateCount = parsed.facts.length + 
                           parsed.traits.length + 
                           parsed.topics.length + 
                           parsed.people.length;
        
        ctx.showNotification(`Updated ${updateCount} items, deleted ${deleteCount}`, "info");
        return;
        
      } catch (parseError) {
        const errorMsg = parseError instanceof Error ? parseError.message : String(parseError);
        logger.debug("[me] YAML parse error, prompting for re-edit", { iteration: editorIteration, error: errorMsg });
        
        const shouldReEdit = await new Promise<boolean>((resolve) => {
          ctx.showOverlay((hideOverlay) => (
            <ConfirmOverlay
              message={`YAML parse error:\n${errorMsg}\n\nRe-edit?`}
              onConfirm={() => {
                logger.debug("[me] user confirmed re-edit");
                hideOverlay();
                resolve(true);
              }}
              onCancel={() => {
                logger.debug("[me] user cancelled re-edit");
                hideOverlay();
                resolve(false);
              }}
            />
          ));
        });
        
        logger.debug("[me] shouldReEdit", { shouldReEdit, iteration: editorIteration });
        
        if (shouldReEdit) {
          yamlContent = result.content;
          logger.debug("[me] continuing to next iteration");
          await new Promise(r => setTimeout(r, 50));
          continue;
        } else {
          ctx.showNotification("Changes discarded", "info");
          return;
        }
      }
    }
  }
};
