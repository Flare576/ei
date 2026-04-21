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

function getContent(m: { content?: string }): string {
  return m.content ?? '';
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

interface FfaEditableNode {
  id: string;
  role: "human" | "persona";
  speaker?: string;
  context_status: ContextStatus;
  _delete?: boolean;
  content?: string;
  silence_reason?: string;
  children?: FfaEditableNode[];
}

function buildNode(msg: RoomMessage, messages: RoomMessage[], speakerMap: Map<string, string>, isRoot = false): FfaEditableNode {
  const children = messages
    .filter((m) => m.parent_id === msg.id)
    .map((child) => buildNode(child, messages, speakerMap));

  const node: FfaEditableNode = {
    id: msg.id,
    role: msg.role === "human" ? "human" : "persona",
    context_status: msg.context_status,
    ...(!isRoot && { _delete: false }),
  };

  if (msg.role === "persona" && msg.persona_id) {
    node.speaker = speakerMap.get(msg.persona_id) ?? msg.persona_id.slice(0, 8);
  }

  const text = getContent(msg);
  if (text) node.content = text;
  if (msg.silence_reason) node.silence_reason = msg.silence_reason;
  if (children.length > 0) node.children = children;

  return node;
}

export function ffaContextToYAML(
  messages: RoomMessage[],
  speakerMap: Map<string, string>
): string {
  const header = [
    "# context_status: default | always | never",
    "# _delete: true — removes this message and all its descendants",
  ].join("\n");

  const rootMsg = messages.find((m) => m.parent_id === null);
  if (!rootMsg) return header + "\n[]";

  return header + "\n" + YAML.stringify([buildNode(rootMsg, messages, speakerMap, true)], { lineWidth: 0 });
}

export interface FfaContextYAMLResult {
  messages: Array<{ id: string; context_status: ContextStatus }>;
  deletedMessageIds: string[];
  implicitDeleteCount: number;
}

export function ffaContextFromYAML(yamlContent: string): FfaContextYAMLResult {
  const data = YAML.parse(yamlContent) as FfaEditableNode[];

  const deletedMessageIds: string[] = [];
  const messages: Array<{ id: string; context_status: ContextStatus }> = [];
  let implicitDeleteCount = 0;

  function collectDeleted(node: FfaEditableNode, parentDeleted: boolean): void {
    const selfDeleted = parentDeleted || !!node._delete;
    if (selfDeleted) {
      deletedMessageIds.push(node.id);
      if (!node._delete) implicitDeleteCount++;
    } else {
      const normalized = (node.context_status ?? 'default').toString().toLowerCase() as ContextStatus;
      messages.push({ id: node.id, context_status: normalized });
    }
    for (const child of node.children ?? []) {
      collectDeleted(child, selfDeleted);
    }
  }

  const nodes = data ?? [];
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    const isRoot = i === 0;
    if (isRoot && node._delete) continue; // root deletion not allowed — it anchors the room
    collectDeleted(node, false);
  }

  return { messages, deletedMessageIds, implicitDeleteCount };
}
