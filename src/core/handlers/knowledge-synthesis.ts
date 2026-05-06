import { ContextStatus } from "../types.js";
import type { LLMResponse, Message } from "../types.js";
import type { StateManager } from "../state-manager.js";

export function handleKnowledgeSynthesis(response: LLMResponse, state: StateManager): void {
  const { slug, subject } = response.request.data as {
    slug: string;
    subject: string;
  };

  if (!slug || !subject) {
    throw new Error("[handleKnowledgeSynthesis] Missing slug or subject in request data");
  }

  const content = response.content?.trim() ?? "";
  if (!content) {
    throw new Error(`[handleKnowledgeSynthesis] Empty or null response content for slug "${slug}"`);
  }

  const now = new Date().toISOString();

  const message: Message = {
    id: `generate:document:${slug}:${crypto.randomUUID()}`,
    role: "system",
    content,
    timestamp: now,
    read: true,
    context_status: ContextStatus.Always,
    external: true,
  };

  state.messages_append("emmet", message);

  const updatedHuman = state.getHuman();
  state.setHuman({
    ...updatedHuman,
    settings: {
      ...updatedHuman.settings,
      document: {
        ...updatedHuman.settings?.document,
        processed_documents: {
          ...(updatedHuman.settings?.document?.processed_documents ?? {}),
          [slug]: { created_at: now, type: "generated", subject },
        },
      },
    },
  });
}
