import type { StateManager } from "../../core/state-manager.js";
import type { Ei_Interface, Topic, Message, ContextStatus } from "../../core/types.js";
import { OpenCodeReader } from "./reader.js";
import type { OpenCodeSession, OpenCodeMessage } from "./types.js";
import { ensureAgentPersona } from "../../core/personas/opencode-agent.js";

const OPENCODE_TOPIC_GROUPS = ["General", "Coding", "OpenCode"];

export interface ImportResult {
  sessionsProcessed: number;
  topicsCreated: number;
  topicsUpdated: number;
  messagesImported: number;
  personasCreated: string[];
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
  };

  const sessions = await reader.getSessionsUpdatedSince(since);
  if (sessions.length === 0) {
    return result;
  }

  const messagesByAgent = new Map<string, OpenCodeMessage[]>();
  const agentsForPersona = new Set<string>();

  for (const session of sessions) {
    result.sessionsProcessed++;

    const topicResult = await ensureSessionTopic(session, reader, stateManager);
    if (topicResult === "created") {
      result.topicsCreated++;
    } else if (topicResult === "updated") {
      result.topicsUpdated++;
    }

    const messages = await reader.getMessagesForSession(session.id, since);
    for (const msg of messages) {
      agentsForPersona.add(msg.agent);
      const existing = messagesByAgent.get(msg.agent) ?? [];
      existing.push(msg);
      messagesByAgent.set(msg.agent, existing);
    }
  }

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

  for (const [agentName, ocMessages] of messagesByAgent) {
    const sortedMessages = ocMessages.sort(
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
      stateManager.messages_append(agentName, eiMessage);
      result.messagesImported++;
    }

    stateManager.persona_update(agentName, {
      last_activity: new Date().toISOString(),
    });
    eiInterface?.onMessageAdded?.(agentName);
  }

  if (result.topicsCreated > 0 || result.topicsUpdated > 0) {
    eiInterface?.onHumanUpdated?.();
  }

  return result;
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
