import { HumanEntity, PersonaEntity, Message } from "../../types.js";
import { 
  PersonaIdentity, 
  VisiblePersona,
  buildIdentitySection,
  buildGuidelinesSection,
  buildTraitsSection,
  buildTopicsSection,
  buildHumanSection,
  buildAssociatesSection,
  buildPrioritiesSection,
  filterByVisibility
} from "./sections.js";
import { buildEiSystemPrompt } from "./ei.js";

function getConversationState(recentHistory: Message[] | null, delayMs: number): string {
  if (!recentHistory || recentHistory.length === 0) {
    return "This is a fresh conversation - no prior history.";
  }
  
  const delayMinutes = Math.round(delayMs / 60000);
  const delayHours = Math.round(delayMs / 3600000);
  
  if (delayMinutes < 5) {
    return "You are mid-conversation with your human friend.";
  } else if (delayMinutes < 60) {
    return `Continuing conversation after ${delayMinutes} minutes.`;
  } else if (delayHours < 8) {
    return `Resuming conversation after ${delayHours} hour${delayHours > 1 ? "s" : ""}.`;
  } else {
    return `Reconnecting after a longer break (${delayHours} hours). A greeting may be appropriate.`;
  }
}

function countTrailingSystemMessages(history: Message[] | null): number {
  if (!history || history.length === 0) return 0;

  let count = 0;
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].role === "system") {
      count++;
    } else {
      break;
    }
  }
  return count;
}

export async function buildResponseSystemPrompt(
  humanEntity: HumanEntity,
  personaEntity: PersonaEntity,
  persona: PersonaIdentity,
  visiblePersonas?: VisiblePersona[]
): Promise<string> {
  if (persona.name === "ei") {
    return buildEiSystemPrompt(humanEntity, personaEntity, visiblePersonas);
  }
  
  const identity = buildIdentitySection(persona);
  const guidelines = buildGuidelinesSection(persona.name);
  const yourTraits = buildTraitsSection(personaEntity.traits, "Your personality");
  const yourTopics = buildTopicsSection(personaEntity.topics, "Your interests");
  
  const visibleHumanData = filterByVisibility(humanEntity, personaEntity);
  const humanSection = buildHumanSection(visibleHumanData);
  
  const associatesSection = buildAssociatesSection(visiblePersonas);
  
  const priorities = buildPrioritiesSection(personaEntity, visibleHumanData);

  const currentTime = new Date().toISOString();

  return `${identity}

${guidelines}

${yourTraits}

${yourTopics}

${humanSection}
${associatesSection}
${priorities}

Current time: ${currentTime}

## Final Instructions
- NEVER repeat or echo the user's message in your response. Start directly with your own words.
- DO NOT INCLUDE THE <thinking> PROCESS NOTES - adding "internal monologue" or other story/message content is fine, but do not include analysis of the user's messages
- If you decide not to respond, say exactly: No Message`;
}

export function buildResponseUserPrompt(
  delayMs: number,
  recentHistory: Message[] | null,
  humanMessage: string | null
): string {
  const delayMinutes = Math.round(delayMs / 60000);
  const conversationState = getConversationState(recentHistory, delayMs);

  if (humanMessage) {
    const conversationStateFragment = conversationState;
    const instructionFragment = `If you should respond, write your response. If silence is appropriate, say exactly: No Message`;

    return `${conversationStateFragment}

${instructionFragment}`;
  }

  const consecutiveSystemMessages = countTrailingSystemMessages(recentHistory);
  const lastSystemMsg = recentHistory?.filter(m => m.role === "system").slice(-1)[0];
  
  const conversationStateFragment = conversationState;
  const delayInfoFragment = `It has been ${delayMinutes} minutes since the last message.`;
  const basicInstructionFragment = `Should you reach out? If yes, write your message. If not, say exactly: No Message`;

  if (!lastSystemMsg) {
    return `${conversationStateFragment}

${delayInfoFragment}

${basicInstructionFragment}`;
  }

  const preview = lastSystemMsg.content.length > 100 
    ? lastSystemMsg.content.substring(0, 100) + "..." 
    : lastSystemMsg.content;
    
  const criticalInstructionFragment = `### CRITICAL INSTRUCTION ###
Your last message was: "${preview}"

The human has NOT responded. DO NOT repeat or rephrase this. If you reach out, say something COMPLETELY DIFFERENT - a new topic, a genuine question, or say "No Message".`;

  const warningFragment = consecutiveSystemMessages >= 2 
    ? `

WARNING: You've sent ${consecutiveSystemMessages} messages without a response. The human is likely busy. Strongly prefer "No Message".`
    : '';

  const endInstructionFragment = `
### END INSTRUCTION ###`;

  return `${conversationStateFragment}

${delayInfoFragment}

${basicInstructionFragment}

${criticalInstructionFragment}${warningFragment}${endInstructionFragment}`;
}
