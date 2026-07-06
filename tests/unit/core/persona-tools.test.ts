import { describe, it, expect } from "vitest";
import { buildPersonaToolsMap, resolvePersonaToolsFromMap } from "../../../src/core/persona-tools.js";
import type { ToolDefinition, ToolProvider } from "../../../src/core/types.js";

function makeProvider(overrides: Partial<ToolProvider> = {}): ToolProvider {
  return {
    id: crypto.randomUUID(),
    name: "brave",
    display_name: "Brave Search",
    builtin: false,
    config: {},
    enabled: true,
    created_at: "2024-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function makeTool(overrides: Partial<ToolDefinition> = {}): ToolDefinition {
  return {
    id: crypto.randomUUID(),
    provider_id: "provider-id",
    name: "web_search",
    display_name: "Web Search",
    description: "Search the web",
    input_schema: {},
    runtime: "any",
    builtin: false,
    enabled: true,
    created_at: "2024-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("buildPersonaToolsMap", () => {
  it("returns undefined when there are no tools registered at all", () => {
    expect(buildPersonaToolsMap([], [], [])).toBeUndefined();
    expect(buildPersonaToolsMap(["some-id"], [], [makeProvider()])).toBeUndefined();
  });

  it("builds a nested provider -> tool -> boolean map, marking granted tools true", () => {
    const brave = makeProvider({ id: "p-brave", display_name: "Brave Search" });
    const search = makeTool({ id: "t-search", provider_id: "p-brave", display_name: "Web Search" });
    const news = makeTool({ id: "t-news", provider_id: "p-brave", display_name: "News Search" });

    const map = buildPersonaToolsMap(["t-search"], [search, news], [brave]);

    expect(map).toEqual({
      "Brave Search": {
        "Web Search": true,
        "News Search": false,
      },
    });
  });

  it("excludes providers that are disabled, even if their tools are in the enabled id list", () => {
    const brave = makeProvider({ id: "p-brave", display_name: "Brave Search", enabled: true });
    const github = makeProvider({ id: "p-github", display_name: "GitHub", enabled: false });
    const search = makeTool({ id: "t-search", provider_id: "p-brave", display_name: "Web Search" });
    const issues = makeTool({ id: "t-issues", provider_id: "p-github", display_name: "List Issues" });

    const map = buildPersonaToolsMap(["t-search", "t-issues"], [search, issues], [brave, github]);

    expect(map).toEqual({
      "Brave Search": { "Web Search": true },
    });
    expect(map).not.toHaveProperty("GitHub");
  });

  it("omits an enabled provider entirely when it owns no ToolDefinitions", () => {
    const brave = makeProvider({ id: "p-brave", display_name: "Brave Search" });
    const empty = makeProvider({ id: "p-empty", display_name: "Empty Provider" });
    const search = makeTool({ id: "t-search", provider_id: "p-brave", display_name: "Web Search" });

    const map = buildPersonaToolsMap([], [search], [brave, empty]);

    expect(map).toEqual({ "Brave Search": { "Web Search": false } });
  });

  it("returns undefined when every enabled provider ends up with zero visible tools", () => {
    const disabled = makeProvider({ id: "p-disabled", display_name: "Disabled Provider", enabled: false });
    const search = makeTool({ id: "t-search", provider_id: "p-disabled", display_name: "Web Search" });

    expect(buildPersonaToolsMap(["t-search"], [search], [disabled])).toBeUndefined();
  });
});

describe("resolvePersonaToolsFromMap", () => {
  it("returns undefined when the map itself is undefined", () => {
    expect(resolvePersonaToolsFromMap(undefined, [], [])).toBeUndefined();
  });

  it("resolves display-name pairs marked true back to their ToolDefinition ids", () => {
    const brave = makeProvider({ id: "p-brave", display_name: "Brave Search" });
    const search = makeTool({ id: "t-search", provider_id: "p-brave", display_name: "Web Search" });
    const news = makeTool({ id: "t-news", provider_id: "p-brave", display_name: "News Search" });

    const ids = resolvePersonaToolsFromMap(
      { "Brave Search": { "Web Search": true, "News Search": false } },
      [search, news],
      [brave]
    );

    expect(ids).toEqual(["t-search"]);
  });

  it("silently skips an unresolvable provider display name", () => {
    const brave = makeProvider({ id: "p-brave", display_name: "Brave Search" });
    const search = makeTool({ id: "t-search", provider_id: "p-brave", display_name: "Web Search" });

    const ids = resolvePersonaToolsFromMap(
      { "Nonexistent Provider": { "Some Tool": true } },
      [search],
      [brave]
    );

    expect(ids).toEqual([]);
  });

  it("silently skips an unresolvable tool display name under a known provider", () => {
    const brave = makeProvider({ id: "p-brave", display_name: "Brave Search" });
    const search = makeTool({ id: "t-search", provider_id: "p-brave", display_name: "Web Search" });

    const ids = resolvePersonaToolsFromMap(
      { "Brave Search": { "Nonexistent Tool": true, "Web Search": true } },
      [search],
      [brave]
    );

    expect(ids).toEqual(["t-search"]);
  });

  it("returns an empty array (not undefined) when the map is present but nothing resolves", () => {
    const brave = makeProvider({ id: "p-brave", display_name: "Brave Search" });
    const search = makeTool({ id: "t-search", provider_id: "p-brave", display_name: "Web Search" });

    const ids = resolvePersonaToolsFromMap({ "Brave Search": { "Web Search": false } }, [search], [brave]);

    expect(ids).toEqual([]);
  });
});
