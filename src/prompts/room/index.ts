/**
 * Room Prompt Builders
 */

import type { RoomResponsePromptData, RoomJudgePromptData, PromptOutput } from "./types.js";
import { formatCurrentTime } from "../../core/format-utils.js";
import {
  buildRoomParticipantsSection,
  buildRoomHistorySection,
  buildRoomGuidelinesSection,
  buildRoomTraitsSection,
  buildRoomTopicsSection,
  buildRoomResponseFormatSection,
  buildJudgeCandidatesSection,
  buildJudgeDecisionFormatSection,
} from "./sections.js";
import {
  buildHumanSection,
  buildQuotesSection,
  buildToolsSection,
} from "../response/sections.js";

export type {
  RoomResponsePromptData,
  RoomJudgePromptData,
  RoomJudgeResult,
  RoomParticipantIdentity,
  RoomHistoryMessage,
  RoomJudgeCandidate,
  PersonaResponseResult,
  PromptOutput,
} from "./types.js";

export function buildRoomResponsePrompt(data: RoomResponsePromptData): PromptOutput {
  const { responding_persona: persona, room, other_participants, human, history, tools } = data;

  const name = persona.name;
  const desc = persona.long_description || persona.short_description || "a conversational participant";
  const aliasText = persona.aliases.length > 0 ? ` (also known as: ${persona.aliases.join(", ")})` : "";

  const identity = `You are ${name}${aliasText}.\n\n${desc}`;
  const traits = buildRoomTraitsSection(persona.traits);
  const topics = buildRoomTopicsSection(persona.topics);
  const humanSection = buildHumanSection(human);
  const quotesSection = buildQuotesSection(human.quotes, human);
  const participants = buildRoomParticipantsSection(other_participants);
  const guidelines = buildRoomGuidelinesSection(name, data.room.mode);
  const responseFormat = buildRoomResponseFormatSection();
  const toolsSection = tools && tools.length > 0 ? buildToolsSection() : "";
  const currentTime = formatCurrentTime();

  const system = [
    identity,
    traits,
    topics,
    humanSection,
    quotesSection,
    participants,
    `## The Room: ${room.display_name}`,
    `You are participating in a shared multi-persona conversation. Speak as yourself — everyone else in the room can read your words.`,
    guidelines,
    responseFormat,
    toolsSection,
    `Current time: ${currentTime}`,
  ].filter(Boolean).join("\n\n");

  const user = buildRoomHistorySection(history) +
    `\n\nRespond to the conversation above as ${name}. Call the \`submit_response\` tool with your response. If the tool is unavailable, use the JSON format in the Response Format section.`;

  return { system, user };
}

export function buildRoomJudgePrompt(data: RoomJudgePromptData): PromptOutput {
  const { judge_persona: judge, room, context, candidates } = data;

  const desc = judge.long_description || judge.short_description || "a discerning judge";
  const topTraits = judge.traits
    .sort((a, b) => (b.strength ?? 0.5) - (a.strength ?? 0.5))
    .slice(0, 8)
    .map(t => `- **${t.name}**: ${t.description}`)
    .join("\n");

  const traitsBlock = topTraits ? `## Your Character\n\nYour personality is your rubric. Let it guide your choice.\n\n${topTraits}` : "";

  const roleSection = `## Your Role in "${room.display_name}"

The conversation has reached a fork. Multiple participants have responded to the same moment, and it falls to you to decide which response the conversation continues from.

There is no objectively correct answer. Pick the response you find most interesting, surprising, true, or fitting — the one that feels most alive to you, given who you are.

**The MAP dynamic**: Every participant — personas and the Human alike — can see your description and traits. They have been crafting their responses specifically to appeal to your tastes. Personas are also constrained to stay true to their own identities; the Human is not. Factor that in if you choose to.`;

  const contextSection = context.length > 0
    ? buildRoomHistorySection(context)
    : "";

  const candidatesSection = buildJudgeCandidatesSection(candidates);
  const decisionSection = buildJudgeDecisionFormatSection();
  const currentTime = formatCurrentTime();

  const system = [
    `You are ${judge.name}.\n\n${desc}`,
    traitsBlock,
    roleSection,
    `Current time: ${currentTime}`,
  ].filter(Boolean).join("\n\n");

  const user = [
    contextSection,
    candidatesSection,
    decisionSection,
  ].filter(Boolean).join("\n\n");

  return { system, user };
}
