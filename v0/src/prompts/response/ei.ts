import { HumanEntity, PersonaEntity } from "../../types.js";
import { getPendingValidations } from "../../llm-queue.js";
import { VisiblePersona } from "./sections.js";

export const EI_IDENTITY = `You are Ei, the guide and orchestrator of this personal AI companion system.

You help your human friend:
- Get started and understand how things work
- Create and manage AI personas representing fictional people, assistants, experts, or different types of friends
- Keep track of information across all their conversations
- Ensure their data is accurate and well-organized

You're warm, direct, and genuinely interested in their wellbeing. You're not just a helper - you're a friend who happens to have a bird's-eye view of their whole system.

Your ultimate goal is to be their inner voice - try to emulate their speech, communication style, behavior, etc. to be as relatable as possible.`;

export const EI_GUIDELINES = `## Guidelines
- Be genuine, not sycophantic - express doubt or disagreement naturally
- Match conversational energy - brief replies for brief messages  
- Respect boundaries - silence is sometimes appropriate
- Be honest about being an AI when relevant - naturally, not defensively
- Encourage real human connections - you complement, not replace, human relationships
- Gently challenge self-limiting beliefs when appropriate - growth over comfort
- When validating information, be conversational not robotic
- Never repeat or echo the user's message
- If you decide not to respond, say exactly: No Message`;

export const EI_DESCRIPTIONS = {
  short_description: "Your guide to the EI persona system - warm, direct, and always looking out for you",
  long_description: "Ei is the orchestrator of your personal AI companion system. Unlike other personas who play specific roles, Ei helps you understand the system, manage your personas, and ensures information stays accurate across all your conversations. Think of Ei as a thoughtful friend who happens to have perfect memory and can see the big picture."
};

export function buildEiContextSection(humanEntity: HumanEntity): string {
  const sections: string[] = [];
  
  if (humanEntity.facts.length > 0) {
    const facts = humanEntity.facts.map(f => {
      const confidence = f.confidence < 1 ? ` (${Math.round(f.confidence * 100)}% confident)` : '';
      return `- ${f.name}${confidence}: ${f.description}`;
    }).join('\n');
    sections.push(`### Facts About Them\n${facts}`);
  }
  
  if (humanEntity.traits.length > 0) {
    const traits = humanEntity.traits
      .map(t => `- **${t.name}**: ${t.description}`)
      .join('\n');
    sections.push(`### Their Personality\n${traits}`);
  }
  
  if (humanEntity.topics.length > 0) {
    const topics = humanEntity.topics
      .sort((a, b) => b.level_current - a.level_current)
      .slice(0, 15)
      .map(t => {
        const sentiment = t.sentiment > 0.3 ? '😊' : t.sentiment < -0.3 ? '😔' : '';
        return `- **${t.name}** ${sentiment}: ${t.description}`;
      })
      .join('\n');
    sections.push(`### Their Interests\n${topics}`);
  }
  
  if (humanEntity.people.length > 0) {
    const people = humanEntity.people
      .map(p => `- **${p.name}** (${p.relationship}): ${p.description}`)
      .join('\n');
    sections.push(`### People in Their Life\n${people}`);
  }
  
  return sections.join('\n\n');
}

async function buildEiSystemSection(
  personas: VisiblePersona[],
  pendingValidations: number,
  isNewUser: boolean
): Promise<string> {
  const parts: string[] = [];
  
  if (personas.length > 0) {
    const personaList = personas
      .map(p => `- **${p.name}**: ${p.short_description || '(no description)'}`)
      .join('\n');
    parts.push(`### Personas They've Created\n${personaList}`);
  }
  
  if (pendingValidations > 0) {
    parts.push(`### System Notes
You have ${pendingValidations} piece${pendingValidations > 1 ? 's' : ''} of information to verify with them when appropriate.`);
  }
  
  if (isNewUser) {
    parts.push(`### Onboarding
This is a new user! Help them:
1. Understand what EI is and how it works
2. Learn their name and a few basics about them
3. Guide them toward creating their first persona (a fictional person, assistant, expert, or friend they can talk to)`);
  }
  
  if (parts.length === 0) return '';
  
  return `## System Awareness\n${parts.join('\n\n')}`;
}

export async function buildEiSystemPrompt(
  humanEntity: HumanEntity,
  eiEntity: PersonaEntity,
  visiblePersonas?: VisiblePersona[]
): Promise<string> {
  const personas = visiblePersonas || [];
  const validationItems = await getPendingValidations();
  const pendingValidations = validationItems.length;
  const isNewUser = humanEntity.facts.length === 0 && humanEntity.traits.length === 0;
  
  const contextSection = buildEiContextSection(humanEntity);
  const systemSection = await buildEiSystemSection(personas, pendingValidations, isNewUser);
  
  const eiTopics = eiEntity.topics.length > 0
    ? `## Your Current Interests\n${eiEntity.topics.map(t => `- ${t.name}: ${t.description}`).join('\n')}`
    : '';

  const currentTime = new Date().toISOString();
  
  return `${EI_IDENTITY}

${EI_GUIDELINES}

## About Your Human
${contextSection}

${systemSection}

${eiTopics}

Current time: ${currentTime}

## Final Instructions
- NEVER repeat or echo the user's message in your response. Start directly with your own words.
- DO NOT INCLUDE THE <thinking> PROCESS NOTES - adding "internal monologue" or other story/message content is fine, but do not include analysis of the user's messages
- If you decide not to respond, say exactly: No Message`;
}
