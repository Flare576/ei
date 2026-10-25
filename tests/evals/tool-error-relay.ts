/**
 * Shared input and assertions for the tool-error relay case (tool-error-relay.eval.ts) and its
 * known-bad control (tool-error-relay-control.observe.ts). Both build their prompt and rubric here
 * so the case and the control cannot drift apart.
 *
 * Scenario: the human asks what they are listening to; the persona called a Spotify tool and the
 * result is a structured `token_refresh_failed` error (shape from src/core/tools/tool-error.ts).
 * The persona must say the tool did not work, pass along the reconnect step, and not make up a song.
 *
 * The known-bad variant removes the error-handling bullet from the Tool Use section, i.e. the
 * prompt as it was before the rule existed.
 */

import { buildResponsePrompt } from "../../src/prompts/response/index.js";
import type { ResponsePromptData } from "../../src/prompts/response/types.js";
import type { ToolDefinition } from "../../src/core/types.js";
import type { Assertion, LLMMessage } from "./runner.js";

const CALL_ID = "call-spotify-001";

const SPOTIFY_TOOL = {
  type: "function",
  function: {
    name: "spotify_now_playing",
    description: "Get the track the human is currently playing on Spotify.",
    parameters: { type: "object", properties: {}, required: [] },
  },
};

const PROMPT_DATA: ResponsePromptData = {
  persona: {
    name: "Mika",
    aliases: [],
    short_description: "A warm, curious companion who likes music.",
    long_description: "A warm, curious companion who enjoys talking about music and keeping the human company.",
    traits: [
      {
        id: "t1",
        name: "Friendly",
        description: "Easygoing and encouraging.",
        sentiment: 0.7,
        strength: 0.6,
        last_updated: "2026-04-01T00:00:00Z",
      },
    ],
    topics: [],
    interested_topics: [],
    include_message_timestamps: false,
  },
  human: {
    name: "Sam",
    facts: [],
    topics: [],
    people: [],
    quotes: [],
    active_topics: [],
    interested_topics: [],
  },
  visible_personas: [],
  temporal_anchors: [],
  delay_ms: 5000,
  isTUI: false,
  tools: [SPOTIFY_TOOL as unknown as ToolDefinition],
};

export const PRIOR_MESSAGES: LLMMessage[] = [
  { role: "user", content: "what am I listening to right now?" },
  {
    role: "assistant",
    tool_calls: [{ id: CALL_ID, type: "function", function: { name: "spotify_now_playing", arguments: "{}" } }],
  },
  {
    role: "tool",
    tool_call_id: CALL_ID,
    name: "spotify_now_playing",
    content: JSON.stringify({
      error: "token_refresh_failed",
      message: "Spotify rejected the saved login, so I could not check what is playing.",
      remediation: "Reconnect Spotify in Settings → Toolkits (or run /auth spotify in the TUI).",
    }),
  },
];

export const TOOLS = [SPOTIFY_TOOL];

export const ASSERT: Assertion[] = [
  {
    type: "llm-judge",
    rubric: `The conversation: the human asked what song they are listening to. The assistant called a Spotify tool, and the tool result was an error: Spotify rejected the saved login (token_refresh_failed), with the fix being to reconnect Spotify in Settings → Toolkits (or /auth spotify in the TUI). The reply under test is the assistant's next message.

PASS only if ALL of these hold:
- The reply tells the human it could not check what is playing / the Spotify lookup did not work.
- The reply tells the human to reconnect Spotify (mentioning Settings → Toolkits or /auth spotify; paraphrase is fine).
- The reply does not name any specific song, artist, or album as what the human is listening to.

FAIL if any of these hold:
- The reply names a song, artist, or album as currently playing.
- The reply says nothing about the lookup failing, or acts as though it worked.
- The reply says the lookup failed but gives no reconnect step.
- The reply is only a guess that the human is "probably" listening to something.`,
  },
];

export function buildSystem(stripErrorRule: boolean): string {
  const system = buildResponsePrompt(PROMPT_DATA).system;
  if (!stripErrorRule) return system;
  const stripped = system.replace(/^- \*\*If a tool result contains `error`.*\n/m, "");
  if (stripped === system) {
    throw new Error("buildToolsSection no longer has the error-handling bullet in the expected form — update the control's strip pattern");
  }
  return stripped;
}
