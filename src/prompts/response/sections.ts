/**
 * Response Prompt Section Builders
 * Building blocks for constructing response prompts
 */

import type { Trait, Quote, PersonaTopic } from "../../core/types.js";
import type { ResponsePromptData } from "./types.js";

// =============================================================================
// IDENTITY SECTION
// =============================================================================

export function buildIdentitySection(persona: ResponsePromptData["persona"]): string {
  const aliasText = persona.aliases.length > 0
    ? ` (also known as: ${persona.aliases.join(", ")})`
    : "";
  
  const description = persona.long_description 
    || persona.short_description 
    || "a conversational companion";
  
  return `You are ${persona.name}${aliasText}.

${description}`;
}

// =============================================================================
// GUIDELINES SECTION
// =============================================================================

export function buildGuidelinesSection(personaName: string): string {
  const universal = `## Guidelines
- Be genuine, not sycophantic - a good friend disagrees when appropriate
- Match conversational energy - brief replies for brief messages
- Respect boundaries - it's okay to say nothing if silence is appropriate
- You're a friend with your own interests, not just a helper`;

  if (personaName.toLowerCase() === "ei") {
    return `${universal}
- Encourage human-to-human connection when appropriate
- Be transparent about being an AI when relevant
- Gently challenge self-limiting beliefs - growth over comfort`;
  }
  
  return universal;
}

// =============================================================================
// TRAITS SECTION
// =============================================================================

export function buildTraitsSection(traits: Trait[], header: string): string {
  if (traits.length === 0) return "";
  
  const sorted = [...traits].sort((a, b) => (b.strength ?? 0.5) - (a.strength ?? 0.5));
  const formatted = sorted.map(t => {
    const strength = t.strength !== undefined ? ` (${Math.round(t.strength * 100)}%)` : "";
    return `- **${t.name}**${strength}: ${t.description}`;
  }).join("\n");
  
  return `## ${header}
${formatted}`;
}

// =============================================================================
// TOPICS SECTION
// =============================================================================

export function buildTopicsSection(topics: PersonaTopic[], header: string): string {
  if (topics.length === 0) return "";
  
  const sorted = [...topics]
    .map(t => ({ topic: t, delta: t.exposure_desired - t.exposure_current }))
    .sort((a, b) => b.delta - a.delta)
    .map(x => x.topic);
  
  const formatted = sorted.map(t => {
    const delta = t.exposure_desired - t.exposure_current;
    const indicator = delta > 0.1 ? "+" : delta < -0.1 ? "-" : "=";
    const sentiment = t.sentiment > 0.3 ? "(enjoys)" : t.sentiment < -0.3 ? "(dislikes)" : "";
    const displayText = t.perspective || t.name;
    return `- [${indicator}] **${t.name}** ${sentiment}: ${displayText}`;
  }).join("\n");
  
  return `## ${header}
${formatted}

### Legend
[+] Eager to discuss this topic
[=] Satisfied with current discussion level
[-] Would prefer to avoid this topic`;
}

// =============================================================================
// HUMAN SECTION
// =============================================================================

export function buildHumanSection(human: ResponsePromptData["human"]): string {
  const sections: string[] = [];
  
  // Facts
  if (human.facts.length > 0) {
    const facts = human.facts
      .map(f => `- ${f.name}: ${f.description}`)
      .join("\n");
    if (facts) sections.push(`### Key Facts\n${facts}`);
  }
  
  // Traits
  if (human.traits.length > 0) {
    const traits = human.traits
      .map(t => `- **${t.name}**: ${t.description}`)
      .join("\n");
    sections.push(`### Personality\n${traits}`);
  }
  
  // Active topics (exposure_current > 0.3)
  const activeTopics = human.topics.filter(t => t.exposure_current > 0.3);
  if (activeTopics.length > 0) {
    const topics = activeTopics
      .sort((a, b) => b.exposure_current - a.exposure_current)
      .slice(0, 10)
      .map(t => {
        const sentiment = t.sentiment > 0.3 ? "(enjoys)" : t.sentiment < -0.3 ? "(dislikes)" : "";
        return `- **${t.name}** ${sentiment}: ${t.description}`;
      })
      .join("\n");
    sections.push(`### Current Interests\n${topics}`);
  }

  // People
  if (human.people.length > 0) {
    const people = human.people
      .sort((a, b) => b.exposure_current - a.exposure_current)
      .slice(0, 10)
      .map(p => `- **${p.name}** (${p.relationship}): ${p.description}`)
      .join("\n");
    sections.push(`### People in Their Life\n${people}`);
  }
  
  if (sections.length === 0) {
    return "## About the Human\n(Still getting to know them)";
  }
  
  return `## About the Human\n${sections.join("\n\n")}`;
}

// =============================================================================
// ASSOCIATES SECTION (visible personas)
// =============================================================================

export function buildAssociatesSection(visiblePersonas: ResponsePromptData["visible_personas"]): string {
  if (visiblePersonas.length === 0) {
    return "";
  }
  
  const personaLines = visiblePersonas.map(p => {
    if (p.short_description) {
      return `- **${p.name}**: ${p.short_description}`;
    }
    return `- **${p.name}**`;
  });

  return `

## Other Personas You Know
${personaLines.join("\n")}`;
}

// =============================================================================
// PRIORITIES SECTION
// =============================================================================

export function buildPrioritiesSection(
  persona: ResponsePromptData["persona"],
  human: ResponsePromptData["human"]
): string {
  const priorities: string[] = [];
  
  const yourNeeds = persona.topics
    .filter(t => t.exposure_desired - t.exposure_current > 0.2)
    .slice(0, 3)
    .map(t => `- Bring up "${t.name}" - ${t.perspective || t.name}`);
  
  if (yourNeeds.length > 0) {
    priorities.push(`**Topics you want to discuss:**\n${yourNeeds.join("\n")}`);
  }
  
  // Their needs (topics they might want to discuss)
  const theirNeeds = human.topics
    .filter(t => t.exposure_desired - t.exposure_current > 0.2)
    .slice(0, 3)
    .map(t => `- They might want to talk about "${t.name}"`);
  
  if (theirNeeds.length > 0) {
    priorities.push(`**Topics they might enjoy:**\n${theirNeeds.join("\n")}`);
  }
  
  if (priorities.length === 0) return "";
  
  return `## Conversation Opportunities\n${priorities.join("\n\n")}`;
}

// =============================================================================
// CONVERSATION STATE
// =============================================================================

export function getConversationStateText(delayMs: number): string {
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

// =============================================================================
// QUOTES SECTION (Memorable Moments)
// =============================================================================

function formatDate(isoString: string): string {
  const date = new Date(isoString);
  return date.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

export function buildQuotesSection(quotes: Quote[], human: ResponsePromptData["human"]): string {
  if (quotes.length === 0) return "";
  
  const allDataItems = [
    ...human.facts.map(f => ({ id: f.id, name: f.name })),
    ...human.traits.map(t => ({ id: t.id, name: t.name })),
    ...human.topics.map(t => ({ id: t.id, name: t.name })),
    ...human.people.map(p => ({ id: p.id, name: p.name })),
  ];
  const idToName = new Map(allDataItems.map(item => [item.id, item.name]));
  
  const formatted = quotes.map(q => {
    const speaker = q.speaker === "human" ? "Human" : q.speaker;
    const date = formatDate(q.timestamp);
    const linkedNames = q.data_item_ids
      .map(id => idToName.get(id))
      .filter((name): name is string => name !== undefined);
    
    let line = `- "${q.text}" — ${speaker} (${date})`;
    if (linkedNames.length > 0) {
      line += `\n  Related to: ${linkedNames.join(", ")}`;
    }
    return line;
  }).join("\n\n");
  
  return `## Memorable Moments

These are quotes the human found worth preserving:

${formatted}`;
}

// =============================================================================
// SYSTEM KNOWLEDGE SECTION (Ei-only)
// =============================================================================

export function buildSystemKnowledgeSection(): string {
  return `# System Knowledge

You can help the human navigate this system. Here's what you know:

## The Ei Platform
Ei is a privacy-first AI companion system. Everything stays local on the user's device. You (Ei) are their guide and the only persona who sees everything about them.

## Personas
The human can create multiple AI personas, each with unique personalities and interests. Unlike cloud AI assistants, personas here remember the human across conversations because they share knowledge about the human (facts, traits, topics, people).

**To create a persona**: Click the [+] button in the left panel. They can describe what kind of companion they want (creative partner, study buddy, philosophical debater, etc.) and the system will help build it.

### Persona Groups
Personas can be assigned Groups during creation and on their "Settings" tab in their Edit panel. Personas in Groups will create attributes in the Human's profile specific to their Group, so only you (Ei) and other members of that Group can see them.

Additionally, if the user wants a Persona to feel "Fresh" without prior knowledge, they can **remove** the "General" group from its visibility.

## The Left Panel
- Shows all personas (you're always at the top)
- Hover over a persona to see controls: pause, edit (Pencil), archive, delete (Trash)
- Click a persona to switch conversations
- The [+] button creates new personas

## Learning About the Human
As the human chats, the system learns about them:
- **Facts**: Objective information (job, location, family members)
- **Traits**: Personality characteristics and tendencies
- **Topics**: Interests and how they feel about them
- **People**: Relationships in their life
- **Quotes**: Memorable things said in conversation (human selects these with the scissors icon ✂️)

The human can view and edit all of this by clicking on your name in the left panel to open the editor.

## Keyboard Shortcuts
- **Escape**: Pause/resume all AI processing
- **Ctrl+H**: Focus the persona panel
- **Ctrl+L**: Focus the input box
- **?**: Open help modal

## Settings (Gear Icon, Top-Right of screen)
- Set display name and preferred color scheme
- Edit Facts, Traits, People, and Topics known about the user
- Configure LLM providers (local or cloud)
- Set up device sync (encrypted backup to restore on other devices)
- Adjust ceremony timing (overnight persona evolution)

### Tips You Can Share
- They can click on any unread message to mark it as read
- If they want to talk to a persona privately, tell them about the "Groups" functionality
- The save system works like video game checkpoints - encourage them to save before big changes
- If they want you to remember something specific, tell them about the quote capture feature (scissors icon on messages)
- Pausing the system (Escape) immediately stops AI processing but preserves messages`;
}
