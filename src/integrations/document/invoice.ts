import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { UnsourcePreview, UnsourceResult } from "./unsource.js";

export async function writeUnsourceInvoice(
  preview: UnsourcePreview,
  result: UnsourceResult,
  dataPath: string
): Promise<string> {
  const now = new Date();
  const timestamp = now.toISOString();
  const sanitizedTag = preview.sourceTag.replace(/[^a-zA-Z0-9._-]/g, "_");
  const filename = `${timestamp.replace(/[:.]/g, "-")}-${sanitizedTag}.md`;
  const dir = join(dataPath, "unsourced");
  const filePath = join(dir, filename);

  await mkdir(dir, { recursive: true });

  const deletedCount =
    result.deleted.facts + result.deleted.topics + result.deleted.people;
  const strippedCount =
    result.stripped.facts + result.stripped.topics + result.stripped.people;

  const lines: string[] = [
    `# Unsource: ${preview.sourceTag}`,
    `Run at: ${timestamp}`,
    "",
    `## Deleted (${deletedCount} items, ${result.deleted.quotes} quotes)`,
  ];

  for (const f of preview.toDelete.facts) lines.push(`- [Fact] ${f.name}`);
  for (const t of preview.toDelete.topics) lines.push(`- [Topic] ${t.name}`);
  for (const p of preview.toDelete.people) lines.push(`- [Person] ${p.name}`);
  for (const q of preview.toDelete.quotes) {
    const excerpt = q.text.length > 80 ? `${q.text.slice(0, 80)}...` : q.text;
    lines.push(`- [Quote] "${excerpt}"`);
  }

  if (
    preview.toStrip.facts.length > 0 ||
    preview.toStrip.topics.length > 0 ||
    preview.toStrip.people.length > 0
  ) {
    lines.push("");
    lines.push(`## Retained — shared with other sources (${strippedCount} items)`);
    lines.push(`Source removed from these items. They had additional sources or non-Emmett personas.`);
    lines.push("");
    for (const f of preview.toStrip.facts) lines.push(`- [Fact] ${f.name}`);
    for (const t of preview.toStrip.topics) lines.push(`- [Topic] ${t.name}`);
    for (const p of preview.toStrip.people) lines.push(`- [Person] ${p.name}`);
    lines.push("");
    lines.push(`Run \`/me topics\` or \`/me people\` to review or delete retained items manually.`);
  }

  await writeFile(filePath, lines.join("\n") + "\n", "utf8");
  return filePath;
}
