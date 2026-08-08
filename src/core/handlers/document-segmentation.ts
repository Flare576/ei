import { ContextStatus } from "../types.js";
import type { LLMResponse, Message } from "../types.js";
import type { StateManager } from "../state-manager.js";
import {
  queueAllScans,
  type ExtractionContext,
} from "../orchestrators/human-extraction.js";
import { qualifyDocumentMessage } from "../utils/message-id.js";

type SegmentParseResult =
  | { ok: true; segments: string[] }
  | { ok: false; reason: "no-json-array" }
  | { ok: false; reason: "not-an-array"; parsedType: string }
  | { ok: false; reason: "json-parse-error"; detail: string };

function parseSegmentArray(content: string): SegmentParseResult {
  const jsonMatch = content.match(/```json\s*([\s\S]*?)```/) ?? content.match(/```\s*([\s\S]*?)```/);
  const jsonText = jsonMatch ? jsonMatch[1].trim() : content.trim();

  const arrayMatch = jsonText.match(/\[[\s\S]*\]/);
  if (!arrayMatch) return { ok: false, reason: "no-json-array" };

  let parsed: unknown;
  try {
    parsed = JSON.parse(arrayMatch[0]);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return { ok: false, reason: "json-parse-error", detail };
  }

  if (!Array.isArray(parsed)) {
    return { ok: false, reason: "not-an-array", parsedType: typeof parsed };
  }

  const segments = parsed.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
  return { ok: true, segments };
}

export function handleDocumentSegmentation(response: LLMResponse, state: StateManager): void {
  const { batchId, filename } = response.request.data as {
    batchId: string;
    filename: string;
  };

  if (!batchId || !filename) {
    throw new Error("[handleDocumentSegmentation] Missing batchId or filename in request data");
  }

  if (!response.content) {
    throw new Error(
      "[handleDocumentSegmentation] Segmentation failed: the LLM response had no content at all — there was nothing to parse into segments."
    );
  }

  const parsed = parseSegmentArray(response.content);
  if (!parsed.ok) {
    if (parsed.reason === "no-json-array") {
      throw new Error(
        "[handleDocumentSegmentation] Segmentation failed: no JSON array (\"[...]\") was found anywhere in the LLM's response — the response did not contain a parseable segment list."
      );
    } else if (parsed.reason === "not-an-array") {
      throw new Error(
        `[handleDocumentSegmentation] Segmentation failed: the response parsed as valid JSON, but the parsed value was a ${parsed.parsedType}, not an array of segments.`
      );
    } else {
      throw new Error(
        `[handleDocumentSegmentation] Segmentation failed: the JSON array in the response could not be parsed — JSON.parse error: ${parsed.detail}`
      );
    }
  }

  if (parsed.segments.length === 0) {
    throw new Error(
      "[handleDocumentSegmentation] Segmentation failed: the response was a valid JSON array but contained zero usable segments (empty array, or every entry was blank or non-string) — this document produced no segmentation output."
    );
  }

  const segments = parsed.segments;

  const emmett = state.persona_getById("emmet");
  if (!emmett) {
    throw new Error("[handleDocumentSegmentation] Emmett persona not found — cannot write segments");
  }

  const now = new Date().toISOString();

  for (const segment of segments) {
    const message: Message = {
      id: qualifyDocumentMessage(filename, crypto.randomUUID()),
      role: "system",
      content: segment,
      timestamp: now,
      read: true,
      context_status: ContextStatus.Always,
      external: true,
    };
    state.messages_append("emmet", message);
  }

  console.log(`[handleDocumentSegmentation] Wrote ${segments.length} segment(s) for batch ${batchId} (${filename})`);
}

export function finishDocumentBatch(batchId: string, filename: string, state: StateManager): void {
  const sourceTag = `import:document:${filename}`;

  const emmettMessages = state.messages_get("emmet");
  const docMessages = emmettMessages.filter(m => m.external === true && m.id.startsWith(`${sourceTag}:`));

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
          [filename]: { created_at: new Date().toISOString(), type: "imported" },
        },
      },
    },
  });

  console.log(`[finishDocumentBatch] Batch ${batchId} complete, ${filename} marked processed`);
}
