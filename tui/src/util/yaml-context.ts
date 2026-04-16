import YAML from "yaml";
import type { Message, RoomMessage } from "../../../src/core/types.js";
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

interface FfaEditableChild {
  id: string;
  role: "persona";
  speaker: string;
  context_status: ContextStatus;
  _delete?: boolean;
  content?: string;
  silence_reason?: string;
}

interface FfaEditableHumanMessage {
  id: string;
  role: "human";
  context_status: ContextStatus;
  _delete?: boolean;
  content?: string;
  silence_reason?: string;
  children: FfaEditableChild[];
}

export function ffaContextToYAML(
  messages: RoomMessage[],
  speakerMap: Map<string, string>
): string {
  const header = [
    "# context_status: default | always | never",
    "# _delete: true — permanently removes the message",
    "# Deleting a human message also deletes its persona responses",
  ].join("\n");

  const rootMsg = messages.find((m) => m.parent_id === null);
  if (!rootMsg) return header + "\n[]";

  const humanMessages = messages.filter(
    (m) => m.role === "human" && m.parent_id === rootMsg.id
  );

  const data: FfaEditableHumanMessage[] = humanMessages.map((hm) => {
    const children = messages
      .filter((m) => m.role === "persona" && m.parent_id === hm.id)
      .map((pm) => {
        const speaker = pm.persona_id
          ? (speakerMap.get(pm.persona_id) ?? pm.persona_id.slice(0, 8))
          : "unknown";
        const child: FfaEditableChild = {
          id: pm.id,
          role: "persona",
          speaker,
          context_status: pm.context_status,
          _delete: false,
          content: getContent(pm) || undefined,
          silence_reason: pm.silence_reason,
        };
        if (!child.content) delete child.content;
        if (!child.silence_reason) delete child.silence_reason;
        return child;
      });

    const entry: FfaEditableHumanMessage = {
      id: hm.id,
      role: "human",
      context_status: hm.context_status,
      _delete: false,
      content: getContent(hm) || undefined,
      silence_reason: hm.silence_reason,
      children,
    };
    if (!entry.content) delete entry.content;
    if (!entry.silence_reason) delete entry.silence_reason;
    return entry;
  });

  return header + "\n" + YAML.stringify(data, { lineWidth: 0 });
}

export interface FfaContextYAMLResult {
  messages: Array<{ id: string; context_status: ContextStatus }>;
  deletedMessageIds: string[];
}

export function ffaContextFromYAML(yamlContent: string): FfaContextYAMLResult {
  const data = YAML.parse(yamlContent) as FfaEditableHumanMessage[];

  const deletedMessageIds: string[] = [];
  const messages: Array<{ id: string; context_status: ContextStatus }> = [];

  for (const hm of data ?? []) {
    if (hm._delete) {
      deletedMessageIds.push(hm.id);
      for (const child of hm.children ?? []) {
        deletedMessageIds.push(child.id);
      }
    } else {
      const normalized = (hm.context_status ?? 'default').toString().toLowerCase() as ContextStatus;
      messages.push({ id: hm.id, context_status: normalized });
      for (const child of hm.children ?? []) {
        if (child._delete) {
          deletedMessageIds.push(child.id);
        } else {
          const childNormalized = (child.context_status ?? 'default').toString().toLowerCase() as ContextStatus;
          messages.push({ id: child.id, context_status: childNormalized });
        }
      }
    }
  }

  return { messages, deletedMessageIds };
}
