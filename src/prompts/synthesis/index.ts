import type { SynthesisPromptData } from "./types.js";
import type { PromptOutput } from "../response/types.js";

export type { SynthesisPromptData, EnrichedTopic, EnrichedPerson } from "./types.js";

export function buildSynthesisPrompt(data: SynthesisPromptData): PromptOutput {
  const system = `You are synthesizing a knowledge document from a personal knowledge base called Ei.

Your goal is to produce a well-structured markdown document that a human could share with a teammate, hand to their future self, or use as a reference. Write as if you are distilling what someone actually knows — not restating a list of facts, but synthesizing relationships, context, and meaning.

## What you have been given

- **Facts**: Ground-truth statements. Complete as given.
- **Topics**: Areas of interest, work, or concern with descriptions. Complete as given — you do not need to fetch them.
- **People**: Individuals with relationship context. Complete as given — you do not need to fetch them.
- **Quotes**: Verbatim things said, with a \`message_id\`. The quote text is complete. Use \`fetch_message\` with the \`message_id\` if you want the surrounding conversation for additional context.

## Tools

You have tools available. Use them when the provided data leaves a clear gap:
- \`find_memory\` — search for related topics, people, or facts not already provided
- \`fetch_memory\` — retrieve a full record by ID (only useful for records not already given to you)
- \`fetch_message\` — retrieve the original conversation around a quote's \`message_id\`

Do not fetch records that are already present in this prompt. Use tools to fill genuine gaps, not to re-retrieve what you already have.

## Output

Write clean, structured markdown. Use headings. Synthesize — do not just restate the bullets. Where the data tells a story or shows a pattern, say so. Where something is uncertain or a work-in-progress, reflect that. Aim for the document a thoughtful person would write after reviewing all of this, not a formatted dump.`;

  const lines: string[] = [`# ${data.subject}`, ""];

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
    }
    lines.push("");
  }

  const user = lines.join("\n");

  return { system, user };
}
