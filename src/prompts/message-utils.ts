import type { Message } from "../core/types.js";
import { getMessageContent } from "../core/handlers/utils.js";

const MESSAGE_PLACEHOLDER_REGEX = /\[mid:(.+):([^:\]]+)\]/g;

export function getMessageDisplayText(message: Message): string | null {
  const parts: string[] = [];
  const content = getMessageContent(message);
  if (content) parts.push(content);
  if (message.silence_reason) {
    const name = message.role === "human"
      ? (message.speaker_name ?? 'Human')
      : (message.speaker_name ?? 'Persona');
    parts.push(`[${name} chose not to respond because: ${message.silence_reason}]`);
  }
  if (parts.length === 0) return null;
  return parts.join('\n\n');
}

export function buildChatMessageContent(message: Message, humanName?: string): string {
  const parts: string[] = [];
  const content = getMessageContent(message);

  if (message._synthesis && content) {
    parts.push(`[${humanName ?? 'The user'} used your conversation to generate an image. The full prompt was: "${content}"]`);
  } else if (content) {
    parts.push(content);
  }
  if (message.silence_reason) {
    const silentParty = message.role === "human" ? (humanName ?? "The human") : "You";
    parts.push(`${silentParty} chose not to respond because: ${message.silence_reason}`);
  }
  return parts.join('\n\n');
}

export function formatMessageAsPlaceholder(message: Message, personaName: string): string {
  const role = message.role === "human" ? "human" : (message.speaker_name ?? personaName);
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
    const text = getMessageDisplayText(message) ?? "[no content]";
    return `${displayRole}: ${text}`;
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
