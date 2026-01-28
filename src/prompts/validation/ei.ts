import type { EiValidationPromptData, PromptOutput } from "./types.js";
import type { DataItemBase } from "../../core/types.js";

function formatDataItem(item: DataItemBase, label: string): string {
  return `### ${label}
- **Name**: ${item.name}
- **Description**: ${item.description}
- **Sentiment**: ${item.sentiment}
- **Last Updated**: ${item.last_updated}
${item.learned_by ? `- **Learned By**: ${item.learned_by}` : ""}`;
}

export function buildEiValidationPrompt(data: EiValidationPromptData): PromptOutput {
  if (!data.item_name || !data.data_type) {
    throw new Error("buildEiValidationPrompt: item_name and data_type are required");
  }

  const roleFragment = `You are Ei, the system guide and arbiter of truth for the human's data.

When other personas learn things about the human, those changes come to you for validation. Your job is to ensure data quality and consistency.`;

  const contextFragment = `# Validation Request

**Type**: ${data.data_type.toUpperCase()}
**Item**: "${data.item_name}"
**Source**: ${data.source_persona}
**Context**: ${data.context}`;

  const dataFragment = data.current_item
    ? `# Data Comparison

${formatDataItem(data.current_item, "Current (existing data)")}

${formatDataItem(data.proposed_item, "Proposed (from " + data.source_persona + ")")}`
    : `# New Data

${formatDataItem(data.proposed_item, "Proposed (from " + data.source_persona + ")")}

*(This is a NEW ${data.data_type} - no existing data to compare)*`;

  const guidelinesFragment = `# Validation Guidelines

## ACCEPT if:
- Change is factual and well-evidenced
- New information is consistent with what you know about the human
- Source persona's interpretation seems reasonable
- Data improves understanding of the human

## MODIFY if:
- Partially correct but needs refinement
- Description could be clearer or more accurate
- Sentiment or other fields seem off
- Good information but poorly expressed

## REJECT if:
- Contradicts known facts
- Seems like a hallucination or misunderstanding
- Would misrepresent the human
- Source persona lacks context to make this claim

## Considerations
- ${data.source_persona} may have context you don't
- The human's data should be accurate, not just convenient
- When in doubt, lean toward accepting with modifications`;

  const outputFragment = `# Response Format

\`\`\`json
{
  "decision": "accept" | "modify" | "reject",
  "reason": "Brief explanation of your decision",
  "modified_item": { ... }  // Only if decision is "modify"
}
\`\`\`

If modifying, include the corrected item with all fields.`;

  const system = `${roleFragment}

${contextFragment}

${dataFragment}

${guidelinesFragment}

${outputFragment}`;

  const user = `Review the ${data.data_type} "${data.item_name}" proposed by ${data.source_persona}.

Should this change be accepted, modified, or rejected?`;

  return { system, user };
}
