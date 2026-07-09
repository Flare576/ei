import { describe, it, expect } from "vitest";
import type { StorageState } from "../../../src/core/types/integrations.js";
import {
  filterByPersona,
  filterBySource,
  filterTypeSpecificByPersona,
  filterTypeSpecificBySource,
} from "../../../src/cli/persona-filter.js";
import type { BalancedResult } from "../../../src/cli/retrieval.js";

const NOW = "2026-01-01T00:00:00Z";
const PERSONA_ID = "persona-1";
const SOURCE_PREFIX = "cursor";

function makeState(human: Partial<StorageState["human"]> = {}): StorageState {
  return {
    version: 1,
    timestamp: NOW,
    human: {
      entity: "human",
      facts: [],
      traits: [],
      people: [],
      topics: [],
      quotes: [],
      last_updated: NOW,
      ...human,
    },
    personas: {},
    queue: [],
    providers: [],
    tools: [],
  } as unknown as StorageState;
}

// ── filterTypeSpecificByPersona / filterTypeSpecificBySource — fall-through contract ──
//
// Both functions resolve a `targetType` string to a collection to filter against.
// "quotes" has an explicit early-return []; "personas" has no matching branch at
// all, so `collection` stays null and `if (!collection) return results` hands back
// the input completely unfiltered. This is surprising (silent no-op rather than an
// error or an actual persona-scoped filter) and the skill docs now describe it
// explicitly — these tests freeze the behavior so a future change to either branch
// is caught instead of silently drifting from the docs.

describe("filterTypeSpecificByPersona — quotes/personas fall-through", () => {
  it("returns [] for targetType 'quotes' regardless of input contents", () => {
    const state = makeState();
    const results = [{ id: "quote_1" }, { id: "quote_2" }];
    expect(filterTypeSpecificByPersona(results, state, PERSONA_ID, "quotes")).toEqual([]);
  });

  it("returns the input array unchanged for targetType 'personas', even though none carry the persona's id", () => {
    const state = makeState();
    const results = [
      { id: "persona_1", display_name: "Foo" },
      { id: "persona_2", display_name: "Bar" },
    ];
    const filtered = filterTypeSpecificByPersona(results, state, PERSONA_ID, "personas");
    expect(filtered).toEqual(results);
    expect(filtered).toHaveLength(2);
  });

  it("contrast: does filter 'facts' by interested_personas, unlike the personas fall-through", () => {
    const state = makeState({
      facts: [
        { id: "f1", interested_personas: [PERSONA_ID] },
        { id: "f2", interested_personas: ["some-other-persona"] },
      ],
    } as unknown as Partial<StorageState["human"]>);
    const results = [{ id: "f1" }, { id: "f2" }];
    const filtered = filterTypeSpecificByPersona(results, state, PERSONA_ID, "facts");
    expect(filtered).toEqual([{ id: "f1" }]);
  });
});

describe("filterTypeSpecificBySource — quotes/personas fall-through", () => {
  it("returns [] for targetType 'quotes' regardless of input contents", () => {
    const state = makeState();
    const results = [{ id: "quote_1" }, { id: "quote_2" }];
    expect(filterTypeSpecificBySource(results, state, SOURCE_PREFIX, "quotes")).toEqual([]);
  });

  it("returns the input array unchanged for targetType 'personas', even though none carry the source prefix", () => {
    const state = makeState();
    const results = [
      { id: "persona_1", display_name: "Foo" },
      { id: "persona_2", display_name: "Bar" },
    ];
    const filtered = filterTypeSpecificBySource(results, state, SOURCE_PREFIX, "personas");
    expect(filtered).toEqual(results);
    expect(filtered).toHaveLength(2);
  });

  it("contrast: does filter 'topics' by source prefix, unlike the personas fall-through", () => {
    const state = makeState({
      topics: [
        { id: "t1", sources: ["cursor:composer-1"] },
        { id: "t2", sources: ["codex:thread-1"] },
      ],
    } as unknown as Partial<StorageState["human"]>);
    const results = [{ id: "t1" }, { id: "t2" }];
    const filtered = filterTypeSpecificBySource(results, state, SOURCE_PREFIX, "topics");
    expect(filtered).toEqual([{ id: "t1" }]);
  });
});

// ── filterByPersona / filterBySource — balanced-search quote exclusion ──
//
// The balanced-search variants (used when no --type is given) hard-code
// `if (result.type === "quote") return false` — quotes are always dropped from
// --persona/--source-scoped balanced search, never matched against anything.

describe("filterByPersona — balanced search quote exclusion", () => {
  it("drops every quote result even when nothing else about the query would exclude it", () => {
    const state = makeState();
    const results = [
      { type: "quote", text: "hello", speaker: "human", timestamp: NOW, message_id: null, linked_items: [] },
    ] as unknown as BalancedResult[];
    expect(filterByPersona(results, state, PERSONA_ID)).toEqual([]);
  });
});

describe("filterBySource — balanced search quote exclusion", () => {
  it("drops every quote result even when nothing else about the query would exclude it", () => {
    const state = makeState();
    const results = [
      { type: "quote", text: "hello", speaker: "human", timestamp: NOW, message_id: null, linked_items: [] },
    ] as unknown as BalancedResult[];
    expect(filterBySource(results, state, SOURCE_PREFIX)).toEqual([]);
  });
});
