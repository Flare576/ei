import { describe, it, expect, beforeEach, vi } from "vitest";
import { StateManager } from "../../../src/core/state-manager.js";
import { makeThemeDefinition } from "../../../src/core/utils/theme-codec.js";

vi.mock("../../../src/core/embedding-service.js", () => ({
  getEmbeddingService: () => ({ embed: vi.fn().mockResolvedValue([]) }),
  getItemEmbeddingText: () => "",
  getTopicEmbeddingText: () => "",
  getPersonEmbeddingText: () => "",
}));

const TOKENS = Object.fromEntries(
  Array.from({ length: 37 }, (_, i) => [`--ei-token-${i}`, `#${String(i).padStart(6, "0")}`])
);

function makeTheme(name: string, base?: string) {
  return makeThemeDefinition(name, TOKENS, base);
}

async function makeStateManager(): Promise<StateManager> {
  const sm = new StateManager();
  const mockStorage = {
    load: vi.fn().mockResolvedValue(null),
    save: vi.fn().mockResolvedValue(undefined),
  };
  await sm.initialize(mockStorage as any);
  return sm;
}

describe("human_theme_getActive / human_theme_setActive", () => {
  it("returns undefined when no active theme is set", async () => {
    const sm = await makeStateManager();
    expect(sm.human_theme_getActive()).toBeUndefined();
  });

  it("persists the active theme id", async () => {
    const sm = await makeStateManager();
    sm.human_theme_setActive("spoopy");
    expect(sm.human_theme_getActive()).toBe("spoopy");
  });

  it("can clear the active theme", async () => {
    const sm = await makeStateManager();
    sm.human_theme_setActive("spoopy");
    sm.human_theme_setActive(undefined);
    expect(sm.human_theme_getActive()).toBeUndefined();
  });
});

describe("human_theme_getAll", () => {
  it("returns empty array when no custom themes exist", async () => {
    const sm = await makeStateManager();
    expect(sm.human_theme_getAll()).toEqual([]);
  });
});

describe("human_theme_upsert", () => {
  it("adds a new theme", async () => {
    const sm = await makeStateManager();
    const theme = makeTheme("My Theme");
    sm.human_theme_upsert(theme);
    expect(sm.human_theme_getAll()).toHaveLength(1);
    expect(sm.human_theme_getAll()[0].name).toBe("My Theme");
  });

  it("updates an existing theme by id", async () => {
    const sm = await makeStateManager();
    const theme = makeTheme("Original");
    sm.human_theme_upsert(theme);
    sm.human_theme_upsert({ ...theme, name: "Updated" });
    const all = sm.human_theme_getAll();
    expect(all).toHaveLength(1);
    expect(all[0].name).toBe("Updated");
  });

  it("appends multiple distinct themes", async () => {
    const sm = await makeStateManager();
    sm.human_theme_upsert(makeTheme("A"));
    sm.human_theme_upsert(makeTheme("B"));
    sm.human_theme_upsert(makeTheme("C"));
    expect(sm.human_theme_getAll()).toHaveLength(3);
  });
});

describe("human_theme_remove", () => {
  it("removes a theme by id and returns true", async () => {
    const sm = await makeStateManager();
    const theme = makeTheme("ToDelete");
    sm.human_theme_upsert(theme);
    const result = sm.human_theme_remove(theme.id);
    expect(result).toBe(true);
    expect(sm.human_theme_getAll()).toHaveLength(0);
  });

  it("returns false for a non-existent id", async () => {
    const sm = await makeStateManager();
    expect(sm.human_theme_remove("nonexistent-id")).toBe(false);
  });

  it("only removes the targeted theme", async () => {
    const sm = await makeStateManager();
    const a = makeTheme("A");
    const b = makeTheme("B");
    sm.human_theme_upsert(a);
    sm.human_theme_upsert(b);
    sm.human_theme_remove(a.id);
    const remaining = sm.human_theme_getAll();
    expect(remaining).toHaveLength(1);
    expect(remaining[0].id).toBe(b.id);
  });
});

describe("migrateThemes", () => {
  it("getAll returns [] even when custom_themes is undefined (fresh install)", async () => {
    const sm = await makeStateManager();
    expect(sm.human_theme_getAll()).toEqual([]);
  });

  it("does not overwrite existing custom_themes", async () => {
    const sm = await makeStateManager();
    const theme = makeTheme("Pre-existing");
    sm.human_theme_upsert(theme);
    const sm2 = new StateManager();
    const mockStorage = {
      load: vi.fn().mockResolvedValue({
        version: 1,
        timestamp: new Date().toISOString(),
        human: sm.getHuman(),
        personas: {},
        queue: [],
        providers: [],
        tools: [],
      }),
      save: vi.fn().mockResolvedValue(undefined),
    };
    await sm2.initialize(mockStorage as any);
    expect(sm2.human_theme_getAll()).toHaveLength(1);
    expect(sm2.human_theme_getAll()[0].name).toBe("Pre-existing");
  });
});
