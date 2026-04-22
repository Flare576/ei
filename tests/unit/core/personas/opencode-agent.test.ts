import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  ensureAgentPersona,
  ensureAllAgentPersonas,
} from "../../../../src/core/personas/opencode-agent.js";
import type { StateManager } from "../../../../src/core/state-manager.js";
import type { Ei_Interface, PersonaEntity } from "../../../../src/core/types.js";
import type { IOpenCodeReader } from "../../../../src/integrations/opencode/types.js";

describe("ensureAgentPersona", () => {
  let mockStateManager: Partial<StateManager>;
  let mockInterface: Partial<Ei_Interface>;
  let mockReader: Partial<IOpenCodeReader>;

  beforeEach(() => {
    mockStateManager = {
      persona_getByName: vi.fn().mockReturnValue(null),
      persona_add: vi.fn(),
    };
    mockInterface = {
      onPersonaAdded: vi.fn(),
    };
    mockReader = {
      getAgentInfo: vi.fn().mockResolvedValue({
        name: "build",
        description: "The main coding agent",
      }),
    };
  });

  it("returns existing persona if found", async () => {
    const existingPersona: PersonaEntity = {
      id: "build-id",
      display_name: "build",
      entity: "system",
      aliases: ["build"],
      short_description: "Existing persona",
      traits: [],
      topics: [],
      is_paused: false,
      is_archived: false,
      is_static: true,
      last_updated: "2026-01-01T00:00:00.000Z",
    };

    mockStateManager.persona_getByName = vi.fn().mockReturnValue(existingPersona);

    const result = await ensureAgentPersona("build", {
      stateManager: mockStateManager as StateManager,
      interface: mockInterface as Ei_Interface,
      reader: mockReader as IOpenCodeReader,
    });

    expect(result).toBe(existingPersona);
    expect(mockStateManager.persona_add).not.toHaveBeenCalled();
    expect(mockInterface.onPersonaAdded).not.toHaveBeenCalled();
  });

  it("creates new persona if not found", async () => {
    const result = await ensureAgentPersona("build", {
      stateManager: mockStateManager as StateManager,
      interface: mockInterface as Ei_Interface,
      reader: mockReader as IOpenCodeReader,
    });

    expect(mockStateManager.persona_add).toHaveBeenCalledWith(
      expect.objectContaining({
        id: expect.any(String),
        display_name: "Build",
        entity: "system",
        aliases: ["build", "Build"],
        short_description: "The main coding agent",
        long_description: "An OpenCode agent that assists with coding tasks.",
        group_primary: "OpenCode",
        groups_visible: ["OpenCode"],
        is_static: false,
        heartbeat_delay_ms: 43200000,
        traits: expect.arrayContaining([
          expect.objectContaining({ name: "Genuine Responses" }),
          expect.objectContaining({ name: "Natural Speech" }),
        ]),
        topics: [],
      })
    );
    expect(mockInterface.onPersonaAdded).toHaveBeenCalled();
    expect(result.short_description).toBe("The main coding agent");
  });

  it("uses fallback description when agent info not found", async () => {
    mockReader.getAgentInfo = vi.fn().mockResolvedValue(null);

    const result = await ensureAgentPersona("unknown-agent", {
      stateManager: mockStateManager as StateManager,
      interface: mockInterface as Ei_Interface,
      reader: mockReader as IOpenCodeReader,
    });

    expect(result.short_description).toBe("OpenCode coding agent");
  });

  it("sets is_static to false for dynamic persona behavior", async () => {
    const result = await ensureAgentPersona("build", {
      stateManager: mockStateManager as StateManager,
      interface: mockInterface as Ei_Interface,
      reader: mockReader as IOpenCodeReader,
    });

    expect(result.is_static).toBe(false);
  });

  it("sets heartbeat_delay_ms to 12 hours", async () => {
    const result = await ensureAgentPersona("build", {
      stateManager: mockStateManager as StateManager,
      interface: mockInterface as Ei_Interface,
      reader: mockReader as IOpenCodeReader,
    });

    expect(result.heartbeat_delay_ms).toBe(43200000);
  });

  it("sets last_heartbeat to now to prevent immediate heartbeat", async () => {
    const beforeTest = new Date().toISOString();
    
    const result = await ensureAgentPersona("build", {
      stateManager: mockStateManager as StateManager,
      interface: mockInterface as Ei_Interface,
      reader: mockReader as IOpenCodeReader,
    });

    expect(result.last_heartbeat).toBeDefined();
    expect(new Date(result.last_heartbeat!).getTime()).toBeGreaterThanOrEqual(new Date(beforeTest).getTime());
  });

  it("sets group_primary to OpenCode", async () => {
    const result = await ensureAgentPersona("build", {
      stateManager: mockStateManager as StateManager,
      interface: mockInterface as Ei_Interface,
      reader: mockReader as IOpenCodeReader,
    });

    expect(result.group_primary).toBe("OpenCode");
    expect(result.groups_visible).toEqual(["OpenCode"]);
  });

  it("works without interface (no callback)", async () => {
    const result = await ensureAgentPersona("build", {
      stateManager: mockStateManager as StateManager,
      reader: mockReader as IOpenCodeReader,
    });

    expect(mockStateManager.persona_add).toHaveBeenCalled();
    expect(result.short_description).toBe("The main coding agent");
  });

  it("sets aliases from AGENT_ALIASES for known agents", async () => {
    const result = await ensureAgentPersona("sisyphus", {
      stateManager: mockStateManager as StateManager,
      interface: mockInterface as Ei_Interface,
      reader: mockReader as IOpenCodeReader,
    });

    expect(result.aliases).toEqual([
      "sisyphus",
      "Sisyphus",
      "Sisyphus (Ultraworker)",
      "Sisyphus Ultraworker",
      "sisyphus ultraworker",
      "Planner-Sisyphus",
      "planner-sisyphus",
    ]);
    expect(result.display_name).toBe("Sisyphus");
  });

  it("sets alias to agent name for unknown agents", async () => {
    const result = await ensureAgentPersona("some-unknown-agent", {
      stateManager: mockStateManager as StateManager,
      interface: mockInterface as Ei_Interface,
      reader: mockReader as IOpenCodeReader,
    });

    expect(result.aliases).toEqual(["some-unknown-agent"]);
    expect(result.display_name).toBe("Some Unknown Agent");
  });

  it("resolves known alias 'atlas (plan executor)' to canonical 'Atlas'", async () => {
    const result = await ensureAgentPersona("atlas (plan executor)", {
      stateManager: mockStateManager as StateManager,
      interface: mockInterface as Ei_Interface,
      reader: mockReader as IOpenCodeReader,
    });

    expect(result.display_name).toBe("Atlas");
    expect(result.aliases).toContain("atlas (plan executor)");
    expect(result.aliases).toContain("Atlas");
  });

  it("resolves known alias 'build' to canonical 'Build'", async () => {
    const result = await ensureAgentPersona("build", {
      stateManager: mockStateManager as StateManager,
      interface: mockInterface as Ei_Interface,
      reader: mockReader as IOpenCodeReader,
    });

    expect(result.display_name).toBe("Build");
    expect(result.aliases).toEqual(["build", "Build"]);
  });

  it("resolves 'ai-sdlc-frontend-engineer' to canonical 'Frontend Engineer'", async () => {
    const result = await ensureAgentPersona("ai-sdlc-frontend-engineer", {
      stateManager: mockStateManager as StateManager,
      interface: mockInterface as Ei_Interface,
      reader: mockReader as IOpenCodeReader,
    });

    expect(result.display_name).toBe("Frontend Engineer");
    expect(result.aliases).toContain("ai-sdlc-frontend-engineer");
  });

  it("fallback: 'ai-sdlc-some-new-agent' derives canonical 'Some New Agent'", async () => {
    const result = await ensureAgentPersona("ai-sdlc-some-new-agent", {
      stateManager: mockStateManager as StateManager,
      interface: mockInterface as Ei_Interface,
      reader: mockReader as IOpenCodeReader,
    });

    expect(result.display_name).toBe("Some New Agent");
    expect(result.aliases).toEqual(["ai-sdlc-some-new-agent"]);
  });

  it("fallback: 'my-custom-agent (beta)' derives canonical 'My Custom Agent'", async () => {
    const result = await ensureAgentPersona("my-custom-agent (beta)", {
      stateManager: mockStateManager as StateManager,
      interface: mockInterface as Ei_Interface,
      reader: mockReader as IOpenCodeReader,
    });

    expect(result.display_name).toBe("My Custom Agent");
    expect(result.aliases).toEqual(["my-custom-agent (beta)"]);
  });

  it("resolves 'hephaestus (deep agent)' via ALIASES (not fallback) to 'Hephaestus'", async () => {
    const result = await ensureAgentPersona("hephaestus (deep agent)", {
      stateManager: mockStateManager as StateManager,
      interface: mockInterface as Ei_Interface,
      reader: mockReader as IOpenCodeReader,
    });

    expect(result.display_name).toBe("Hephaestus");
    expect(result.aliases).toContain("hephaestus (deep agent)");
    expect(result.aliases).toContain("Hephaestus");
    expect(result.aliases).toContain("hephaestus");
  });

  it("creates persona seeded with DEFAULT_SEED_TRAITS and empty topics", async () => {
    const result = await ensureAgentPersona("build", {
      stateManager: mockStateManager as StateManager,
      interface: mockInterface as Ei_Interface,
      reader: mockReader as IOpenCodeReader,
    });

    expect(result.traits).toHaveLength(2);
    expect(result.traits[0]).toMatchObject({ name: "Genuine Responses", sentiment: 0.5, strength: 0.7 });
    expect(result.traits[1]).toMatchObject({ name: "Natural Speech", sentiment: 0.5, strength: 0.7 });
    expect(result.topics).toEqual([]);
  });
});

describe("ensureAllAgentPersonas", () => {
  let mockStateManager: Partial<StateManager>;
  let mockInterface: Partial<Ei_Interface>;
  let mockReader: Partial<IOpenCodeReader>;

  beforeEach(() => {
    mockStateManager = {
      persona_getByName: vi.fn().mockReturnValue(null),
      persona_add: vi.fn(),
    };
    mockInterface = {
      onPersonaAdded: vi.fn(),
    };
    mockReader = {
      getAgentInfo: vi.fn().mockImplementation(async (name: string) => ({
        name,
        description: `Description for ${name}`,
      })),
    };
  });

  it("creates personas for all agents", async () => {
    const result = await ensureAllAgentPersonas(
      ["build", "sisyphus", "atlas"],
      {
        stateManager: mockStateManager as StateManager,
        interface: mockInterface as Ei_Interface,
        reader: mockReader as IOpenCodeReader,
      }
    );

    expect(result.size).toBe(3);
    expect(result.has("build")).toBe(true);
    expect(result.has("sisyphus")).toBe(true);
    expect(result.has("atlas")).toBe(true);
    expect(mockStateManager.persona_add).toHaveBeenCalledTimes(3);
  });

  it("returns existing personas without creating duplicates", async () => {
    const existingPersona: PersonaEntity = {
      id: "build-id",
      display_name: "build",
      entity: "system",
      aliases: ["build"],
      short_description: "Existing",
      traits: [],
      topics: [],
      is_paused: false,
      is_archived: false,
      is_static: true,
      last_updated: "2026-01-01T00:00:00.000Z",
    };

    mockStateManager.persona_getByName = vi.fn().mockImplementation((name: string) =>
      name === "Build" ? existingPersona : name === "Sisyphus" ? null : null
    );

    const result = await ensureAllAgentPersonas(
      ["build", "sisyphus"],
      {
        stateManager: mockStateManager as StateManager,
        interface: mockInterface as Ei_Interface,
        reader: mockReader as IOpenCodeReader,
      }
    );

    expect(result.size).toBe(2);
    expect(result.get("build")).toBe(existingPersona);
    expect(mockStateManager.persona_add).toHaveBeenCalledTimes(1);
    expect(mockStateManager.persona_add).toHaveBeenCalledWith(
      expect.objectContaining({
        id: expect.any(String),
        display_name: "Sisyphus",
      })
    );
  });

  it("handles empty agent list", async () => {
    const result = await ensureAllAgentPersonas([], {
      stateManager: mockStateManager as StateManager,
      interface: mockInterface as Ei_Interface,
      reader: mockReader as IOpenCodeReader,
    });

    expect(result.size).toBe(0);
    expect(mockStateManager.persona_add).not.toHaveBeenCalled();
  });
});
