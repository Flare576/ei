import type { Message } from "../core/types.js";

const MESSAGE_PLACEHOLDER_REGEX = /\[mid:([a-f0-9-]+):([^\]]+)\]/g;

export function formatMessageAsPlaceholder(message: Message, personaName: string): string {
  const role = message.role === "human" ? "human" : personaName;
  return `[mid:${message.id}:${role}]`;
}

export function formatMessagesAsPlaceholders(messages: Message[], personaName: string): string {
  if (messages.length === 0) return "(No messages)";
  return messages.map(m => formatMessageAsPlaceholder(m, personaName)).join('\n\n');
}

export function hydratePromptPlaceholders(
  prompt: string,
  messageMap: Map<string, Message>
): string {
  return prompt.replace(MESSAGE_PLACEHOLDER_REGEX, (_match, id, role) => {
    const message = messageMap.get(id);
    if (!message) {
      return `[${role}]: [message not found]`;
    }
    const displayRole = message.role === "human" ? "[human]" : `[${role}]`;
    return `${displayRole}: ${message.content}`;
  });
}

export function buildMessageMapFromPersonas(
  personaMessages: Map<string, Message[]>
): Map<string, Message> {
  const map = new Map<string, Message>();
  for (const messages of personaMessages.values()) {
    for (const msg of messages) {
      map.set(msg.id, msg);
    }
  }
  return map;
}
