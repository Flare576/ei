import type { Command } from "./registry.js";
import { spawnEditor } from "../util/editor.js";
import { humanToYAML, humanFromYAML } from "../util/yaml-serializers.js";
import { logger } from "../util/logger.js";
import { ConfirmOverlay } from "../components/ConfirmOverlay.js";

type DataType = "facts" | "topics" | "people";

const VALID_TYPES: DataType[] = ["facts", "topics", "people"];

export const meCommand: Command = {
  name: "me",
  aliases: [],
  description: "Edit your data in $EDITOR",
  usage: "/me [facts|topics|people]",
  
  async execute(args, ctx) {
    const human = await ctx.ei.getHuman();
    
    const filterArg = args[0]?.toLowerCase();
    const filterType: DataType | null = filterArg && VALID_TYPES.includes(filterArg as DataType) 
      ? filterArg as DataType 
      : null;
    
    if (filterArg && !filterType) {
      ctx.showNotification(`Invalid type: ${filterArg}. Use: facts, topics, people`, "error");
      return;
    }
    
    const filteredHuman = filterType ? {
      ...human,
      facts: filterType === "facts" ? human.facts : [],
      topics: filterType === "topics" ? human.topics : [],
      people: filterType === "people" ? human.people : [],
    } : human;
    
    const personaLookup = new Map(ctx.ei.personas().map(p => [p.id, p.display_name]));
    let yamlContent = humanToYAML(filteredHuman, personaLookup);
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
        for (const id of parsed.deletedTopicIds) {
          await ctx.ei.removeDataItem("topic", id);
        }
        for (const id of parsed.deletedPersonIds) {
          await ctx.ei.removeDataItem("person", id);
        }
        
        for (const fact of parsed.facts) {
          await ctx.ei.upsertFact(fact);
        }
        for (const topic of parsed.topics) {
          await ctx.ei.upsertTopic(topic);
        }
        for (const person of parsed.people) {
          await ctx.ei.upsertPerson(person);
        }
        
        const deleteCount = parsed.deletedFactIds.length + 
                           parsed.deletedTopicIds.length + 
                           parsed.deletedPersonIds.length;
        const updateCount = parsed.facts.length + 
                           parsed.topics.length + 
                           parsed.people.length;
        
        ctx.showNotification(`Updated ${updateCount} items, deleted ${deleteCount}`, "info");
        return;
        
      } catch (parseError) {
        const errorMsg = parseError instanceof Error ? parseError.message : String(parseError);
        logger.debug("[me] YAML parse error, prompting for re-edit", { iteration: editorIteration, error: errorMsg });
        
        const shouldReEdit = await new Promise<boolean>((resolve) => {
          ctx.showOverlay((hideOverlay, hideForEditor) => (
            <ConfirmOverlay
              message={`YAML parse error:\n${errorMsg}\n\nRe-edit?`}
              onConfirm={() => {
                logger.debug("[me] user confirmed re-edit");
                hideForEditor();
                resolve(true);
              }}
              onCancel={() => {
                logger.debug("[me] user cancelled re-edit");
                hideOverlay();
                resolve(false);
              }}
            />
          ), ctx.renderer);
        });
        
        logger.debug("[me] shouldReEdit", { shouldReEdit, iteration: editorIteration });
        
        if (shouldReEdit) {
          yamlContent = result.content;
          logger.debug("[me] continuing to next iteration");
          continue;
        } else {
          ctx.showNotification("Changes discarded", "info");
          return;
        }
      }
    }
  }
};
