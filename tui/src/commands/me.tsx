import type { Command } from "./registry.js";
import { spawnEditor } from "../util/editor.js";
import { humanToYAML, humanFromYAML } from "../util/yaml-serializers.js";
import { logger } from "../util/logger.js";
import { ConfirmOverlay } from "../components/ConfirmOverlay.js";

type DataType = "facts" | "topics" | "people";

const TYPE_ALIASES: Record<string, DataType> = {
  facts: "facts", fact: "facts",
  topics: "topics", topic: "topics",
  people: "people", person: "people", persons: "people",
};

export const meCommand: Command = {
  name: "me",
  aliases: [],
  description: "Edit your data in $EDITOR",
  usage: "/me [fact|topic|person] [new | <search>]",

  async execute(args, ctx) {
    const human = await ctx.ei.getHuman();

    const typeArg = args[0]?.toLowerCase();
    const filterType: DataType | null = typeArg ? (TYPE_ALIASES[typeArg] ?? null) : null;

    if (typeArg && !filterType) {
      ctx.showNotification(`Unknown type: ${typeArg}. Use: fact, topic, person`, "error");
      return;
    }

    const secondArg = args[1]?.toLowerCase();
    const isNew = secondArg === "new";
    const searchTerm = !isNew && secondArg ? args.slice(1).join(" ") : null;

    if (isNew && args.length > 2) {
      ctx.showNotification(
        `Use /me ${typeArg} new to create, or /me ${typeArg} ${args.slice(2).join(" ")} to search`,
        "error"
      );
      return;
    }

    if ((isNew || searchTerm) && !filterType) {
      ctx.showNotification(`Specify a type first: /me fact|topic|person [new | <search>]`, "error");
      return;
    }

    const filterItems = <T extends { name: string }>(items: T[]): T[] => {
      if (isNew) return [];
      if (searchTerm) return items.filter(i => i.name.toLowerCase().includes(searchTerm.toLowerCase()));
      return items;
    };

    const filteredHuman = filterType ? {
      ...human,
      facts:  filterType === "facts"  ? filterItems(human.facts)  : [],
      topics: filterType === "topics" ? filterItems(human.topics) : [],
      people: filterType === "people" ? filterItems(human.people) : [],
    } : human;

    const isEmpty = filteredHuman.facts.length === 0
      && filteredHuman.topics.length === 0
      && filteredHuman.people.length === 0;

    if (searchTerm && isEmpty) {
      ctx.showNotification(`No ${filterType} matching "${searchTerm}" — open editor to create one`, "info");
    }
    
    const personaLookup = new Map(ctx.ei.personas().map(p => [p.id, p.display_name]));
    const allGroups = await ctx.ei.getGroupList();
    const sections = filterType
      ? new Set<"facts" | "topics" | "people">([filterType])
      : new Set<"facts" | "topics" | "people">(["facts", "topics", "people"]);
    let yamlContent = humanToYAML(filteredHuman, personaLookup, allGroups, sections);
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
        const currentHuman = await ctx.ei.getHuman();
        const parsed = humanFromYAML(result.content, filteredHuman, currentHuman);
        
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
          if (parsed.changedFactIds.has(fact.id)) {
            await ctx.ei.upsertFact(fact);
          }
        }
        for (const topic of parsed.topics) {
          if (parsed.changedTopicIds.has(topic.id)) {
            await ctx.ei.upsertTopic(topic);
          }
        }
        for (const person of parsed.people) {
          if (parsed.changedPersonIds.has(person.id)) {
            await ctx.ei.upsertPerson(person);
          }
        }
        
        const deleteCount = parsed.deletedFactIds.length +
                           parsed.deletedTopicIds.length +
                           parsed.deletedPersonIds.length;
        const updateCount = parsed.changedFactIds.size +
                           parsed.changedTopicIds.size +
                           parsed.changedPersonIds.size;
        const skippedCount = parsed.skippedFactCount +
                            parsed.skippedTopicCount +
                            parsed.skippedPersonCount;

        const msg = skippedCount > 0
          ? `Updated ${updateCount}, deleted ${deleteCount}, skipped ${skippedCount} (changed by another process)`
          : `Updated ${updateCount} items, deleted ${deleteCount}`;
        ctx.showNotification(msg, "info");
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
