import YAML from "yaml";
import type { Message } from "../../../src/core/types.js";
import { ContextStatus } from "../../../src/core/types.js";

interface EditableMessage {
  id: string;
  role: "human" | "system";
  timestamp: string;
  context_status: ContextStatus;
  _delete?: boolean;
  content?: string;
  silence_reason?: string;
}

function getContent(m: { content?: string; verbal_response?: string; action_response?: string }): string {
  if (m.content) return m.content;
  const parts: string[] = [];
  if (m.action_response) parts.push(`_${m.action_response}_`);
  if (m.verbal_response) parts.push(m.verbal_response);
  return parts.join('\n\n');
}

export function contextToYAML(messages: Message[]): string {
  const header = [
    "# context_status: default | always | never",
    "# _delete: true — permanently removes the message",
    "# content | silence_reason",
  ].join("\n");

  const data: EditableMessage[] = messages.map((m) => ({
    id: m.id,
    role: m.role,
    timestamp: m.timestamp,
    context_status: m.context_status,
    _delete: false,
    content: getContent(m) || undefined,
    silence_reason: m.silence_reason,
  }));

  return header + "\n" + YAML.stringify(data, { lineWidth: 0 });
}

export interface ContextYAMLResult {
  messages: Array<{ id: string; context_status: ContextStatus }>;
  deletedMessageIds: string[];
}

export function contextFromYAML(yamlContent: string): ContextYAMLResult {
  const data = YAML.parse(yamlContent) as EditableMessage[];

  const deletedMessageIds: string[] = [];
  const messages: Array<{ id: string; context_status: ContextStatus }> = [];

  for (const m of data ?? []) {
    if (m._delete) {
      deletedMessageIds.push(m.id);
    } else {
      const normalized = (m.context_status ?? 'default').toString().toLowerCase() as ContextStatus;
      messages.push({ id: m.id, context_status: normalized });
    }
  }

  return { messages, deletedMessageIds };
}


