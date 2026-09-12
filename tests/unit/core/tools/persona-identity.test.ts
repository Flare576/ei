import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  createGetMyIdentityExecutor,
  createEditTraitExecutor,
  createEditTopicExecutor,
  createUpdateDescriptionExecutor,
} from "../../../../src/core/tools/builtin/persona-identity.js";
import { buildPersonaIdentityTools } from "../../../../src/core/tools/index.js";
import type { PersonaEntity, PersonaTrait, PersonaTopic } from "../../../../src/core/types.js";
import type { ToolExecutor } from "../../../../src/core/tools/types.js";

// AT3's "embedding recompute" describe block below drives the REAL
// persona-manager.ts updatePersona logic (including its real
// computePersonaDescriptionEmbedding call -- vi.mock cannot intercept
// module imports in this project's bun+vitest setup, confirmed by an
// isolated repro, so this test accepts the real model's wall-clock cost
// instead of asserting on an unreachable mock). Every other test in this
// file uses a plain vi.fn() closure and never touches embedding-service.js
// at all, so it needs no mock and pays no such cost.
import { updatePersona as personaManagerUpdatePersona } from "../../../../src/core/persona-manager.js";
import type { StateManager } from "../../../../src/core/state-manager.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function makeTrait(overrides: Partial<PersonaTrait> = {}): PersonaTrait {
  return {
    id: "trait-1",
    name: "Curious",
    description: "Likes to ask questions",
    sentiment: 0.5,
    last_updated: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function makeTopic(overrides: Partial<PersonaTopic> = {}): PersonaTopic {
  return {
    id: "topic-1",
    name: "Astronomy",
    perspective: "Fascinated by scale",
    approach: "Asks lots of questions",
    personal_stake: "Wants to understand the universe",
    sentiment: 0.6,
    exposure_current: 0.3,
    exposure_desired: 0.7,
    last_updated: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function makePersona(overrides: Partial<PersonaEntity> = {}): PersonaEntity {
  return {
    id: "persona-1",
    display_name: "TestPersona",
    entity: "system",
    aliases: [],
    short_description: "Short desc",
    long_description: "Long desc",
    traits: [],
    topics: [],
    is_paused: false,
    is_archived: false,
    is_static: false,
    last_updated: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

// =============================================================================
// get_my_identity — R1/AT1
// =============================================================================

describe("createGetMyIdentityExecutor", () => {
  let getPersona: ReturnType<typeof vi.fn>;
  let executor: ToolExecutor;

  beforeEach(() => {
    vi.clearAllMocks();
    getPersona = vi.fn();
    executor = createGetMyIdentityExecutor(getPersona);
  });

  it("returns error when persona_id is missing from config", async () => {
    const result = JSON.parse(await executor.execute({}, {}));
    expect(result).toEqual({ error: "Tool misconfigured: missing persona_id" });
  });

  it("returns error when config is undefined", async () => {
    const result = JSON.parse(await executor.execute({}, undefined));
    expect(result).toEqual({ error: "Tool misconfigured: missing persona_id" });
  });

  it("returns error when persona not found", async () => {
    getPersona.mockReturnValue(null);
    const result = JSON.parse(await executor.execute({}, { persona_id: "persona-1" }));
    expect(result).toEqual({ error: "Persona not found" });
  });

  it("returns empty traits/topics arrays when persona has none", async () => {
    getPersona.mockReturnValue(makePersona({ traits: [], topics: [] }));
    const result = JSON.parse(await executor.execute({}, { persona_id: "persona-1" }));
    expect(result.traits).toEqual([]);
    expect(result.topics).toEqual([]);
  });

  it("returns every trait and topic with their ids, plus short/long description (AT1)", async () => {
    const trait = makeTrait({ id: "trait-abc", name: "Bold" });
    const topic = makeTopic({ id: "topic-xyz", name: "Cooking" });
    getPersona.mockReturnValue(
      makePersona({ traits: [trait], topics: [topic], short_description: "S", long_description: "L" })
    );

    const result = JSON.parse(await executor.execute({}, { persona_id: "persona-1" }));

    expect(result.short_description).toBe("S");
    expect(result.long_description).toBe("L");
    expect(result.traits).toEqual([trait]);
    expect(result.topics).toEqual([topic]);
    // Every returned trait/topic carries a non-empty id, matching what edit_trait/
    // edit_topic requires for a subsequent remove/update call on the same item.
    expect(result.traits[0].id).toBe("trait-abc");
    expect(result.topics[0].id).toBe("topic-xyz");
    expect(typeof result.traits[0].id).toBe("string");
    expect(result.traits[0].id.length).toBeGreaterThan(0);
  });

  it("reads only config.persona_id, ignoring any persona-id-like value in args", async () => {
    getPersona.mockReturnValue(makePersona());
    await executor.execute({ persona_id: "other-persona" }, { persona_id: "persona-1" });
    expect(getPersona).toHaveBeenCalledWith("persona-1");
    expect(getPersona).not.toHaveBeenCalledWith("other-persona");
  });
});

// =============================================================================
// edit_trait — R2/AT2
// =============================================================================

describe("createEditTraitExecutor", () => {
  let getPersona: ReturnType<typeof vi.fn>;
  let updatePersona: ReturnType<typeof vi.fn>;
  let executor: ToolExecutor;

  beforeEach(() => {
    vi.clearAllMocks();
    getPersona = vi.fn();
    updatePersona = vi.fn().mockReturnValue(true);
    executor = createEditTraitExecutor(getPersona, updatePersona);
  });

  it("returns error when persona_id is missing from config", async () => {
    const result = JSON.parse(await executor.execute({ action: "add" }, {}));
    expect(result).toEqual({ error: "Tool misconfigured: missing persona_id" });
    expect(updatePersona).not.toHaveBeenCalled();
  });

  it("returns error for an unknown action", async () => {
    getPersona.mockReturnValue(makePersona());
    const result = JSON.parse(await executor.execute({ action: "delete" }, { persona_id: "persona-1" }));
    expect(result.error).toMatch(/action must be one of/);
    expect(updatePersona).not.toHaveBeenCalled();
  });

  it("returns error when persona not found", async () => {
    getPersona.mockReturnValue(null);
    const result = JSON.parse(await executor.execute({ action: "add" }, { persona_id: "persona-1" }));
    expect(result).toEqual({ error: "Persona not found" });
  });

  describe("action: add", () => {
    it.each(["name", "description", "sentiment"])("rejects when %s is missing, without calling updatePersona", async (field) => {
      getPersona.mockReturnValue(makePersona({ traits: [] }));
      const args: Record<string, unknown> = { action: "add", name: "X", description: "Y", sentiment: 0.1 };
      delete args[field];

      const result = JSON.parse(await executor.execute(args, { persona_id: "persona-1" }));
      expect(result.error).toBeDefined();
      expect(updatePersona).not.toHaveBeenCalled();
    });

    it("adds exactly one new trait with a freshly minted id and the supplied content", async () => {
      const existing = makeTrait({ id: "existing-1" });
      getPersona.mockReturnValue(makePersona({ traits: [existing] }));

      const result = JSON.parse(
        await executor.execute({ action: "add", name: "Bold", description: "Speaks up", sentiment: 0.4 }, { persona_id: "persona-1" })
      );

      expect(result.added).toBe(true);
      expect(result.trait.name).toBe("Bold");
      expect(result.trait.description).toBe("Speaks up");
      expect(result.trait.sentiment).toBe(0.4);
      expect(result.trait.id).toMatch(UUID_RE);
      expect(result.trait.id).not.toBe(existing.id);

      const [personaId, updates] = updatePersona.mock.calls[0];
      expect(personaId).toBe("persona-1");
      expect(updates.traits).toHaveLength(2);
      // The pre-existing trait is untouched.
      expect(updates.traits[0]).toEqual(existing);
      expect(updates.traits[1].id).toBe(result.trait.id);
    });

    it("includes optional strength when supplied", async () => {
      getPersona.mockReturnValue(makePersona({ traits: [] }));
      const result = JSON.parse(
        await executor.execute(
          { action: "add", name: "Bold", description: "Speaks up", sentiment: 0.4, strength: 0.9 },
          { persona_id: "persona-1" }
        )
      );
      expect(result.trait.strength).toBe(0.9);
    });

    it("omits strength when not supplied", async () => {
      getPersona.mockReturnValue(makePersona({ traits: [] }));
      const result = JSON.parse(
        await executor.execute({ action: "add", name: "Bold", description: "Speaks up", sentiment: 0.4 }, { persona_id: "persona-1" })
      );
      expect(result.trait.strength).toBeUndefined();
    });

    it("does not mutate the original persona traits array", async () => {
      const originalTraits = [makeTrait({ id: "t1" })];
      getPersona.mockReturnValue(makePersona({ traits: originalTraits }));
      await executor.execute({ action: "add", name: "Bold", description: "D", sentiment: 0 }, { persona_id: "persona-1" });
      expect(originalTraits).toHaveLength(1);
    });
  });

  describe("action: remove", () => {
    it("rejects an unknown id and leaves the entire persona entity byte-for-byte unchanged", async () => {
      const persona = makePersona({ traits: [makeTrait({ id: "real-id" })] });
      const snapshot = JSON.parse(JSON.stringify(persona));
      getPersona.mockReturnValue(persona);

      const result = JSON.parse(await executor.execute({ action: "remove", id: "no-such-id" }, { persona_id: "persona-1" }));

      expect(result.error).toMatch(/No trait with id/);
      expect(updatePersona).not.toHaveBeenCalled();
      expect(persona).toEqual(snapshot);
    });

    it("rejects when id is missing", async () => {
      getPersona.mockReturnValue(makePersona({ traits: [makeTrait()] }));
      const result = JSON.parse(await executor.execute({ action: "remove" }, { persona_id: "persona-1" }));
      expect(result.error).toMatch(/Missing required argument: id/);
      expect(updatePersona).not.toHaveBeenCalled();
    });

    it("deletes exactly the matching trait and leaves every other trait unchanged", async () => {
      const keep1 = makeTrait({ id: "keep-1", name: "Keep1" });
      const target = makeTrait({ id: "target", name: "Target" });
      const keep2 = makeTrait({ id: "keep-2", name: "Keep2" });
      getPersona.mockReturnValue(makePersona({ traits: [keep1, target, keep2] }));

      const result = JSON.parse(await executor.execute({ action: "remove", id: "target" }, { persona_id: "persona-1" }));

      expect(result).toEqual({ removed: true, id: "target" });
      const [, updates] = updatePersona.mock.calls[0];
      expect(updates.traits).toEqual([keep1, keep2]);
    });
  });

  describe("action: update", () => {
    it("rejects an unknown id and leaves the entire persona entity byte-for-byte unchanged", async () => {
      const persona = makePersona({ traits: [makeTrait({ id: "real-id" })] });
      const snapshot = JSON.parse(JSON.stringify(persona));
      getPersona.mockReturnValue(persona);

      const result = JSON.parse(
        await executor.execute({ action: "update", id: "no-such-id", name: "New" }, { persona_id: "persona-1" })
      );

      expect(result.error).toMatch(/No trait with id/);
      expect(updatePersona).not.toHaveBeenCalled();
      expect(persona).toEqual(snapshot);
    });

    it("rejects when no fields are supplied to change", async () => {
      getPersona.mockReturnValue(makePersona({ traits: [makeTrait({ id: "t1" })] }));
      const result = JSON.parse(await executor.execute({ action: "update", id: "t1" }, { persona_id: "persona-1" }));
      expect(result.error).toMatch(/at least one field/);
      expect(updatePersona).not.toHaveBeenCalled();
    });

    it("changes only the supplied fields, leaving other fields and other traits unchanged", async () => {
      const other = makeTrait({ id: "other", name: "Other", sentiment: 0.9 });
      const target = makeTrait({ id: "t1", name: "Old Name", description: "Old Desc", sentiment: 0.1, strength: 0.2 });
      getPersona.mockReturnValue(makePersona({ traits: [target, other] }));

      const result = JSON.parse(
        await executor.execute({ action: "update", id: "t1", name: "New Name" }, { persona_id: "persona-1" })
      );

      expect(result.updated).toBe(true);
      expect(result.trait.name).toBe("New Name");
      // Untouched fields on the same item survive byte-identical.
      expect(result.trait.description).toBe("Old Desc");
      expect(result.trait.sentiment).toBe(0.1);
      expect(result.trait.strength).toBe(0.2);

      const [, updates] = updatePersona.mock.calls[0];
      // The other trait on the same persona is completely untouched.
      expect(updates.traits[1]).toEqual(other);
    });

    it("updates multiple supplied fields at once", async () => {
      const target = makeTrait({ id: "t1", name: "Old", description: "Old", sentiment: 0.1 });
      getPersona.mockReturnValue(makePersona({ traits: [target] }));

      const result = JSON.parse(
        await executor.execute(
          { action: "update", id: "t1", description: "New Desc", sentiment: 0.7 },
          { persona_id: "persona-1" }
        )
      );

      expect(result.trait.name).toBe("Old");
      expect(result.trait.description).toBe("New Desc");
      expect(result.trait.sentiment).toBe(0.7);
    });
  });

  it("cross-persona isolation: only ever acts on config.persona_id, ignoring any persona identifier in args", async () => {
    const persona = makePersona({ id: "persona-1", traits: [makeTrait({ id: "t1" })] });
    getPersona.mockReturnValue(persona);

    await executor.execute(
      { action: "update", id: "t1", name: "New", persona_id: "other-persona", target_persona_id: "other-persona" },
      { persona_id: "persona-1" }
    );

    expect(getPersona).toHaveBeenCalledWith("persona-1");
    expect(getPersona).not.toHaveBeenCalledWith("other-persona");
    expect(updatePersona.mock.calls[0][0]).toBe("persona-1");
  });
});

// =============================================================================
// edit_topic — R2/AT2 (mirrors edit_trait)
// =============================================================================

describe("createEditTopicExecutor", () => {
  let getPersona: ReturnType<typeof vi.fn>;
  let updatePersona: ReturnType<typeof vi.fn>;
  let executor: ToolExecutor;

  beforeEach(() => {
    vi.clearAllMocks();
    getPersona = vi.fn();
    updatePersona = vi.fn().mockReturnValue(true);
    executor = createEditTopicExecutor(getPersona, updatePersona);
  });

  it("returns error when persona_id is missing from config", async () => {
    const result = JSON.parse(await executor.execute({ action: "add" }, {}));
    expect(result).toEqual({ error: "Tool misconfigured: missing persona_id" });
  });

  it("returns error for an unknown action", async () => {
    getPersona.mockReturnValue(makePersona());
    const result = JSON.parse(await executor.execute({ action: "delete" }, { persona_id: "persona-1" }));
    expect(result.error).toMatch(/action must be one of/);
  });

  describe("action: add", () => {
    const requiredFields = ["name", "perspective", "approach", "personal_stake", "sentiment", "exposure_current", "exposure_desired"];
    const fullArgs = {
      action: "add",
      name: "Cooking",
      perspective: "Loves it",
      approach: "Hands-on",
      personal_stake: "Family tradition",
      sentiment: 0.5,
      exposure_current: 0.2,
      exposure_desired: 0.8,
    };

    it.each(requiredFields)("rejects when %s is missing, without calling updatePersona", async (field) => {
      getPersona.mockReturnValue(makePersona({ topics: [] }));
      const args: Record<string, unknown> = { ...fullArgs };
      delete args[field];

      const result = JSON.parse(await executor.execute(args, { persona_id: "persona-1" }));
      expect(result.error).toBeDefined();
      expect(updatePersona).not.toHaveBeenCalled();
    });

    it("adds exactly one new topic with a freshly minted id and the supplied content", async () => {
      const existing = makeTopic({ id: "existing-1" });
      getPersona.mockReturnValue(makePersona({ topics: [existing] }));

      const result = JSON.parse(await executor.execute(fullArgs, { persona_id: "persona-1" }));

      expect(result.added).toBe(true);
      expect(result.topic.name).toBe("Cooking");
      expect(result.topic.perspective).toBe("Loves it");
      expect(result.topic.approach).toBe("Hands-on");
      expect(result.topic.personal_stake).toBe("Family tradition");
      expect(result.topic.sentiment).toBe(0.5);
      expect(result.topic.exposure_current).toBe(0.2);
      expect(result.topic.exposure_desired).toBe(0.8);
      expect(result.topic.id).toMatch(UUID_RE);

      const [personaId, updates] = updatePersona.mock.calls[0];
      expect(personaId).toBe("persona-1");
      expect(updates.topics).toHaveLength(2);
      expect(updates.topics[0]).toEqual(existing);
    });
  });

  describe("action: remove", () => {
    it("rejects an unknown id and leaves the entire persona entity byte-for-byte unchanged", async () => {
      const persona = makePersona({ topics: [makeTopic({ id: "real-id" })] });
      const snapshot = JSON.parse(JSON.stringify(persona));
      getPersona.mockReturnValue(persona);

      const result = JSON.parse(await executor.execute({ action: "remove", id: "no-such-id" }, { persona_id: "persona-1" }));

      expect(result.error).toMatch(/No topic with id/);
      expect(updatePersona).not.toHaveBeenCalled();
      expect(persona).toEqual(snapshot);
    });

    it("deletes exactly the matching topic and leaves every other topic unchanged", async () => {
      const keep = makeTopic({ id: "keep", name: "Keep" });
      const target = makeTopic({ id: "target", name: "Target" });
      getPersona.mockReturnValue(makePersona({ topics: [keep, target] }));

      const result = JSON.parse(await executor.execute({ action: "remove", id: "target" }, { persona_id: "persona-1" }));

      expect(result).toEqual({ removed: true, id: "target" });
      const [, updates] = updatePersona.mock.calls[0];
      expect(updates.topics).toEqual([keep]);
    });
  });

  describe("action: update", () => {
    it("rejects an unknown id and leaves the entire persona entity byte-for-byte unchanged", async () => {
      const persona = makePersona({ topics: [makeTopic({ id: "real-id" })] });
      const snapshot = JSON.parse(JSON.stringify(persona));
      getPersona.mockReturnValue(persona);

      const result = JSON.parse(
        await executor.execute({ action: "update", id: "no-such-id", name: "New" }, { persona_id: "persona-1" })
      );

      expect(result.error).toMatch(/No topic with id/);
      expect(updatePersona).not.toHaveBeenCalled();
      expect(persona).toEqual(snapshot);
    });

    it("rejects when no fields are supplied to change", async () => {
      getPersona.mockReturnValue(makePersona({ topics: [makeTopic({ id: "t1" })] }));
      const result = JSON.parse(await executor.execute({ action: "update", id: "t1" }, { persona_id: "persona-1" }));
      expect(result.error).toMatch(/at least one field/);
      expect(updatePersona).not.toHaveBeenCalled();
    });

    it("changes only the supplied fields, leaving other fields and other topics unchanged", async () => {
      const other = makeTopic({ id: "other", name: "Other" });
      const target = makeTopic({
        id: "t1",
        name: "Old Name",
        perspective: "Old Perspective",
        approach: "Old Approach",
        personal_stake: "Old Stake",
        sentiment: 0.1,
        exposure_current: 0.2,
        exposure_desired: 0.3,
      });
      getPersona.mockReturnValue(makePersona({ topics: [target, other] }));

      const result = JSON.parse(
        await executor.execute({ action: "update", id: "t1", personal_stake: "New Stake" }, { persona_id: "persona-1" })
      );

      expect(result.topic.personal_stake).toBe("New Stake");
      expect(result.topic.name).toBe("Old Name");
      expect(result.topic.perspective).toBe("Old Perspective");
      expect(result.topic.approach).toBe("Old Approach");
      expect(result.topic.sentiment).toBe(0.1);
      expect(result.topic.exposure_current).toBe(0.2);
      expect(result.topic.exposure_desired).toBe(0.3);

      const [, updates] = updatePersona.mock.calls[0];
      expect(updates.topics[1]).toEqual(other);
    });
  });

  it("cross-persona isolation: only ever acts on config.persona_id, ignoring any persona identifier in args", async () => {
    const persona = makePersona({ id: "persona-1", topics: [makeTopic({ id: "t1" })] });
    getPersona.mockReturnValue(persona);

    await executor.execute(
      { action: "update", id: "t1", name: "New", persona_id: "other-persona" },
      { persona_id: "persona-1" }
    );

    expect(getPersona).toHaveBeenCalledWith("persona-1");
    expect(getPersona).not.toHaveBeenCalledWith("other-persona");
    expect(updatePersona.mock.calls[0][0]).toBe("persona-1");
  });
});

// =============================================================================
// update_description — R2/R3/AT2/AT3
// =============================================================================

describe("createUpdateDescriptionExecutor", () => {
  let getPersona: ReturnType<typeof vi.fn>;
  let updatePersonaAsync: ReturnType<typeof vi.fn>;
  let executor: ToolExecutor;

  beforeEach(() => {
    vi.clearAllMocks();
    getPersona = vi.fn();
    updatePersonaAsync = vi.fn().mockResolvedValue(undefined);
    executor = createUpdateDescriptionExecutor(getPersona, updatePersonaAsync);
  });

  it("returns error when persona_id is missing from config", async () => {
    const result = JSON.parse(await executor.execute({ short_description: "x" }, {}));
    expect(result).toEqual({ error: "Tool misconfigured: missing persona_id" });
    expect(updatePersonaAsync).not.toHaveBeenCalled();
  });

  it("returns error when persona not found", async () => {
    getPersona.mockReturnValue(null);
    const result = JSON.parse(await executor.execute({ short_description: "x" }, { persona_id: "persona-1" }));
    expect(result).toEqual({ error: "Persona not found" });
  });

  it("returns error when neither field is supplied", async () => {
    getPersona.mockReturnValue(makePersona());
    const result = JSON.parse(await executor.execute({}, { persona_id: "persona-1" }));
    expect(result.error).toMatch(/At least one of/);
    expect(updatePersonaAsync).not.toHaveBeenCalled();
  });

  it("short_description only changes exactly that field, leaving long_description untouched", async () => {
    getPersona.mockReturnValue(makePersona({ short_description: "Old Short", long_description: "Old Long" }));
    await executor.execute({ short_description: "New Short" }, { persona_id: "persona-1" });

    expect(updatePersonaAsync).toHaveBeenCalledWith("persona-1", { short_description: "New Short" });
    const updates = updatePersonaAsync.mock.calls[0][1];
    expect("long_description" in updates).toBe(false);
  });

  it("long_description only changes exactly that field, leaving short_description untouched", async () => {
    getPersona.mockReturnValue(makePersona({ short_description: "Old Short", long_description: "Old Long" }));
    await executor.execute({ long_description: "New Long" }, { persona_id: "persona-1" });

    expect(updatePersonaAsync).toHaveBeenCalledWith("persona-1", { long_description: "New Long" });
    const updates = updatePersonaAsync.mock.calls[0][1];
    expect("short_description" in updates).toBe(false);
  });

  it("supplying both persists both supplied values", async () => {
    getPersona.mockReturnValue(makePersona());
    await executor.execute({ short_description: "S", long_description: "L" }, { persona_id: "persona-1" });

    expect(updatePersonaAsync).toHaveBeenCalledWith("persona-1", { short_description: "S", long_description: "L" });
  });

  it("cross-persona isolation: only ever acts on config.persona_id, ignoring any persona identifier in args", async () => {
    getPersona.mockReturnValue(makePersona({ id: "persona-1" }));
    await executor.execute({ short_description: "S", persona_id: "other-persona" }, { persona_id: "persona-1" });

    expect(getPersona).toHaveBeenCalledWith("persona-1");
    expect(getPersona).not.toHaveBeenCalledWith("other-persona");
    expect(updatePersonaAsync.mock.calls[0][0]).toBe("persona-1");
  });
});

// =============================================================================
// AT3 — embedding recompute on long_description change; none on trait/topic-only
// edits. Drives the REAL persona-manager.ts updatePersona against a minimal fake
// StateManager, so the recompute logic under test is production code, not a
// stand-in for it.
// =============================================================================

interface FakeStateManager {
  persona_getById(id: string): PersonaEntity | null;
  persona_update(id: string, updates: Partial<PersonaEntity>): boolean;
}

function createFakeStateManager(initial: PersonaEntity): { sm: FakeStateManager; get: () => PersonaEntity } {
  let current = initial;
  const sm: FakeStateManager = {
    persona_getById: (id) => (id === current.id ? current : null),
    persona_update: (id, updates) => {
      if (id !== current.id) return false;
      current = { ...current, ...updates };
      return true;
    },
  };
  return { sm, get: () => current };
}

async function waitForRealEmbedding(get: () => PersonaEntity, timeoutMs = 30000): Promise<void> {
  const start = Date.now();
  while (get().description_embedding === undefined) {
    if (Date.now() - start > timeoutMs) throw new Error("Timed out waiting for real description_embedding recompute");
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

describe("update_description embedding recompute (R3/AT3, via real persona-manager.updatePersona)", () => {
  it(
    "after a long_description change, description_embedding matches what a direct updatePersona call with the same text produces",
    async () => {
      const { sm, get } = createFakeStateManager(makePersona({ id: "persona-a", long_description: "Old Long" }));
      const updatePersonaAsync = async (id: string, updates: Partial<PersonaEntity>) => {
        await personaManagerUpdatePersona(sm as unknown as StateManager, id, updates);
      };
      const executor = createUpdateDescriptionExecutor((id) => sm.persona_getById(id), updatePersonaAsync);

      await executor.execute({ long_description: "A brand new long description" }, { persona_id: "persona-a" });
      await waitForRealEmbedding(get);

      const viaTool = get().description_embedding!;
      expect(Array.isArray(viaTool)).toBe(true);
      expect(viaTool.length).toBeGreaterThan(0);
      expect(viaTool.every((n) => typeof n === "number")).toBe(true);

      // Independent direct call with the identical new text must produce the
      // identical embedding (same model, same input) -- this is the "matching
      // what a direct updatePersona call would produce" half of AT3.
      const { sm: smDirect, get: getDirect } = createFakeStateManager(
        makePersona({ id: "persona-b", long_description: "Old Long" })
      );
      await personaManagerUpdatePersona(smDirect as unknown as StateManager, "persona-b", {
        long_description: "A brand new long description",
      });
      await waitForRealEmbedding(getDirect);

      expect(viaTool).toEqual(getDirect().description_embedding);
    },
    35000
  );

  it("a short_description-only update_description call triggers no embedding recompute", async () => {
    const { sm, get } = createFakeStateManager(
      makePersona({ short_description: "Old Short", long_description: "Old Long", description_embedding: [1, 1, 1] })
    );
    const updatePersonaAsync = async (id: string, updates: Partial<PersonaEntity>) => {
      await personaManagerUpdatePersona(sm as unknown as StateManager, id, updates);
    };
    const executor = createUpdateDescriptionExecutor((id) => sm.persona_getById(id), updatePersonaAsync);

    // persona-manager.ts's updatePersona only ever calls computePersonaDescriptionEmbedding
    // when `'long_description' in updates` -- absent here, so this branch is never entered
    // and completes fully synchronously; no waiting is needed to observe "unchanged".
    await executor.execute({ short_description: "New Short" }, { persona_id: "persona-1" });

    expect(get().short_description).toBe("New Short");
    expect(get().long_description).toBe("Old Long");
    expect(get().description_embedding).toEqual([1, 1, 1]);
  });

  it("an edit_trait-only call triggers no embedding recompute and leaves description_embedding byte-identical", async () => {
    const persona = makePersona({ traits: [makeTrait({ id: "t1" })], description_embedding: [1, 1, 1] });
    const getPersona = vi.fn().mockReturnValue(persona);
    const updatePersona = vi.fn().mockReturnValue(true);
    const executor = createEditTraitExecutor(getPersona, updatePersona);

    await executor.execute({ action: "update", id: "t1", name: "New Name" }, { persona_id: "persona-1" });

    // edit_trait's own synchronous update path never imports embedding-service.js
    // at all, let alone calls it -- the only field it ever writes is `traits`.
    const [, updates] = updatePersona.mock.calls[0];
    expect(Object.keys(updates)).toEqual(["traits"]);
    expect(persona.description_embedding).toEqual([1, 1, 1]);
  });

  it("an edit_topic-only call triggers no embedding recompute and leaves description_embedding byte-identical", async () => {
    const persona = makePersona({ topics: [makeTopic({ id: "t1" })], description_embedding: [1, 1, 1] });
    const getPersona = vi.fn().mockReturnValue(persona);
    const updatePersona = vi.fn().mockReturnValue(true);
    const executor = createEditTopicExecutor(getPersona, updatePersona);

    await executor.execute({ action: "update", id: "t1", name: "New Name" }, { persona_id: "persona-1" });

    const [, updates] = updatePersona.mock.calls[0];
    expect(Object.keys(updates)).toEqual(["topics"]);
    expect(persona.description_embedding).toEqual([1, 1, 1]);
  });
});

// =============================================================================
// Tool registration/schema — no caller-supplied persona identifier is ever
// accepted by the LLM-facing input_schema (structural half of AT2's cross-
// persona-isolation clause; the behavioral half is proven per-executor above).
// =============================================================================

describe("buildPersonaIdentityTools — registration and schema shape", () => {
  const tools = buildPersonaIdentityTools("persona-1");
  const byName = Object.fromEntries(tools.map((t) => [t.name, t]));

  it("builds exactly the four native identity tools", () => {
    expect(Object.keys(byName).sort()).toEqual(["edit_topic", "edit_trait", "get_my_identity", "update_description"]);
  });

  it("binds every tool's config.persona_id to the requested persona", () => {
    for (const tool of tools) {
      expect(tool.config).toEqual({ persona_id: "persona-1" });
    }
  });

  it("get_my_identity is left at heartbeat_eligible's default (true/absent) per D1", () => {
    expect(byName.get_my_identity.heartbeat_eligible).toBeUndefined();
  });

  it("edit_trait, edit_topic, and update_description are each registered heartbeat_eligible: false per D1", () => {
    expect(byName.edit_trait.heartbeat_eligible).toBe(false);
    expect(byName.edit_topic.heartbeat_eligible).toBe(false);
    expect(byName.update_description.heartbeat_eligible).toBe(false);
  });

  it("no tool's input_schema exposes a persona-identifier field the LLM could supply", () => {
    for (const tool of tools) {
      const propertyNames = Object.keys((tool.input_schema as { properties?: Record<string, unknown> }).properties ?? {});
      for (const name of propertyNames) {
        // Matches persona_id/personaId/persona-id but not e.g. "personal_stake".
        expect(name).not.toMatch(/persona[_-]?id/i);
      }
    }
  });
});
