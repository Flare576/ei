import type { Command } from "./registry.js";
import { spawnEditor } from "../util/editor.js";
import type { Topic, Person } from "../../../src/core/types.js";

const VALID_TYPES = ["person", "topic"] as const;
type DedupeType = typeof VALID_TYPES[number];

function buildDedupeYAML(type: DedupeType, terms: string[], entities: Array<Topic | Person>): string {
  const termDisplay = terms.map(t => t.includes(" ") ? `"${t}"` : t).join(" | ");
  const header = [
    `# /dedupe ${type} ${terms.map(t => t.includes(" ") ? `"${t}"` : t).join(" ")}`,
    `# Terms: ${termDisplay}`,
    `# Found ${entities.length} match${entities.length === 1 ? "" : "es"}. DELETE blocks for entries to EXCLUDE from the merge.`,
    `# Keep at least 2. Save to confirm, :q to cancel (Vim tip: :cq quits with error — same effect, but now you know it exists).`,
    ``,
  ].join("\n");

  const blocks = entities.map(entity => {
    const lines = [
      `- id: "${entity.id}"`,
      `  name: "${entity.name.replace(/"/g, '\\"')}"`,
      `  description: "${entity.description.replace(/"/g, '\\"')}"`,
    ];

    if ("relationship" in entity && entity.relationship) {
      lines.push(`  relationship: "${entity.relationship}"`);
    }
    if ("category" in entity && entity.category) {
      lines.push(`  category: "${entity.category}"`);
    }
    if (entity.learned_by) {
      lines.push(`  learned_by: "${entity.learned_by}"`);
    }

    const date = entity.last_updated ? entity.last_updated.slice(0, 10) : "";
    if (date) lines.push(`  last_updated: "${date}"`);

    return lines.join("\n");
  });

  return header + blocks.join("\n\n") + "\n";
}

function parseDedupeYAML(content: string): string[] {
  const ids: string[] = [];
  const pattern = /^\s*- id:\s*"([^"]+)"/gm;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(content)) !== null) {
    ids.push(match[1]);
  }
  return ids;
}

function fuzzySearch(entities: Array<Topic | Person>, query: string): Array<Topic | Person> {
  const lower = query.toLowerCase();
  return entities.filter(entity =>
    entity.name.toLowerCase().includes(lower)
  );
}

export const dedupeCommand: Command = {
  name: "dedupe",
  aliases: [],
  description: "Merge duplicate people or topics",
  usage: '/dedupe <person|topic> <term> ["term 2" ...]',

  async execute(args, ctx) {
    const type = args[0]?.toLowerCase() as DedupeType | undefined;

    if (!type || !VALID_TYPES.includes(type)) {
      ctx.showNotification(
        `Usage: /dedupe <person|topic> <term> ["term 2" ...]. Got: ${args[0] ?? "(none)"}`,
        "error"
      );
      return;
    }

    const terms = args.slice(1);
    if (terms.length === 0) {
      ctx.showNotification(`Usage: /dedupe ${type} <term> ["term 2" ...] — at least one term required`, "error");
      return;
    }

    const human = await ctx.ei.getHuman();

    if (!human.settings?.rewrite_model) {
      ctx.showNotification(`/dedupe requires a Default Rewrite Model — set one in /settings`, "error");
      return;
    }

    const pool: Array<Topic | Person> = type === "topic" ? human.topics : human.people;

    const seen = new Set<string>();
    const matches: Array<Topic | Person> = [];
    for (const term of terms) {
      for (const entity of fuzzySearch(pool, term)) {
        if (!seen.has(entity.id)) {
          seen.add(entity.id);
          matches.push(entity);
        }
      }
    }

    if (matches.length === 0) {
      ctx.showNotification(`No ${type}s matching ${terms.map(t => `"${t}"`).join(" | ")}`, "info");
      return;
    }

    if (matches.length === 1) {
      ctx.showNotification(`Only 1 ${type} matched — need at least 2 to merge`, "info");
      return;
    }

    const yamlContent = buildDedupeYAML(type, terms, matches);

    const result = await spawnEditor({
      initialContent: yamlContent,
      filename: "ei-dedupe.yaml",
      renderer: ctx.renderer,
    });

    if (result.aborted) {
      ctx.showNotification("Dedupe cancelled", "info");
      return;
    }

    if (!result.success) {
      ctx.showNotification("Editor failed to open", "error");
      return;
    }

    if (result.content === null) {
      ctx.showNotification("No changes — dedupe cancelled", "info");
      return;
    }

    const keptIds = parseDedupeYAML(result.content);

    if (keptIds.length < 2) {
      ctx.showNotification("Need at least 2 entries to merge — dedupe cancelled", "error");
      return;
    }

    ctx.ei.queueUserDedup(type, keptIds);
    ctx.showNotification(
      `Queued merge of ${keptIds.length} ${type}s — Opus will synthesize at high priority`,
      "info"
    );
  },
};
