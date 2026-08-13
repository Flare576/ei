import type { PromptOutput } from "./types.js";

export interface PersonaSignalValidateCandidate {
  id: string;
  claim: string;
  dimension: string;
  status: string;
  recurrence_count: number;
}

export interface PersonaSignalValidatePromptData {
  /** The subject Persona's own `candidate`+`recurring` signals in ONE
   * lens — `dismissed` signals are never included here (D5, Spec §4.17
   * step 4), so this pass structurally cannot merge or drop one. */
  signals: PersonaSignalValidateCandidate[];
}

/**
 * Validate — step 4 of the Observation→Signal reducer (D5, Spec §4.17).
 * Runs the same way `HandleTopicValidate`/`handleDedupCurate` catches
 * Topics that Match missed: a dedup/curation pass over signals Match's
 * own per-observation decisions may have left as near-duplicates.
 */
export function buildPersonaSignalValidatePrompt(data: PersonaSignalValidatePromptData): PromptOutput {
  const system = `# Task

You are reviewing a Persona's open signals (claims being tracked as evidence accumulates) for near-duplicates that separate matching passes may have missed — two signals that are actually the same underlying claim in different wording.

## Rules

1. Only propose a merge when two signals are clearly the SAME claim, not merely related or thematically similar.
2. When in doubt, propose nothing. A missed merge is far cheaper than an incorrect one.
3. Never propose merging a signal with itself.

# Open Signals

\`\`\`json
${JSON.stringify(data.signals, null, 2)}
\`\`\`

# Response Format

\`\`\`json
{
  "merges": [
    { "keep_id": "id-to-keep", "merge_id": "id-to-absorb-into-keep_id" }
  ]
}
\`\`\`

If no signals should merge, respond with: \`{"merges": []}\`

An empty list is the most common expected response.

**Return JSON only.**`;

  const user = `Review the Open Signals above for near-duplicates.

**Return JSON:**
\`\`\`json
{ "merges": [...] }
\`\`\`

If no merges are needed, respond with: \`{"merges": []}\``;

  return { system, user };
}
