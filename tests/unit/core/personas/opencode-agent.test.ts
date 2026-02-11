import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  ensureAgentPersona,
  ensureAllAgentPersonas,
} from "../../../../src/core/personas/opencode-agent.js";
import type { StateManager } from "../../../../src/core/state-manager.js";
import type { Ei_Interface, PersonaEntity } from "../../../../src/core/types.js";
import type { OpenCodeReader } from "../../../../src/integrations/opencode/reader.js";

describe("ensureAgentPersona", () => {
  let mockStateManager: Partial<StateManager>;
  let mockInterface: Partial<Ei_Interface>;
  let mockReader: Partial<OpenCodeReader>;

  beforeEach(() => {
    mockStateManager = {
      persona_get: vi.fn().mockReturnValue(null),
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
      entity: "system",
      aliases: ["build"],
      short_description: "Existing persona",
      traits: [],
      topics: [],
      is_paused: false,
      is_archived: false,
      is_static: true,
      last_updated: "2026-01-01T00:00:00.000Z",
      last_activity: "2026-01-01T00:00:00.000Z",
    };

    mockStateManager.persona_get = vi.fn().mockReturnValue(existingPersona);

    const result = await ensureAgentPersona("build", {
      stateManager: mockStateManager as StateManager,
      interface: mockInterface as Ei_Interface,
      reader: mockReader as OpenCodeReader,
    });

    expect(result).toBe(existingPersona);
    expect(mockStateManager.persona_add).not.toHaveBeenCalled();
    expect(mockInterface.onPersonaAdded).not.toHaveBeenCalled();
  });

  it("creates new persona if not found", async () => {
    const result = await ensureAgentPersona("build", {
      stateManager: mockStateManager as StateManager,
      interface: mockInterface as Ei_Interface,
      reader: mockReader as OpenCodeReader,
    });

    expect(mockStateManager.persona_add).toHaveBeenCalledWith(
      "build",
      expect.objectContaining({
        entity: "system",
        aliases: ["build"],
        short_description: "The main coding agent",
        long_description: "An OpenCode agent that assists with coding tasks.",
        group_primary: "OpenCode",
        groups_visible: ["OpenCode"],
        is_static: true,
        heartbeat_delay_ms: 0,
        traits: [],
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
      reader: mockReader as OpenCodeReader,
    });

    expect(result.short_description).toBe("OpenCode coding agent");
  });

  it("sets is_static to true", async () => {
    const result = await ensureAgentPersona("build", {
      stateManager: mockStateManager as StateManager,
      interface: mockInterface as Ei_Interface,
      reader: mockReader as OpenCodeReader,
    });

    expect(result.is_static).toBe(true);
  });

  it("sets heartbeat_delay_ms to 0", async () => {
    const result = await ensureAgentPersona("build", {
      stateManager: mockStateManager as StateManager,
      interface: mockInterface as Ei_Interface,
      reader: mockReader as OpenCodeReader,
    });

    expect(result.heartbeat_delay_ms).toBe(0);
  });

  it("sets group_primary to OpenCode", async () => {
    const result = await ensureAgentPersona("build", {
      stateManager: mockStateManager as StateManager,
      interface: mockInterface as Ei_Interface,
      reader: mockReader as OpenCodeReader,
    });

    expect(result.group_primary).toBe("OpenCode");
    expect(result.groups_visible).toEqual(["OpenCode"]);
  });

  it("works without interface (no callback)", async () => {
    const result = await ensureAgentPersona("build", {
      stateManager: mockStateManager as StateManager,
      reader: mockReader as OpenCodeReader,
    });

    expect(mockStateManager.persona_add).toHaveBeenCalled();
    expect(result.short_description).toBe("The main coding agent");
  });

  it("sets alias to agent name", async () => {
    const result = await ensureAgentPersona("sisyphus", {
      stateManager: mockStateManager as StateManager,
      interface: mockInterface as Ei_Interface,
      reader: mockReader as OpenCodeReader,
    });

    expect(result.aliases).toEqual(["sisyphus"]);
  });

  it("creates persona with empty traits and topics", async () => {
    const result = await ensureAgentPersona("build", {
      stateManager: mockStateManager as StateManager,
      interface: mockInterface as Ei_Interface,
      reader: mockReader as OpenCodeReader,
    });

    expect(result.traits).toEqual([]);
    expect(result.topics).toEqual([]);
  });
});

describe("ensureAllAgentPersonas", () => {
  let mockStateManager: Partial<StateManager>;
  let mockInterface: Partial<Ei_Interface>;
  let mockReader: Partial<OpenCodeReader>;

  beforeEach(() => {
    mockStateManager = {
      persona_get: vi.fn().mockReturnValue(null),
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
        reader: mockReader as OpenCodeReader,
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
      entity: "system",
      aliases: ["build"],
      short_description: "Existing",
      traits: [],
      topics: [],
      is_paused: false,
      is_archived: false,
      is_static: true,
      last_updated: "2026-01-01T00:00:00.000Z",
      last_activity: "2026-01-01T00:00:00.000Z",
    };

    mockStateManager.persona_get = vi.fn().mockImplementation((name: string) =>
      name === "build" ? existingPersona : null
    );

    const result = await ensureAllAgentPersonas(
      ["build", "sisyphus"],
      {
        stateManager: mockStateManager as StateManager,
        interface: mockInterface as Ei_Interface,
        reader: mockReader as OpenCodeReader,
      }
    );

    expect(result.size).toBe(2);
    expect(result.get("build")).toBe(existingPersona);
    expect(mockStateManager.persona_add).toHaveBeenCalledTimes(1);
    expect(mockStateManager.persona_add).toHaveBeenCalledWith(
      "sisyphus",
      expect.anything()
    );
  });

  it("handles empty agent list", async () => {
    const result = await ensureAllAgentPersonas([], {
      stateManager: mockStateManager as StateManager,
      interface: mockInterface as Ei_Interface,
      reader: mockReader as OpenCodeReader,
    });

    expect(result.size).toBe(0);
    expect(mockStateManager.persona_add).not.toHaveBeenCalled();
  });
});
