import { spawnEditor } from "./editor.js";
import type { CliRenderer } from "@opentui/core";
import type { RoomMessage, PersonaSummary } from "../../../src/core/types.js";

interface ParsedBlock {
  id: string;
  chosen: boolean;
}

function buildCYPEditorYAML(
  activeNodeId: string,
  messages: RoomMessage[],
  personas: PersonaSummary[]
): string {
  const children = messages.filter((m) => m.parent_id === activeNodeId);

  const header = `# Choose Your Path
# Mark exactly ONE response with _chosen: true to continue the story.
# Save and exit to confirm your selection.

`;

  const isExplored = (msgId: string) => messages.some((x) => x.parent_id === msgId);

  const blocks = children.map((m) => {
    let speaker = "You";
    if (m.role === "persona" && m.persona_id) {
      speaker = personas.find((p) => p.id === m.persona_id)?.display_name ?? m.persona_id;
    }

    const contentLines: string[] = [];
    if (m.verbal_response !== undefined) {
      const indented = m.verbal_response.split("\n").map((l) => `    ${l}`).join("\n");
      contentLines.push(`  verbal_response: |\n${indented}`);
    }
    if (m.action_response !== undefined) {
      const indented = m.action_response.split("\n").map((l) => `    ${l}`).join("\n");
      contentLines.push(`  action_response: |\n${indented}`);
    }
    if (m.silence_reason !== undefined && m.verbal_response === undefined) {
      contentLines.push(`  silence_reason: "${m.silence_reason}"`);
    }
    if (contentLines.length === 0) {
      contentLines.push(`  # (no content)`);
    }

    return `- id: "${m.id}"
  speaker: "${speaker}"
  explored: ${isExplored(m.id)}
  _chosen: false
${contentLines.join("\n")}`;
  });

  return header + blocks.join("\n\n");
}

function parseCYPEditorYAML(content: string): ParsedBlock[] {
  const blocks: ParsedBlock[] = [];
  let currentId: string | null = null;
  let currentChosen = false;
  let inContent = false;

  for (const line of content.split("\n")) {
    const trimmed = line.trim();

    if (trimmed.startsWith("#") || trimmed === "") continue;

    // New block starts with `- id:` at column 0
    if (line.startsWith("- id:")) {
      if (currentId !== null) {
        blocks.push({ id: currentId, chosen: currentChosen });
      }
      const val = trimmed.slice("- id:".length).trim().replace(/^["']|["']$/g, "");
      currentId = val;
      currentChosen = false;
      inContent = false;
      continue;
    }

    // Content block lines are indented with 4 spaces — skip them
    if (inContent && line.startsWith("    ")) {
      continue;
    }
    inContent = false;

    if (currentId !== null) {
      if (trimmed.startsWith("_chosen:")) {
        const val = trimmed.slice("_chosen:".length).trim().toLowerCase();
        currentChosen = val === "true";
      } else if (trimmed.startsWith("content:")) {
        inContent = true;
      }
    }
  }

  if (currentId !== null) {
    blocks.push({ id: currentId, chosen: currentChosen });
  }

  return blocks;
}

export async function openCYPEditor(opts: {
  roomId: string;
  activeNodeId: string;
  messages: RoomMessage[];
  activePath: RoomMessage[];
  personas: PersonaSummary[];
  selectBranch: (messageId: string) => Promise<void>;
  showNotification: (msg: string, level: "error" | "warn" | "info") => void;
  renderer: CliRenderer;
}): Promise<void> {
  const { roomId, activeNodeId, messages, personas, selectBranch, showNotification, renderer } = opts;

  const yamlContent = buildCYPEditorYAML(activeNodeId, messages, personas);

  const result = await spawnEditor({
    initialContent: yamlContent,
    filename: `${roomId}-choose.yaml`,
    renderer,
  });

  if (result.aborted) {
    showNotification("Editor cancelled", "info");
    return;
  }

  if (!result.success) {
    showNotification("Editor failed to open", "error");
    return;
  }

  if (result.content === null) {
    showNotification("No changes made", "info");
    return;
  }

  const blocks = parseCYPEditorYAML(result.content);
  const chosenBlocks = blocks.filter((b) => b.chosen);

  if (chosenBlocks.length === 0) {
    showNotification("No response chosen — editor cancelled", "warn");
    return;
  }

  if (chosenBlocks.length > 1) {
    showNotification("Mark exactly one response — try again", "warn");
    return;
  }

  await selectBranch(chosenBlocks[0].id);
}
