import type { StateManager } from "../../core/state-manager.js";
import type { Ei_Interface, Topic, Message, ContextStatus } from "../../core/types.js";
import { OpenCodeReader } from "./reader.js";
import type { OpenCodeSession, OpenCodeMessage } from "./types.js";
import { UTILITY_AGENTS, AGENT_TO_AGENT_PREFIXES } from "./types.js";
import { ensureAgentPersona } from "../../core/personas/opencode-agent.js";
import {
  queueDirectTopicUpdate,
  type ExtractionContext,
} from "../../core/orchestrators/human-extraction.js";

const OPENCODE_TOPIC_GROUPS = ["General", "Coding", "OpenCode"];

function isAgentToAgentMessage(content: string): boolean {
  const trimmed = content.trimStart();
  return AGENT_TO_AGENT_PREFIXES.some(prefix => trimmed.startsWith(prefix));
}

interface SessionAgentMessages {
  sessionId: string;
  agentName: string;
  messages: OpenCodeMessage[];
}

export interface ImportResult {
  sessionsProcessed: number;
  topicsCreated: number;
  topicsUpdated: number;
  messagesImported: number;
  personasCreated: string[];
  topicUpdatesQueued: number;
}

export interface OpenCodeImporterOptions {
  stateManager: StateManager;
  interface?: Ei_Interface;
  reader?: OpenCodeReader;
}

export async function importOpenCodeSessions(
  since: Date,
  options: OpenCodeImporterOptions
): Promise<ImportResult> {
  const { stateManager, interface: eiInterface } = options;
  const reader = options.reader ?? new OpenCodeReader();

  const result: ImportResult = {
    sessionsProcessed: 0,
    topicsCreated: 0,
    topicsUpdated: 0,
    messagesImported: 0,
    personasCreated: [],
    topicUpdatesQueued: 0,
  };

  const sessions = await reader.getSessionsUpdatedSince(since);
  const primarySessions = sessions.filter(s => !s.parentId);
  console.log(`[OpenCode] Found ${sessions.length} sessions (${primarySessions.length} primary, ${sessions.length - primarySessions.length} sub-agent skipped) since ${since.toISOString()}`);
  if (primarySessions.length === 0) {
    return result;
  }

  const agentsForPersona = new Set<string>();
  const sessionAgentBatches: SessionAgentMessages[] = [];

  for (const session of primarySessions) {
    result.sessionsProcessed++;
    if (result.sessionsProcessed % 10 === 0 || result.sessionsProcessed === 1) {
      console.log(`[OpenCode] Processing session ${result.sessionsProcessed}/${primarySessions.length}: ${session.title}`);
    }

    const topicResult = await ensureSessionTopic(session, reader, stateManager);
    if (topicResult === "created") {
      result.topicsCreated++;
    } else if (topicResult === "updated") {
      result.topicsUpdated++;
    }

    const messages = await reader.getMessagesForSession(session.id, since);
    const messagesByAgent = new Map<string, OpenCodeMessage[]>();
    
    for (const msg of messages) {
      if (UTILITY_AGENTS.includes(msg.agent as typeof UTILITY_AGENTS[number])) {
        continue;
      }
      if (isAgentToAgentMessage(msg.content)) {
        continue;
      }
      agentsForPersona.add(msg.agent);
      const existing = messagesByAgent.get(msg.agent) ?? [];
      existing.push(msg);
      messagesByAgent.set(msg.agent, existing);
    }

    for (const [agentName, agentMessages] of messagesByAgent) {
      sessionAgentBatches.push({
        sessionId: session.id,
        agentName,
        messages: agentMessages,
      });
    }
  }

  console.log(`[OpenCode] Sessions done. Discovered ${agentsForPersona.size} personas, importing messages...`);

  for (const agentName of agentsForPersona) {
    const existing = stateManager.persona_get(agentName);
    if (!existing) {
      await ensureAgentPersona(agentName, {
        stateManager,
        interface: eiInterface,
        reader,
      });
      result.personasCreated.push(agentName);
    }
  }

  for (const batch of sessionAgentBatches) {
    const sortedMessages = batch.messages.sort(
      (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    );

    for (const ocMsg of sortedMessages) {
      const eiMessage: Message = {
        id: ocMsg.id,
        role: ocMsg.role === "user" ? "human" : "system",
        content: ocMsg.content,
        timestamp: ocMsg.timestamp,
        read: true,
        context_status: "default" as ContextStatus,
      };
      stateManager.messages_append(batch.agentName, eiMessage);
      result.messagesImported++;
    }
  }

  const updatedAgents = new Set<string>();
  for (const batch of sessionAgentBatches) {
    if (!updatedAgents.has(batch.agentName)) {
      stateManager.persona_update(batch.agentName, {
        last_activity: new Date().toISOString(),
      });
      eiInterface?.onMessageAdded?.(batch.agentName);
      updatedAgents.add(batch.agentName);
    }
  }

  if (result.topicsCreated > 0 || result.topicsUpdated > 0) {
    eiInterface?.onHumanUpdated?.();
  }

  if (result.messagesImported > 0) {
    result.topicUpdatesQueued = queueDirectTopicUpdatesForSessions(
      sessionAgentBatches,
      stateManager
    );
    console.log(`[OpenCode] Queued ${result.topicUpdatesQueued} topic update chunks`);
  }

  return result;
}

function queueDirectTopicUpdatesForSessions(
  batches: SessionAgentMessages[],
  stateManager: StateManager
): number {
  const human = stateManager.getHuman();
  let totalChunks = 0;

  for (const batch of batches) {
    const topic = human.topics.find(t => t.id === batch.sessionId);
    if (!topic) {
      console.warn(`[OpenCode] Topic not found for session ${batch.sessionId}, skipping extraction`);
      continue;
    }

    const allMessages = stateManager.messages_get(batch.agentName);
    const batchMessageIds = new Set(batch.messages.map(m => m.id));
    
    const analyzeStartIndex = allMessages.findIndex(m => batchMessageIds.has(m.id));
    if (analyzeStartIndex === -1) {
      continue;
    }

    const context: ExtractionContext = {
      personaName: batch.agentName,
      messages_context: allMessages.slice(0, analyzeStartIndex),
      messages_analyze: allMessages.filter(m => batchMessageIds.has(m.id)),
    };

    if (context.messages_analyze.length === 0) {
      continue;
    }

    const chunks = queueDirectTopicUpdate(topic, context, stateManager);
    totalChunks += chunks;
  }

  return totalChunks;
}

async function ensureSessionTopic(
  session: OpenCodeSession,
  reader: OpenCodeReader,
  stateManager: StateManager
): Promise<"created" | "updated" | "unchanged"> {
  const human = stateManager.getHuman();
  const existingTopic = human.topics.find((t) => t.id === session.id);

  const firstAgent = await reader.getFirstAgent(session.id);
  const learnedBy = firstAgent ?? "build";

  if (existingTopic) {
    if (existingTopic.name !== session.title) {
      const updatedTopic: Topic = {
        ...existingTopic,
        name: session.title,
        last_updated: new Date().toISOString(),
      };
      stateManager.human_topic_upsert(updatedTopic);
      return "updated";
    }
    return "unchanged";
  }

  const newTopic: Topic = {
    id: session.id,
    name: session.title,
    description: "",
    sentiment: 0,
    exposure_current: 0.5,
    exposure_desired: 0.3,
    persona_groups: OPENCODE_TOPIC_GROUPS,
    learned_by: learnedBy,
    last_updated: new Date().toISOString(),
  };

  stateManager.human_topic_upsert(newTopic);
  return "created";
}
