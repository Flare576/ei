import type { Message } from "../core/types.js";

const MESSAGE_PLACEHOLDER_REGEX = /\[mid:([a-zA-Z0-9_-]+):([^\]]+)\]/g;

/**
 * Returns the display text for a message from its structured fields.
 * - action_response as _italics_
 * - verbal_response as plain text
 * - silence_reason shown so the user understands why a persona stayed silent
 */
export function getMessageDisplayText(message: Message): string | null {
  const parts: string[] = [];
  if (message.action_response) parts.push(`_${message.action_response}_`);
  if (message.verbal_response) parts.push(message.verbal_response);
  if (message.silence_reason) {
    const name = 'Persona'; // Caller doesn't pass persona name; frontends can override
    parts.push(`[${name} chose not to respond because: ${message.silence_reason}]`);
  }
  if (parts.length === 0) return null;
  return parts.join('\n\n');
}

/**
 * Builds the content string for a ChatMessage sent to the LLM.
 * Unlike getMessageDisplayText (which is for frontend rendering and skips silence),
 * this includes ALL structured fields so the persona has full conversational context:
 *   - action_response as _italics_
 *   - verbal_response as plain text
 *   - silence_reason as "You chose not to respond because: ..."
 */
export function buildChatMessageContent(message: Message): string {
  const parts: string[] = [];
  if (message.action_response) parts.push(`_${message.action_response}_`);
  if (message.verbal_response) parts.push(message.verbal_response);
  if (message.silence_reason) {
    parts.push(`You chose not to respond because: ${message.silence_reason}`);
  }
  return parts.join('\n\n');
}

export function formatMessageAsPlaceholder(message: Message, personaName: string): string {
  const role = message.role === "human" ? "human" : personaName;
  return `[mid:${message.id}:${role}]`;
}

export function formatMessagesAsPlaceholders(messages: Message[], personaName: string): string {
  // Skip silence-only messages — they're not conversational context for the LLM
  const conversational = messages.filter(m => m.silence_reason === undefined);
  if (conversational.length === 0) return "(No messages)";
  return conversational.map(m => formatMessageAsPlaceholder(m, personaName)).join('\n\n');
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
