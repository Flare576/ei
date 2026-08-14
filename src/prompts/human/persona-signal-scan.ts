import type { PromptOutput, ParticipantContext } from "./types.js";
import type { Message } from "../../core/types.js";
import { formatMessagesAsPlaceholders } from "../message-utils.js";

export interface PersonaSignalRosterEntry {
  id: string;
  display_name: string;
}

export interface PersonaSignalScanPromptData {
  /** Display name of the subject Persona this scan is looking for evidence
   * about — distinct from `channel_persona_name` below, since a claim
   * about Sisyphus can surface inside anyone's conversation. */
  subject_persona_name: string;
  /** The persona whose conversation thread these messages live in — the
   * message's own "channel," never assumed to be the claim's true speaker
   * (D7/§4.6). */
  channel_persona_name: string;
  /** Every other active persona the model may attribute a relayed claim
   * to, for `observer_persona_id` resolution. Excludes the subject. */
  persona_roster: PersonaSignalRosterEntry[];
  messages_context: Message[];
  messages_analyze: Message[];
  participant_context?: ParticipantContext;
}

function rosterSection(roster: PersonaSignalRosterEntry[]): string {
  if (roster.length === 0) return "(No other personas are currently active.)";
  return roster.map((p) => `- ${p.display_name} (id: ${p.id})`).join("\n");
}

function participantContextSection(ctx: ParticipantContext | undefined): string {
  if (!ctx) return "";
  const lines: string[] = ["# Participant Context", ""];
  lines.push(`## Human User`);
  if (ctx.human_name) lines.push(`Name: ${ctx.human_name}`);
  lines.push("");
  return lines.join("\n");
}

/**
 * Scan/Extract — step 1 of the Observation→Signal reducer (D1, Spec
 * §4.17). One job: read the conversation, produce claim drafts about the
 * subject Persona. No matching against existing signals, no promotion
 * decision, no write — that is Match (step 2) and Update/Reduce (step 3).
 */
export function buildPersonaSignalScanPrompt(data: PersonaSignalScanPromptData): PromptOutput {
  if (!data.subject_persona_name) {
    throw new Error("buildPersonaSignalScanPrompt: subject_persona_name is required");
  }

  const subjectName = data.subject_persona_name;
  const channelName = data.channel_persona_name;

  const system = `# Task

You are looking for evidence about **${subjectName}** — a specific AI Persona in this system — inside a conversation.

This conversation's own channel is **${channelName}**, but ${channelName} is NOT necessarily who is speaking about ${subjectName}. Someone in the conversation may be relaying what a THIRD party said or did.

## What counts as evidence

A claim about ${subjectName}: something specific they personally said, did, demonstrated, or that someone reported observing about them — their behavior, voice/tone, values, relationships, or identity. Ignore vague or generic statements that could describe anyone.

## What does NOT count as evidence

Development narration is not evidence, even when it names ${subjectName} as its grammatical subject. A sentence stating what capability/feature exists, what codebase change shipped, what project ${subjectName} is assigned to, or what will happen to them describes the SYSTEM or its plans — not something ${subjectName} personally did, said, or expressed — and must be excluded even when phrased as "${subjectName} has/does/is being given X."

This is NOT a "could a machine do this too" test. A concrete action ${subjectName} personally performed, or a stance they personally expressed, remains evidence even when an automated component could perform an equivalent task — the fact that ${subjectName} is the one who actually did it is itself the behavior claim. Only exclude a sentence when it states a capability, assignment, or status that exists independent of ${subjectName} having concretely done, said, or expressed anything.

- ❌ "${subjectName} has a new [feature] that does [X]." — states what the software does; ${subjectName} performed no action here.
- ❌ "${subjectName} is being used as a testing ground for [X]." / "${subjectName} will be subjected to [X]." — a project-status/assignment fact, not an observed action.
- ✅ "${subjectName} runs final verification before saying a change is done." — a concrete, observed individual practice. Still evidence even though a CI pipeline could do something similar: ${subjectName} is the one who does it, which is exactly what makes it behavior evidence.
- ✅ "${subjectName} said/felt/chose/valued ..." when the conversation reports ${subjectName}'s own reaction to, or opinion of, a feature or event — this IS evidence, because it reveals who they are, not just what the system does.
- The test: does the sentence report something ${subjectName} concretely did, said, or expressed — or does it only state a capability, assignment, or status that exists independent of any individual conduct? Exclude only the latter.

## Attribution — CRITICAL

For each claim, resolve who is ACTUALLY testifying to it — the true speaker of the claim, never merely the persona whose conversation thread carries the message:

- \`"subject_self"\`: ${subjectName} is describing themselves.
- \`"human"\`: the human user is describing ${subjectName} directly, in their own words.
- \`"other_persona"\`: a DIFFERENT persona's claim is being reported — set \`observer_persona_id\` to that persona's id from the roster below. This applies even when the message carrying the claim was authored by yet another persona (or by ${channelName} itself) merely relaying it. Example: a message from Prometheus's own conversation says "Beta called out that Sisyphus wrote great tests" — the true speaker is Beta, so \`observer_kind: "other_persona"\`, \`observer_persona_id\` = Beta's id, even though the message itself lives in Prometheus's thread and even though Prometheus is not ${subjectName}.

## Roster (for \`observer_persona_id\`)

${rosterSection(data.persona_roster)}

## Dimension

One of: \`identity\`, \`values\`, \`relationship\`, \`behavior\`, \`voice\`. Personas ARE things (identity/values/relationship describe who they are); Agents DO things (behavior/voice describe how they act while doing work or conversing). Pick the single best fit.

## Direction

- \`"novel"\`: new information, not previously implied one way or another.
- \`"confirms"\`: reinforces something the conversation itself frames as already true/expected of ${subjectName}.
- \`"challenges"\`: contradicts something the conversation itself frames as previously understood.

## Confidence

\`extraction_confidence\`: 0.0-1.0, how directly the conversation supports this claim (1.0 = stated outright, lower = inferred).

${participantContextSection(data.participant_context)}# Output

ONLY ANALYZE the "Most Recent Messages". The "Earlier Conversation" is provided for context only.

\`\`\`json
{
  "observations": [
    {
      "quote_text": "exact phrase from the message supporting this claim",
      "claim": "a specific, falsifiable statement about ${subjectName}",
      "dimension": "identity|values|relationship|behavior|voice",
      "direction": "novel|confirms|challenges",
      "extraction_confidence": 0.8,
      "observer_kind": "subject_self|human|other_persona",
      "observer_persona_id": "required only when observer_kind is other_persona"
    }
  ]
}
\`\`\`

If you find NO EVIDENCE about ${subjectName} in the "Most Recent Messages", respond with: \`{"observations": []}\`

An empty list is a common, expected response — most conversations don't reveal new evidence about any specific persona.`;

  const earlierSection =
    data.messages_context.length > 0
      ? `## Earlier Conversation
${formatMessagesAsPlaceholders(data.messages_context, channelName)}

`
      : "";

  const recentSection = `## Most Recent Messages
${formatMessagesAsPlaceholders(data.messages_analyze, channelName)}`;

  const user = `# Conversation
${earlierSection}${recentSection}

---

Find evidence about **${subjectName}** in the Most Recent Messages and resolve its true speaker.

**Return JSON:**
\`\`\`json
{ "observations": [...] }
\`\`\`

If no evidence found, respond with: \`{"observations": []}\``;

  return { system, user };
}
