import { ContextStatus } from "../types.js";
import type { LLMResponse, Message } from "../types.js";
import type { StateManager } from "../state-manager.js";
import {
  queueAllScans,
  type ExtractionContext,
} from "../orchestrators/human-extraction.js";

function parseSegmentArray(content: string): string[] | null {
  const jsonMatch = content.match(/```json\s*([\s\S]*?)```/) ?? content.match(/```\s*([\s\S]*?)```/);
  const jsonText = jsonMatch ? jsonMatch[1].trim() : content.trim();

  const arrayMatch = jsonText.match(/\[[\s\S]*\]/);
  if (!arrayMatch) return null;

  try {
    const parsed = JSON.parse(arrayMatch[0]);
    if (!Array.isArray(parsed)) return null;
    return parsed.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
  } catch {
    return null;
  }
}

export function handleDocumentSegmentation(response: LLMResponse, state: StateManager): void {
  const { batchId, filename, originalContent } = response.request.data as {
    batchId: string;
    filename: string;
    originalContent: string;
  };

  if (!batchId || !filename) {
    console.error("[handleDocumentSegmentation] Missing batchId or filename in request data");
    return;
  }

  let segments: string[];
  if (response.content) {
    const parsed = parseSegmentArray(response.content);
    segments = (parsed && parsed.length > 0) ? parsed : [originalContent];
  } else {
    segments = [originalContent];
  }

  const emmett = state.persona_getById("emmet");
  if (!emmett) {
    console.warn("[handleDocumentSegmentation] Emmett persona not found — skipping segment write");
    return;
  }

  const now = new Date().toISOString();
  const sourceTag = `import:document:${filename}`;

  for (const segment of segments) {
    const message: Message = {
      id: crypto.randomUUID(),
      role: "system",
      content: segment,
      timestamp: now,
      read: true,
      context_status: ContextStatus.Always,
      external: true,
      source_tag: sourceTag,
    };
    state.messages_append("emmet", message);
  }

  console.log(`[handleDocumentSegmentation] Wrote ${segments.length} segment(s) for batch ${batchId} (${filename})`);
}

export function finishDocumentBatch(batchId: string, filename: string, state: StateManager): void {
  const sourceTag = `import:document:${filename}`;

  const emmettMessages = state.messages_get("emmet");
  const docMessages = emmettMessages.filter(m => m.external === true && m.source_tag === sourceTag);

  if (docMessages.length === 0) {
    console.warn(`[finishDocumentBatch] No messages found for ${sourceTag} — skipping extraction`);
  } else {
    const extractionContext: ExtractionContext = {
      personaId: "emmet",
      channelDisplayName: "Document",
      messages_context: [],
      messages_analyze: docMessages,
      sources: [sourceTag],
    };

    const docSettings = state.getHuman().settings?.document;
    queueAllScans(extractionContext, state, {
      extraction_model: docSettings?.extraction_model,
      external_filter: "only",
    });

    console.log(`[finishDocumentBatch] Queued extraction for ${docMessages.length} message(s) from ${filename}`);
  }

  const updatedHuman = state.getHuman();
  state.setHuman({
    ...updatedHuman,
    settings: {
      ...updatedHuman.settings,
      document: {
        ...updatedHuman.settings?.document,
        processed_documents: {
          ...(updatedHuman.settings?.document?.processed_documents ?? {}),
          [filename]: new Date().toISOString(),
        },
      },
    },
  });

  console.log(`[finishDocumentBatch] Batch ${batchId} complete, ${filename} marked processed`);
}
