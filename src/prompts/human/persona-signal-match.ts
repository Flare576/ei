import type { PromptOutput, PersonaSignalCandidate } from "./types.js";

export interface PersonaSignalMatchPromptData {
  candidate_claim: string;
  candidate_dimension: string;
  /** The subject Persona's own OPEN (candidate+recurring, never dismissed)
   * signals, already filtered to the SAME lens as the drafted observation
   * (D3, Spec §4.17 step 2) — the two lenses never share a Match candidate
   * list, so this list itself already enforces that separation by
   * construction; the prompt never needs to say so. */
  existing_signals: PersonaSignalCandidate[];
}

/**
 * Match — step 2 of the Observation→Signal reducer (D3, Spec §4.17). One
 * job: for the drafted observation, return an existing signal id it
 * belongs to, or "new". No promotion math, no write.
 */
export function buildPersonaSignalMatchPrompt(data: PersonaSignalMatchPromptData): PromptOutput {
  if (!data.candidate_claim) {
    throw new Error("buildPersonaSignalMatchPrompt: candidate_claim is required");
  }

  const system = `# Task

You are checking whether a new claim about a Persona restates an EXISTING signal already being tracked, or is genuinely new.

## Matching Rules

1. **Same underlying claim, different wording** → return its id
2. **Genuinely new claim** → return "new"

Be conservative. If you're unsure, return "new" — a duplicate is worse than a gap.

# Existing Signals

\`\`\`json
${JSON.stringify(data.existing_signals, null, 2)}
\`\`\`

# Response Format

Return ONLY the id of the matching signal, or "new".

\`\`\`json
{
  "matched_guid": "id-of-matching-signal" | "new"
}
\`\`\`

**Return JSON only.**`;

  const user = `# Candidate Claim

Dimension: ${data.candidate_dimension}
Claim: ${data.candidate_claim}

Find the best match in the existing signals above, or return "new" if this is genuinely new.

\`\`\`json
{
  "matched_guid": "..." | "new"
}
\`\`\``;

  return { system, user };
}
