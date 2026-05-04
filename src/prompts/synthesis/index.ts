import type { SynthesisPromptData } from "./types.js";
import type { PromptOutput } from "../response/types.js";

export type { SynthesisPromptData } from "./types.js";

export function buildSynthesisPrompt(data: SynthesisPromptData): PromptOutput {
  const system = "You are synthesizing a knowledge document from Ei's memory. Write clean, structured markdown with clear headings. Be concise and factual. Do not hallucinate — only use the information provided.";

  const lines: string[] = [`# Knowledge Document: ${data.subject}`, ""];

  if (data.facts.length > 0) {
    lines.push("## Facts");
    for (const fact of data.facts) {
      lines.push(`- **${fact.name}**: ${fact.description}`);
    }
    lines.push("");
  }

  if (data.topics.length > 0) {
    lines.push("## Topics");
    for (const topic of data.topics) {
      lines.push(`- **${topic.name}**: ${topic.description}`);
    }
    lines.push("");
  }

  if (data.people.length > 0) {
    lines.push("## People");
    for (const person of data.people) {
      lines.push(`- **${person.name}**: ${person.description}`);
    }
    lines.push("");
  }

  if (data.quotes.length > 0) {
    lines.push("## Quotes");
    for (const quote of data.quotes) {
      lines.push(`- "${quote.text}"`);
    }
    lines.push("");
  }

  const user = lines.join("\n");

  return { system, user };
}
