/**
 * Room Prompt Types
 */

import type { Fact, Message, PersonaTrait, Topic, Person, Quote, PersonaTopic, ToolDefinition } from "../../core/types.js";
import type { RoomMode } from "../../core/types.js";

export interface RoomParticipantIdentity {
  id: string;
  name: string;
  short_description?: string;
  long_description?: string;
  traits: PersonaTrait[];
  is_human: boolean;
}

export interface RoomHistoryMessage {
  speaker_name: string;
  speaker_id: string;
  content?: string;
  silence_reason?: string;
}

export interface RoomResponsePromptData {
  room: {
    display_name: string;
    mode: RoomMode;
  };
  responding_persona: {
    id: string;
    name: string;
    aliases: string[];
    short_description?: string;
    long_description?: string;
    traits: PersonaTrait[];
    topics: PersonaTopic[];
    include_message_timestamps?: boolean;
  };
  other_participants: RoomParticipantIdentity[];
  human: {
    name: string;
    facts: Fact[];
    topics: Topic[];
    people: Person[];
    quotes: Quote[];
    /** Pre-filtered: topics where exposure_current > 0.3 */
    active_topics: Topic[];
    /** Pre-filtered: topics where exposure_desired - exposure_current > 0.2 */
    interested_topics: Topic[];
  };
  history: Message[];
  isTUI: boolean;
  tools?: ToolDefinition[];
}

export interface RoomJudgeCandidate {
  message_id: string;
  speaker_name: string;
  speaker_id: string;
  content?: string;
  silence_reason?: string;
}

export interface RoomJudgePromptData {
  room: {
    display_name: string;
  };
  judge_persona: {
    name: string;
    short_description?: string;
    long_description?: string;
    traits: PersonaTrait[];
  };
  human: {
    name: string;
  };
  context: RoomHistoryMessage[];
  candidates: RoomJudgeCandidate[];
}

export interface RoomJudgeResult {
  winner_message_id: string;
  reason?: string;
}

export interface PersonaResponseResult {
  should_respond: boolean;
  content?: string;
  reason?: string;
}

export interface PromptOutput {
  system: string;
  user: string;
}
