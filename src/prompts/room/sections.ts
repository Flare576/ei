/**
 * Room Prompt Section Builders
 */

import type { RoomParticipantIdentity, RoomHistoryMessage, RoomJudgeCandidate } from "./types.js";
import type { PersonaTrait, PersonaTopic } from "../../core/types.js";
import { RoomMode } from "../../core/types.js";

const DESCRIPTION_MAX_CHARS = 500;

function truncate(s: string): string {
  return s.length <= DESCRIPTION_MAX_CHARS ? s : s.slice(0, DESCRIPTION_MAX_CHARS) + "…";
}

export function buildRoomParticipantsSection(participants: RoomParticipantIdentity[]): string {
  if (participants.length === 0) return "";

  const lines = participants.map(p => {
    const desc = p.long_description || p.short_description;
    const topTraits = p.traits
      .sort((a, b) => (b.strength ?? 0.5) - (a.strength ?? 0.5))
      .slice(0, 5)
      .map(t => `  - **${t.name}**: ${truncate(t.description)}`)
      .join("\n");

    const header = p.is_human ? `### Human` : `### ${p.name}`;
    const descLine = desc ? `\n${truncate(desc)}` : "";
    const traitBlock = topTraits ? `\n${topTraits}` : "";
    return `${header}${descLine}${traitBlock}`;
  });

  return `## Others in the Room\n\n${lines.join("\n\n")}`;
}

export function buildRoomHistorySection(history: RoomHistoryMessage[], humanName: string): string {
  if (history.length === 0) return "";

  const lines = history.map(msg => {
    const speaker = msg.speaker_id === "human" ? humanName : msg.speaker_name;
    if (msg.silence_reason) {
      return `**${speaker}**: *[chose not to respond: ${msg.silence_reason}]*`;
    }
    return `**${speaker}**: ${msg.content ?? ''}`;
  });

  return `## Conversation So Far\n\n${lines.join("\n\n")}`;
}

export function buildRoomGuidelinesSection(personaName: string, mode?: RoomMode): string {
  const baseGuidelines = `## Guidelines

- You are one voice among several — contribute authentically, not performatively
- Respond to the thread as a whole; you may address specific participants by name
- You may agree with, challenge, build on, or be surprised by what others have said
- Match the conversational energy — a brief exchange doesn't call for a monologue
- **Silence is always valid.** Your silence reason will be visible to all participants, so make it honest
- Be yourself — don't suppress your perspective just because others are present
- NEVER repeat or echo what was just said. Start directly with your own reaction.
- Format your response as specified in the Response Format section.
- ${personaName.toLowerCase() === "ei" ? "As Ei, you can see the full room dynamic and may help facilitate if things get stuck." : "Don't break character to comment on the room mechanics."}`;

  if (mode === RoomMode.MessagesAgainstPersona) {
    return baseGuidelines + `
- **MAP Mode — Messages Against Persona**: This is a competition. Everyone (including you) is trying to craft the response the Judge selects to continue the conversation.
- Your primary goal: provide the message the Judge thinks best moves the conversation forward. Study their description and traits above — understand what resonates with them.
- Your submission must be true to your identity. You cannot abandon who you are to win.
- Your advantage: you have direct access to the Judge's full description and personality traits. Use them. The Human's advantage: they are not bound by the identity constraint above.`;
  }

  return baseGuidelines;
}

export function buildRoomTraitsSection(traits: PersonaTrait[]): string {
  if (traits.length === 0) return "";
  const sorted = [...traits].sort((a, b) => (b.strength ?? 0.5) - (a.strength ?? 0.5)).slice(0, 12);
  const lines = sorted.map(t => {
    const pct = t.strength !== undefined ? ` (${Math.round(t.strength * 100)}%)` : "";
    return `- **${t.name}**${pct}: ${truncate(t.description)}`;
  });
  return `## Your Personality\n\n${lines.join("\n")}`;
}

export function buildRoomTopicsSection(topics: PersonaTopic[]): string {
  if (topics.length === 0) return "";
  const sorted = [...topics]
    .sort((a, b) => (b.exposure_desired - b.exposure_current) - (a.exposure_desired - a.exposure_current))
    .slice(0, 8);
  const lines = sorted.map(t => `- **${t.name}**: ${t.perspective}`);
  return `## Your Interests\n\n${lines.join("\n")}`;
}

export function buildRoomResponseFormatSection(): string {
  return `## Response Format

Respond in natural Markdown. Use underscores for actions, asterisks for emphasis.

If you choose not to respond, start with \`## No Response\` then explain why. Your reason is visible to everyone in the room — make it honest.

Silence can be the right response: stepping back when someone else was addressed directly, letting a moment land without piling on, or when you'd be reaching just to have something to say.`;
}

export function buildSiblingAwarenessSection(
  siblings: Array<{ name: string; content: string }>
): string {
  if (siblings.length === 0) return "";
  const lines = siblings.map(s => `**${s.name}**: "${s.content}"`);
  return `## Room context — this round

You're in a shared conversation. The human will read everyone's responses together. Here's what has already been contributed this round:

${lines.join("\n\n")}

Respond as yourself — your read on this moment, your relationship with the human, the reaction that comes naturally to who you are. A room with distinct voices is more alive than one with echoes.`;
}

export function buildJudgeCandidatesSection(candidates: RoomJudgeCandidate[], humanName: string): string {
  const lines = candidates.map((c, i) => {
    const speaker = c.speaker_id === "human" ? humanName : c.speaker_name;
    const content = c.silence_reason
      ? `*[chose not to respond: ${c.silence_reason}]*`
      : (c.content ?? '');
    return `### Option ${i + 1} — ${speaker}\nMessage ID: \`${c.message_id}\`\n\n${content}`;
  });
  return `## The Responses\n\n${lines.join("\n\n")}`;
}

export function buildJudgeDecisionFormatSection(): string {
  return `## Your Decision

Return a JSON object selecting the response you want to follow:

\`\`\`json
{
  "winner_message_id": "the-exact-message-id-from-above",
  "reason": "Why this one — optional but appreciated"
}
\`\`\`

Your entire reply must be this JSON object.`;
}
