import { StateManager } from "./state-manager.js";
import type { Fact } from "./types.js";
import { BUILT_IN_FACTS } from "./constants/built-in-facts.js";
import { isQualifiedMessageId, qualifyEiMessage, qualifyOpenCodeMessage, UUID_PATTERN } from "./utils/message-id.js";
import type { IOpenCodeReader } from "../integrations/opencode/types.js";
import { matchQuoteInMessage } from "./handlers/human-matching.js";

export function seedBuiltinFacts(stateManager: StateManager): void {
  const human = stateManager.getHuman();
  const existingFactNames = new Set(human.facts.map(f => f.name));
  
  const now = new Date().toISOString();
  let seededCount = 0;

  for (const builtInFact of BUILT_IN_FACTS) {
    if (existingFactNames.has(builtInFact.name)) continue;

    const newFact: Fact = {
      id: crypto.randomUUID(),
      name: builtInFact.name,
      description: '',
      sentiment: 0,
      validated_date: '',
      last_updated: now,
      learned_on: now,
    };
    human.facts.push(newFact);
    seededCount++;
  }

  if (seededCount > 0) {
    stateManager.setHuman(human);
    console.log(`[Processor] Seeded ${seededCount} built-in facts`);
  }
}

export function migrateLearnedOn(stateManager: StateManager): void {
  const human = stateManager.getHuman();

  const backfill = <T extends { learned_on?: string; last_updated: string }>(items: T[]): T[] =>
    items.map(item => item.learned_on ? item : { ...item, learned_on: item.last_updated });

  const facts = backfill(human.facts);
  const topics = backfill(human.topics);
  const people = backfill(human.people);

  const changed =
    facts.some((f, i) => f !== human.facts[i]) ||
    topics.some((t, i) => t !== human.topics[i]) ||
    people.some((p, i) => p !== human.people[i]);

  if (changed) {
    stateManager.setHuman({ ...human, facts, topics, people });
    console.log("[Processor] Backfilled learned_on for existing data items");
  }
}

export async function migrateMessageIds(stateManager: StateManager, isTUI: boolean): Promise<void> {
  try {
    let msgRewrites = 0;
    let quoteRewrites = 0;

    const personas = stateManager.persona_getAll();
    for (const persona of personas) {
      for (const msg of stateManager.messages_get(persona.id)) {
        if (!msg.external && UUID_PATTERN.test(msg.id)) {
          stateManager.messages_update(persona.id, msg.id, { id: qualifyEiMessage(msg.id) });
          msgRewrites++;
        }
      }
    }

    const rooms = stateManager.getRoomList(true);
    for (const room of rooms) {
      const roomIdRewrites = new Map<string, string>();

      for (const msg of stateManager.getRoomMessages(room.id).slice()) {
        if (UUID_PATTERN.test(msg.id)) {
          const fqId = qualifyEiMessage(msg.id);
          roomIdRewrites.set(msg.id, fqId);
          stateManager.updateRoomMessage(room.id, msg.id, { id: fqId });
          msgRewrites++;
        }
      }

      let parentRewrites = 0;
      for (const msg of stateManager.getRoomMessages(room.id)) {
        const pid = msg.parent_id;
        if (pid && UUID_PATTERN.test(pid)) {
          const fqPid = roomIdRewrites.get(pid) ?? qualifyEiMessage(pid);
          stateManager.updateRoomMessage(room.id, msg.id, { parent_id: fqPid });
          parentRewrites++;
        }
      }

      const activeNode = room.active_node_id;
      if (activeNode && UUID_PATTERN.test(activeNode)) {
        const fqActive = roomIdRewrites.get(activeNode) ?? qualifyEiMessage(activeNode);
        stateManager.updateRoom(room.id, { active_node_id: fqActive });
      }

      if (parentRewrites > 0) {
        msgRewrites += parentRewrites;
      }
    }

    const human = stateManager.getHuman();
    const quotes = human.quotes ?? [];

    const eiUuidMap = new Map<string, { qualifiedId: string; content: string | undefined }>();
    for (const persona of personas) {
      for (const msg of stateManager.messages_get(persona.id)) {
        if (msg.id.startsWith("ei:")) eiUuidMap.set(msg.id.slice(3), { qualifiedId: msg.id, content: msg.content });
      }
    }
    for (const room of rooms) {
      for (const msg of stateManager.getRoomMessages(room.id)) {
        if (msg.id.startsWith("ei:")) eiUuidMap.set(msg.id.slice(3), { qualifiedId: msg.id, content: msg.content });
      }
    }

    const MSG_PATTERN = /^msg_[a-zA-Z0-9]+$/;

    let openCodeReader: IOpenCodeReader | null = null;
    if (isTUI) {
      const { createOpenCodeReader } = await import("../integrations/opencode/reader-factory.js");
      openCodeReader = await createOpenCodeReader().catch(() => null);
    }

    const updatedQuotes: typeof quotes = [];
    for (const quote of quotes) {
      const mid = quote.message_id;
      if (!mid || isQualifiedMessageId(mid)) {
        updatedQuotes.push(quote);
        continue;
      }

      if (MSG_PATTERN.test(mid)) {
        if (openCodeReader) {
          const ocWindow = await openCodeReader.getMessageById(mid).catch(() => null);
          if (ocWindow && matchQuoteInMessage(quote.text, ocWindow.message.content)) {
            const { getMachineId } = await import("../integrations/machine-id.js");
            updatedQuotes.push({ ...quote, message_id: qualifyOpenCodeMessage(getMachineId(), ocWindow.session.id, mid) });
            quoteRewrites++;
            continue;
          }
        }
        updatedQuotes.push(quote);
        continue;
      }

      if (UUID_PATTERN.test(mid)) {
        const mapped = eiUuidMap.get(mid);
        if (mapped && mapped.content !== undefined && matchQuoteInMessage(quote.text, mapped.content)) {
          updatedQuotes.push({ ...quote, message_id: mapped.qualifiedId });
          quoteRewrites++;
          continue;
        }
        updatedQuotes.push(quote);
        continue;
      }

      updatedQuotes.push(quote);
    }

    if (quoteRewrites > 0) {
      stateManager.setHuman({ ...human, quotes: updatedQuotes });
    }

    if (msgRewrites > 0 || quoteRewrites > 0) {
      console.log(`[Processor] migrateMessageIds: rewrote ${msgRewrites} message IDs, ${quoteRewrites} quote message_ids`);
    }
  } catch (err) {
    console.error("[Processor] migrateMessageIds failed, continuing:", err);
  }
}

export function migrateSlackToMultiWorkspace(stateManager: StateManager): void {
  const human = stateManager.getHuman();
  const slack = human.settings?.slack as Record<string, unknown> | undefined;
  if (!slack) return;

  const hasLegacyAuth = "auth" in slack && slack.auth != null;
  const hasLegacyIntegration = "integration" in slack;
  if (!hasLegacyAuth && !hasLegacyIntegration) return;

  const legacyAuth = slack.auth as Record<string, unknown> | undefined;
  const workspaceId = (legacyAuth?.workspace_id as string | undefined) ?? "unknown";

  const migratedWorkspace: Record<string, unknown> = {
    integration: slack.integration,
    extraction_model: slack.extraction_model,
    last_sync: slack.last_sync,
    backfill_days: slack.backfill_days,
    broadcast_threshold: slack.broadcast_threshold,
    channel_overrides: slack.channel_overrides,
    channels: slack.channels,
  };

  if (legacyAuth) {
    migratedWorkspace.auth = {
      type: "oauth",
      token: legacyAuth.token,
      refresh_token: legacyAuth.refresh_token,
      workspace_name: legacyAuth.workspace_name,
    };
  }

  stateManager.setHuman({
    ...human,
    settings: {
      ...human.settings,
      slack: {
        polling_interval_ms: slack.polling_interval_ms as number | undefined,
        workspaces: { [workspaceId]: migratedWorkspace } as unknown as import("../integrations/slack/types.js").SlackSettings["workspaces"],
      },
    },
  });

  console.log(`[Processor] migrateSlackToMultiWorkspace: migrated legacy slack settings to workspaces[${workspaceId}]`);
}

export function seedSettings(stateManager: StateManager): void {
  const human = stateManager.getHuman();
  let modified = false;

  if (!human.settings) {
    human.settings = {};
    modified = true;
  }

  if (!human.settings.opencode) {
    human.settings.opencode = {
      integration: false,
      polling_interval_ms: 60000,
    };
    modified = true;
  }

  if (!human.settings.claudeCode) {
    human.settings.claudeCode = {
      integration: false,
      polling_interval_ms: 60000,
    };
    modified = true;
  }

  if (!human.settings.codex) {
    human.settings.codex = {
      integration: false,
      polling_interval_ms: 60000,
    };
    modified = true;
  }

  if (!human.settings.ceremony) {
    human.settings.ceremony = {
      time: "09:00",
    };
    modified = true;
  }

  if (!human.settings.backup) {
    human.settings.backup = {
      enabled: false,
      max_backups: 24,
      interval_ms: 3600000,
    };
    modified = true;
  }

  if (human.settings.default_heartbeat_ms == null) {
    human.settings.default_heartbeat_ms = 1800000;
    modified = true;
  }

  if (human.settings.default_context_window_ms == null) {
    human.settings.default_context_window_ms = 28800000;
    modified = true;
  }

  if (human.settings.message_min_count == null) {
    human.settings.message_min_count = 0;
    modified = true;
  }

  if (human.settings.message_max_age_days == null) {
    human.settings.message_max_age_days = 0;
    modified = true;
  }

  if (modified) {
    stateManager.setHuman(human);
    console.log(`[Processor] Seeded missing settings`);
  }
}
