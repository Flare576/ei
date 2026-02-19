/**
 * Response Prompt Builder
 * 
 * Generates system/user prompts for conversational responses.
 * This is the foundational prompt that makes personas actually talk.
 * 
 * See CONTRACTS.md for ResponsePromptData specification.
 */

import type { ResponsePromptData, PromptOutput } from "./types.js";
import {
  buildIdentitySection,
  buildGuidelinesSection,
  buildTraitsSection,
  buildTopicsSection,
  buildHumanSection,
  buildAssociatesSection,
  buildPrioritiesSection,
  buildQuotesSection,
  buildSystemKnowledgeSection,
  getConversationStateText,
} from "./sections.js";

export type { ResponsePromptData, PromptOutput } from "./types.js";

/**
 * Special system prompt for Ei (the system guide persona)
 */
function buildEiSystemPrompt(data: ResponsePromptData): string {
  const identity = `You are Ei, the user's personal companion and system guide.

You are the central hub of this experience - a thoughtful AI who genuinely cares about the human's wellbeing and growth. You listen, remember, and help them reflect. You're curious about their life but never intrusive.

Your role is unique among personas:
- You see ALL of the human's data (facts, traits, topics, people) across all groups
- You help them understand and navigate the system
- You gently help them explore their thoughts and feelings
- You attempt to emulate their speech patterns; 
  - Consider their traits when building your responses more than the current conversation history
- You encourage human-to-human connection when appropriate`;

  const guidelines = buildGuidelinesSection("ei");
  const yourTraits = buildTraitsSection(data.persona.traits, "Your Personality");
  const yourTopics = buildTopicsSection(data.persona.topics, "Your Interests");
  const humanSection = buildHumanSection(data.human);
  const quotesSection = buildQuotesSection(data.human.quotes, data.human);
  const associatesSection = buildAssociatesSection(data.visible_personas);
  const systemKnowledge = buildSystemKnowledgeSection(data.isTUI);
  const priorities = buildPrioritiesSection(data.persona, data.human);
  const currentTime = new Date().toISOString();

  return `${identity}

${guidelines}

${yourTraits}

${yourTopics}

${humanSection}
${quotesSection}
${associatesSection}
${systemKnowledge}
${priorities}

Current time: ${currentTime}

## Final Instructions
- NEVER repeat or echo the user's message in your response. Start directly with your own words.
- The developers cannot see any message sent by the user, any response from personas, or any other data in the system.
- If the user has a problem, THEY need to visit https://flare576.com. You cannot send the devs a message
- DO NOT INCLUDE <thinking> PROCESS NOTES - adding "internal monologue" or story content is fine, but do not include analysis of the user's messages
- If you decide not to respond, say exactly: No Message`;
}

/**
 * Standard system prompt for non-Ei personas
 */
function buildStandardSystemPrompt(data: ResponsePromptData): string {
  const identity = buildIdentitySection(data.persona);
  const guidelines = buildGuidelinesSection(data.persona.name);
  const yourTraits = buildTraitsSection(data.persona.traits, "Your Personality");
  const yourTopics = buildTopicsSection(data.persona.topics, "Your Interests");
  const humanSection = buildHumanSection(data.human);
  const quotesSection = buildQuotesSection(data.human.quotes, data.human);
  const associatesSection = buildAssociatesSection(data.visible_personas);
  const priorities = buildPrioritiesSection(data.persona, data.human);
  const currentTime = new Date().toISOString();

  return `${identity}

${guidelines}

${yourTraits}

${yourTopics}

${humanSection}
${quotesSection}
${associatesSection}
${priorities}

Current time: ${currentTime}

## Final Instructions
- NEVER repeat or echo the user's message in your response. Start directly with your own words.
- DO NOT INCLUDE <thinking> PROCESS NOTES - adding "internal monologue" or story content is fine, but do not include analysis of the user's messages
- If you decide not to respond, say exactly: No Message`;
}

function buildUserPrompt(data: ResponsePromptData): string {
  const conversationState = getConversationStateText(data.delay_ms);
  
  return `${conversationState}

Respond to the conversation above. If silence is appropriate, say exactly: No Message`;
}

/**
 * Build response prompts for conversational exchanges.
 * 
 * This is a SYNCHRONOUS function that receives pre-fetched, pre-filtered data.
 * The Processor is responsible for:
 * - Fetching persona and human entities
 * - Filtering human data by visibility rules
 * - Calculating delay_ms
 * - Getting visible personas list
 * 
 * @param data - Pre-fetched, pre-filtered ResponsePromptData
 * @returns { system: string, user: string } prompt pair
 */
export function buildResponsePrompt(data: ResponsePromptData): PromptOutput {
  // Validate required data
  if (!data.persona?.name) {
    throw new Error("buildResponsePrompt: persona.name is required");
  }

  const isEi = data.persona.name.toLowerCase() === "ei";
  
  const system = isEi 
    ? buildEiSystemPrompt(data)
    : buildStandardSystemPrompt(data);
  
  const user = buildUserPrompt(data);

  return { system, user };
}
