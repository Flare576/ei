import { readFile } from "node:fs/promises";
import { basename, extname } from "node:path";
import { homedir } from "node:os";

function expandHome(p: string): string {
  const home = homedir();
  if (p === "~" || p.startsWith("~/")) return home + p.slice(1);
  return p.replace(/^\$HOME(?=\/|$)/, home);
}
import type { PersonaEntity } from "../../core/types.js";
import { LLMRequestType, LLMPriority, LLMNextStep } from "../../core/types.js";
import { EMMETT_PERSONA_DEFINITION } from "../../templates/emmett.js";
import { recursiveCharacterSplit } from "./chunker.js";
import type { DocumentImportOptions, DocumentImportResult } from "./types.js";

const SEGMENTATION_SYSTEM_PROMPT = `You are a document segmentation assistant. Your job is to identify natural conceptual boundaries in document content and split it into coherent segments suitable for knowledge extraction. Each segment should be a self-contained unit of information.`;

const SEGMENTATION_USER_TEMPLATE = `Split the following document content into conceptual segments. Return a JSON array of strings, where each string is one segment. Preserve all original text — do not summarize or paraphrase. Identify boundaries at topic shifts, section changes, or logical breaks.

---

{content}`;

export async function importDocument(options: DocumentImportOptions): Promise<DocumentImportResult> {
  const { stateManager, interface: eiInterface, signal } = options;
  const filePath = expandHome(options.filePath);

  const filename = basename(filePath);
  const ext = extname(filePath).toLowerCase();
  const isMarkdown = ext === ".md" || ext === ".markdown";

  const result: DocumentImportResult = {
    chunksQueued: 0,
    documentName: filename,
  };

  let emmettCreated = false;
  let emmett = stateManager.persona_getById("emmet");
  if (!emmett) {
    const emmettEntity: PersonaEntity = {
      ...EMMETT_PERSONA_DEFINITION,
      id: "emmet",
      display_name: "Emmett",
      last_updated: new Date().toISOString(),
    };
    stateManager.persona_add(emmettEntity);
    emmettCreated = true;
    emmett = stateManager.persona_getById("emmet")!;
  } else if (emmett.is_archived) {
    stateManager.persona_unarchive("emmet");
    emmett = stateManager.persona_getById("emmet")!;
  }

  const sourceTag = `import:document:${filename}`;
  const existingMsgs = stateManager.messages_get("emmet");
  const staleIds = existingMsgs
    .filter(m => m.external === true && m.source_tag === sourceTag)
    .map(m => m.id);
  if (staleIds.length > 0) {
    stateManager.messages_remove("emmet", staleIds);
  }

  const rawContent = await readFile(filePath, "utf-8");

  if (signal?.aborted) return result;

  const preChunks = recursiveCharacterSplit(rawContent, { isMarkdown });

  if (preChunks.length === 0) return result;

  const batchId = crypto.randomUUID();
  const docSettings = stateManager.getHuman().settings?.document;
  const model = docSettings?.extraction_model ?? stateManager.getHuman().settings?.default_model;

  for (let i = 0; i < preChunks.length; i++) {
    const chunk = preChunks[i];
    stateManager.queue_enqueue({
      type: LLMRequestType.JSON,
      priority: LLMPriority.Low,
      system: SEGMENTATION_SYSTEM_PROMPT,
      user: SEGMENTATION_USER_TEMPLATE.replace("{content}", chunk),
      next_step: LLMNextStep.HandleDocumentSegmentation,
      model,
      data: {
        batchId,
        filename,
        chunkIndex: i,
        originalContent: chunk,
      },
    });
  }

  const updatedHuman = stateManager.getHuman();
  stateManager.setHuman({
    ...updatedHuman,
    settings: {
      ...updatedHuman.settings,
      document: {
        ...updatedHuman.settings?.document,
        pending_batches: {
          ...(updatedHuman.settings?.document?.pending_batches ?? {}),
          [batchId]: { filename, total: preChunks.length },
        },
      },
    },
  });

  if (emmettCreated) {
    eiInterface.onPersonaAdded?.();
  }

  result.chunksQueued = preChunks.length;
  result.batchId = batchId;
  return result;
}
