import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as eiHeartbeat from "../../src/ei-heartbeat.js";
import * as storage from "../../src/storage.js";
import { HumanEntity, PersonaEntity, ConversationHistory } from "../../src/types.js";

vi.mock("../../src/storage.js");

describe("ei-heartbeat", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("getInactivePersonas", () => {
    it("excludes ei persona", async () => {
      vi.mocked(storage.listPersonas).mockResolvedValue([
        { name: "ei", aliases: [] }
      ]);

      const result = await eiHeartbeat.getInactivePersonas();

      expect(result).toEqual([]);
    });

    it("excludes paused personas", async () => {
      const personaEntity: PersonaEntity = {
        entity: "system",
        traits: [],
        topics: [],
        last_updated: null,
        isPaused: true
      };

      vi.mocked(storage.listPersonas).mockResolvedValue([
        { name: "alex", aliases: [] }
      ]);
      vi.mocked(storage.loadPersonaEntity).mockResolvedValue(personaEntity);

      const result = await eiHeartbeat.getInactivePersonas();

      expect(result).toEqual([]);
    });

    it("excludes archived personas", async () => {
      const personaEntity: PersonaEntity = {
        entity: "system",
        traits: [],
        topics: [],
        last_updated: null,
        isArchived: true
      };

      vi.mocked(storage.listPersonas).mockResolvedValue([
        { name: "alex", aliases: [] }
      ]);
      vi.mocked(storage.loadPersonaEntity).mockResolvedValue(personaEntity);

      const result = await eiHeartbeat.getInactivePersonas();

      expect(result).toEqual([]);
    });

    it("excludes personas with recent human messages", async () => {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);

      const personaEntity: PersonaEntity = {
        entity: "system",
        traits: [],
        topics: [],
        last_updated: null
      };

      const history: ConversationHistory = {
        messages: [
          { role: "human", content: "hi", timestamp: yesterday.toISOString(), read: true }
        ]
      };

      vi.mocked(storage.listPersonas).mockResolvedValue([
        { name: "alex", aliases: [] }
      ]);
      vi.mocked(storage.loadPersonaEntity).mockResolvedValue(personaEntity);
      vi.mocked(storage.loadHistory).mockResolvedValue(history);

      const result = await eiHeartbeat.getInactivePersonas(7);

      expect(result).toEqual([]);
    });

    it("includes personas inactive for 7+ days", async () => {
      const tenDaysAgo = new Date();
      tenDaysAgo.setDate(tenDaysAgo.getDate() - 10);

      const personaEntity: PersonaEntity = {
        entity: "system",
        traits: [],
        topics: [],
        last_updated: null,
        short_description: "A helpful assistant"
      };

      const history: ConversationHistory = {
        messages: [
          { role: "human", content: "hi", timestamp: tenDaysAgo.toISOString(), read: true }
        ]
      };

      vi.mocked(storage.listPersonas).mockResolvedValue([
        { name: "alex", aliases: ["al"] }
      ]);
      vi.mocked(storage.loadPersonaEntity).mockResolvedValue(personaEntity);
      vi.mocked(storage.loadHistory).mockResolvedValue(history);

      const result = await eiHeartbeat.getInactivePersonas(7);

      expect(result).toHaveLength(1);
      expect(result[0].name).toBe("alex");
      expect(result[0].daysInactive).toBe(10);
      expect(result[0].aliases).toEqual(["al"]);
      expect(result[0].shortDescription).toBe("A helpful assistant");
    });

    it("excludes personas pinged within 3 days", async () => {
      const tenDaysAgo = new Date();
      tenDaysAgo.setDate(tenDaysAgo.getDate() - 10);
      
      const twoDaysAgo = new Date();
      twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);

      const personaEntity: PersonaEntity = {
        entity: "system",
        traits: [],
        topics: [],
        last_updated: null,
        lastInactivityPing: twoDaysAgo.toISOString()
      };

      const history: ConversationHistory = {
        messages: [
          { role: "human", content: "hi", timestamp: tenDaysAgo.toISOString(), read: true }
        ]
      };

      vi.mocked(storage.listPersonas).mockResolvedValue([
        { name: "alex", aliases: [] }
      ]);
      vi.mocked(storage.loadPersonaEntity).mockResolvedValue(personaEntity);
      vi.mocked(storage.loadHistory).mockResolvedValue(history);

      const result = await eiHeartbeat.getInactivePersonas(7, 3);

      expect(result).toEqual([]);
    });

    it("includes personas pinged 3+ days ago", async () => {
      const tenDaysAgo = new Date();
      tenDaysAgo.setDate(tenDaysAgo.getDate() - 10);
      
      const fourDaysAgo = new Date();
      fourDaysAgo.setDate(fourDaysAgo.getDate() - 4);

      const personaEntity: PersonaEntity = {
        entity: "system",
        traits: [],
        topics: [],
        last_updated: null,
        lastInactivityPing: fourDaysAgo.toISOString()
      };

      const history: ConversationHistory = {
        messages: [
          { role: "human", content: "hi", timestamp: tenDaysAgo.toISOString(), read: true }
        ]
      };

      vi.mocked(storage.listPersonas).mockResolvedValue([
        { name: "alex", aliases: [] }
      ]);
      vi.mocked(storage.loadPersonaEntity).mockResolvedValue(personaEntity);
      vi.mocked(storage.loadHistory).mockResolvedValue(history);

      const result = await eiHeartbeat.getInactivePersonas(7, 3);

      expect(result).toHaveLength(1);
      expect(result[0].name).toBe("alex");
    });

    it("handles personas with no messages ever", async () => {
      const personaEntity: PersonaEntity = {
        entity: "system",
        traits: [],
        topics: [],
        last_updated: null
      };

      const history: ConversationHistory = {
        messages: []
      };

      vi.mocked(storage.listPersonas).mockResolvedValue([
        { name: "alex", aliases: [] }
      ]);
      vi.mocked(storage.loadPersonaEntity).mockResolvedValue(personaEntity);
      vi.mocked(storage.loadHistory).mockResolvedValue(history);

      const result = await eiHeartbeat.getInactivePersonas(7);

      expect(result).toHaveLength(1);
      expect(result[0].daysInactive).toBe(Infinity);
    });

    it("finds most recent human message ignoring system messages", async () => {
      const tenDaysAgo = new Date();
      tenDaysAgo.setDate(tenDaysAgo.getDate() - 10);
      
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);

      const personaEntity: PersonaEntity = {
        entity: "system",
        traits: [],
        topics: [],
        last_updated: null
      };

      const history: ConversationHistory = {
        messages: [
          { role: "human", content: "hi", timestamp: tenDaysAgo.toISOString(), read: true },
          { role: "system", content: "hello!", timestamp: yesterday.toISOString(), read: true }
        ]
      };

      vi.mocked(storage.listPersonas).mockResolvedValue([
        { name: "alex", aliases: [] }
      ]);
      vi.mocked(storage.loadPersonaEntity).mockResolvedValue(personaEntity);
      vi.mocked(storage.loadHistory).mockResolvedValue(history);

      const result = await eiHeartbeat.getInactivePersonas(7);

      expect(result).toHaveLength(1);
      expect(result[0].daysInactive).toBe(10);
    });
  });

  describe("gatherEiHeartbeatContext", () => {
    it("includes ei topics with high engagement deficit", async () => {
      const humanEntity: HumanEntity = {
        entity: "human",
        facts: [],
        traits: [],
        topics: [],
        people: [],
        last_updated: null
      };

      const eiEntity: PersonaEntity = {
        entity: "system",
        traits: [],
        topics: [
          { name: "Helping users", description: "Supporting human growth", level_current: 0.3, level_ideal: 0.8, sentiment: 0.5, last_updated: new Date().toISOString() }
        ],
        last_updated: null
      };

      vi.mocked(storage.listPersonas).mockResolvedValue([]);

      const ctx = await eiHeartbeat.gatherEiHeartbeatContext(humanEntity, eiEntity);

      expect(ctx.eiNeeds).toHaveLength(1);
      expect(ctx.eiNeeds[0].name).toBe("Helping users");
    });

    it("excludes ei topics below threshold", async () => {
      const humanEntity: HumanEntity = {
        entity: "human",
        facts: [],
        traits: [],
        topics: [],
        people: [],
        last_updated: null
      };

      const eiEntity: PersonaEntity = {
        entity: "system",
        traits: [],
        topics: [
          { name: "Low priority", description: "Not urgent", level_current: 0.5, level_ideal: 0.6, sentiment: 0.5, last_updated: new Date().toISOString() }
        ],
        last_updated: null
      };

      vi.mocked(storage.listPersonas).mockResolvedValue([]);

      const ctx = await eiHeartbeat.gatherEiHeartbeatContext(humanEntity, eiEntity);

      expect(ctx.eiNeeds).toHaveLength(0);
    });

    it("includes human topics and people with engagement deficit", async () => {
      const humanEntity: HumanEntity = {
        entity: "human",
        facts: [],
        traits: [],
        topics: [
          { name: "Guitar", description: "Playing music", level_current: 0.2, level_ideal: 0.7, sentiment: 0.8, last_updated: new Date().toISOString() }
        ],
        people: [
          { name: "Mom", description: "Mother", relationship: "mother", level_current: 0.1, level_ideal: 0.9, sentiment: 0.9, last_updated: new Date().toISOString() }
        ],
        last_updated: null
      };

      const eiEntity: PersonaEntity = {
        entity: "system",
        traits: [],
        topics: [],
        last_updated: null
      };

      vi.mocked(storage.listPersonas).mockResolvedValue([]);

      const ctx = await eiHeartbeat.gatherEiHeartbeatContext(humanEntity, eiEntity);

      expect(ctx.humanNeeds).toHaveLength(2);
      expect(ctx.humanNeeds.some(n => n.name === "Guitar")).toBe(true);
      expect(ctx.humanNeeds.some(n => n.name === "Mom")).toBe(true);
    });

    it("limits results to top 3 items per category", async () => {
      const humanEntity: HumanEntity = {
        entity: "human",
        facts: [],
        traits: [],
        topics: [
          { name: "Topic1", description: "T1", level_current: 0.0, level_ideal: 0.5, sentiment: 0, last_updated: new Date().toISOString() },
          { name: "Topic2", description: "T2", level_current: 0.0, level_ideal: 0.6, sentiment: 0, last_updated: new Date().toISOString() },
          { name: "Topic3", description: "T3", level_current: 0.0, level_ideal: 0.7, sentiment: 0, last_updated: new Date().toISOString() },
          { name: "Topic4", description: "T4", level_current: 0.0, level_ideal: 0.8, sentiment: 0, last_updated: new Date().toISOString() }
        ],
        people: [],
        last_updated: null
      };

      const eiEntity: PersonaEntity = {
        entity: "system",
        traits: [],
        topics: [],
        last_updated: null
      };

      vi.mocked(storage.listPersonas).mockResolvedValue([]);

      const ctx = await eiHeartbeat.gatherEiHeartbeatContext(humanEntity, eiEntity);

      expect(ctx.humanNeeds).toHaveLength(3);
      expect(ctx.humanNeeds.map(n => n.name)).toEqual(["Topic4", "Topic3", "Topic2"]);
    });
  });

  describe("trackInactivityPings", () => {
    it("marks persona as pinged when mentioned by name", async () => {
      const inactivePersonas: eiHeartbeat.InactivePersonaInfo[] = [
        { name: "alex", aliases: [], daysInactive: 10 }
      ];

      const personaEntity: PersonaEntity = {
        entity: "system",
        traits: [],
        topics: [],
        last_updated: null
      };

      vi.mocked(storage.loadPersonaEntity).mockResolvedValue(personaEntity);
      vi.mocked(storage.savePersonaEntity).mockResolvedValue();

      await eiHeartbeat.trackInactivityPings("How are things with alex lately?", inactivePersonas);

      expect(storage.savePersonaEntity).toHaveBeenCalledWith(
        expect.objectContaining({
          lastInactivityPing: expect.any(String)
        }),
        "alex"
      );
    });

    it("marks persona as pinged when mentioned by alias", async () => {
      const inactivePersonas: eiHeartbeat.InactivePersonaInfo[] = [
        { name: "alexander", aliases: ["alex", "al"], daysInactive: 10 }
      ];

      const personaEntity: PersonaEntity = {
        entity: "system",
        traits: [],
        topics: [],
        last_updated: null
      };

      vi.mocked(storage.loadPersonaEntity).mockResolvedValue(personaEntity);
      vi.mocked(storage.savePersonaEntity).mockResolvedValue();

      await eiHeartbeat.trackInactivityPings("How is al doing?", inactivePersonas);

      expect(storage.savePersonaEntity).toHaveBeenCalledWith(
        expect.objectContaining({
          lastInactivityPing: expect.any(String)
        }),
        "alexander"
      );
    });

    it("does not mark when persona not mentioned", async () => {
      const inactivePersonas: eiHeartbeat.InactivePersonaInfo[] = [
        { name: "alex", aliases: [], daysInactive: 10 }
      ];

      await eiHeartbeat.trackInactivityPings("How are you doing?", inactivePersonas);

      expect(storage.savePersonaEntity).not.toHaveBeenCalled();
    });

    it("handles empty response", async () => {
      const inactivePersonas: eiHeartbeat.InactivePersonaInfo[] = [
        { name: "alex", aliases: [], daysInactive: 10 }
      ];

      await eiHeartbeat.trackInactivityPings("", inactivePersonas);

      expect(storage.savePersonaEntity).not.toHaveBeenCalled();
    });

    it("is case-insensitive", async () => {
      const inactivePersonas: eiHeartbeat.InactivePersonaInfo[] = [
        { name: "Alex", aliases: [], daysInactive: 10 }
      ];

      const personaEntity: PersonaEntity = {
        entity: "system",
        traits: [],
        topics: [],
        last_updated: null
      };

      vi.mocked(storage.loadPersonaEntity).mockResolvedValue(personaEntity);
      vi.mocked(storage.savePersonaEntity).mockResolvedValue();

      await eiHeartbeat.trackInactivityPings("How is ALEX doing?", inactivePersonas);

      expect(storage.savePersonaEntity).toHaveBeenCalledTimes(1);
    });
  });
});
