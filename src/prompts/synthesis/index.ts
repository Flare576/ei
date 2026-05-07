import type { SynthesisPromptData } from "./types.js";
import type { PromptOutput } from "../response/types.js";

export type { SynthesisPromptData, EnrichedTopic, EnrichedPerson } from "./types.js";

export function buildSynthesisPrompt(data: SynthesisPromptData): PromptOutput {
  const hasEntityMap = data.loadedEntityNames !== undefined;

  const system = `You are synthesizing a knowledge document from a personal knowledge base called Ei.

Your goal is to produce a well-structured markdown document that a human could share with a teammate, hand to their future self, or use as a reference. Write as if you are distilling what someone actually knows — not restating a list of facts, but synthesizing relationships, context, and meaning.

## What you have been given

Everything below is complete as provided — do not use tools to re-fetch records already present here. Only use tools to fill genuine gaps not covered by the data below.

- **Facts**: User demographics only (name, age, job title, location, family structure, physical traits) — not interests or opinions.
- **Topics**: Areas of interest, work, or concern with descriptions.
- **People**: Individuals with relationship context.
- **Quotes**: Verbatim things said, with a \`message_id\`. Use \`fetch_message\` with the \`message_id\` if you want the surrounding conversation for additional context.${hasEntityMap ? `
- **Quote links**: Each quote lists the entities it was extracted from. Entities marked \`(not loaded)\` were referenced by that quote but are not present in this payload — use \`fetch_memory\` with the entity ID to retrieve them if the gap is relevant to your synthesis.` : ""}

## Output

Write clean, structured markdown. Use headings. Synthesize — do not just restate the bullets. Where the data tells a story or shows a pattern, say so. Where something is uncertain or a work-in-progress, reflect that. Aim for the document a thoughtful person would write after reviewing all of this, not a formatted dump.`;

  const lines: string[] = [`# ${data.subject}`, ""];

  const formatQuoteLinks = (dataItemIds: string[]): string | null => {
    if (!hasEntityMap || dataItemIds.length === 0) return null;
    const labels = dataItemIds.map(id => {
      const name = data.loadedEntityNames!.get(id);
      return name ? `[id:${id}] ${name}` : `[id:${id}] (not loaded)`;
    });
    return `  _Links: ${labels.join(", ")}_`;
  };

  if (data.facts.length > 0) {
    lines.push("## Facts");
    for (const fact of data.facts) {
      lines.push(`- [id:${fact.id}] **${fact.name}**: ${fact.description}`);
    }
    lines.push("");
  }

  if (data.topics.length > 0) {
    lines.push("## Topics");
    for (const { topic, quotes } of data.topics) {
      const categoryTag = topic.category ? ` _(${topic.category})_` : "";
      lines.push(`### [id:${topic.id}] ${topic.name}${categoryTag}`);
      lines.push(topic.description);
      if (quotes.length > 0) {
        lines.push("");
        lines.push("**Related quotes:**");
        for (const q of quotes) {
          const attribution = q.channel ? `${q.speaker} in ${q.channel}` : q.speaker;
          lines.push(`- [message_id:${q.message_id ?? "none"}] "${q.text}" — ${attribution}`);
          const linkLine = formatQuoteLinks(q.data_item_ids);
          if (linkLine) lines.push(linkLine);
        }
      }
      lines.push("");
    }
  }

  if (data.people.length > 0) {
    lines.push("## People");
    for (const { person, quotes } of data.people) {
      lines.push(`### [id:${person.id}] ${person.name}`);
      lines.push(`_${person.relationship}_`);
      lines.push("");
      lines.push(person.description);
      if (quotes.length > 0) {
        lines.push("");
        lines.push("**Related quotes:**");
        for (const q of quotes) {
          const attribution = q.channel ? `${q.speaker} in ${q.channel}` : q.speaker;
          lines.push(`- [message_id:${q.message_id ?? "none"}] "${q.text}" — ${attribution}`);
          const linkLine = formatQuoteLinks(q.data_item_ids);
          if (linkLine) lines.push(linkLine);
        }
      }
      lines.push("");
    }
  }

  if (data.standaloneQuotes.length > 0) {
    lines.push("## Additional Quotes");
    for (const q of data.standaloneQuotes) {
      const attribution = q.channel ? `${q.speaker} in ${q.channel}` : q.speaker;
      lines.push(`- [message_id:${q.message_id ?? "none"}] "${q.text}" — ${attribution}`);
      const linkLine = formatQuoteLinks(q.data_item_ids);
      if (linkLine) lines.push(linkLine);
    }
    lines.push("");
  }

  const user = lines.join("\n");

  return { system, user };
}
