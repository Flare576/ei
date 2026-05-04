import { ContextStatus } from "../types.js";
import type { LLMResponse, Message } from "../types.js";
import type { StateManager } from "../state-manager.js";

export function handleKnowledgeSynthesis(response: LLMResponse, state: StateManager): void {
  const { slug, subject } = response.request.data as {
    slug: string;
    subject: string;
  };

  if (!slug || !subject) {
    console.error("[handleKnowledgeSynthesis] Missing slug or subject in request data");
    return;
  }

  const content = response.content?.trim() ?? "";
  if (!content) {
    console.error(`[handleKnowledgeSynthesis] Empty or null response content for slug "${slug}" — skipping message write`);
    return;
  }

  const now = new Date().toISOString();
  const sourceTag = `generate:document:${slug}`;

  const message: Message = {
    id: crypto.randomUUID(),
    role: "system",
    content,
    timestamp: now,
    read: true,
    context_status: ContextStatus.Always,
    external: true,
    source_tag: sourceTag,
  };

  state.messages_append("emmet", message);

  const updatedHuman = state.getHuman();
  state.setHuman({
    ...updatedHuman,
    settings: {
      ...updatedHuman.settings,
      document: {
        ...updatedHuman.settings?.document,
        generated_documents: {
          ...(updatedHuman.settings?.document?.generated_documents ?? {}),
          [slug]: { subject, created_at: now },
        },
      },
    },
  });

}
