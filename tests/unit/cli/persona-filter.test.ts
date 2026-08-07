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

function makeState(
  human: Partial<StorageState["human"]> = {},
  personas: StorageState["personas"] = {}
): StorageState {
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
    personas,
    queue: [],
    providers: [],
    tools: [],
  } as unknown as StorageState;
}

function makePersonaRecord(
  id: string,
  groupPrimary: string | null,
  groupsVisible: string[] = []
): StorageState["personas"][string] {
  return {
    entity: {
      id,
      display_name: id,
      entity: "system",
      group_primary: groupPrimary,
      groups_visible: groupsVisible,
      traits: [],
      topics: [],
      is_paused: false,
      is_archived: false,
      is_static: false,
      last_updated: NOW,
    },
    messages: [],
  } as unknown as StorageState["personas"][string];
}

// ── filterTypeSpecificByPersona — quotes now filter by group-visibility ──
//
// "quotes" used to be an explicit early-return [] (total exclusion). Per
// Flare's ruling, persona-scoped search must FILTER quotes the same way
// prompt-context-builder.ts's filterHumanDataByVisibility does: intersect the
// quote's effective persona_groups (empty defaults to "General") against the
// target persona's visible groups (group_primary + groups_visible). A persona
// with no visibility into a quote's group correctly gets zero results —
// that's filtering, not exclusion. "personas" still has no matching branch at
// all, so `collection` stays null and the fall-through hands back the input
// unfiltered.

describe("filterTypeSpecificByPersona — quotes group-visibility / personas fall-through", () => {
  it("returns only quotes whose persona_groups intersect the persona's visible groups", () => {
    const state = makeState(
      {
        quotes: [
          { id: "quote_1", persona_groups: ["Music"] },
          { id: "quote_2", persona_groups: ["Cooking"] },
          { id: "quote_3", persona_groups: [] }, // defaults to "General"
        ],
      } as unknown as Partial<StorageState["human"]>,
      { [PERSONA_ID]: makePersonaRecord(PERSONA_ID, "Music", ["General"]) }
    );
    const results = [{ id: "quote_1" }, { id: "quote_2" }, { id: "quote_3" }];
    const filtered = filterTypeSpecificByPersona(results, state, PERSONA_ID, "quotes");
    expect(filtered).toEqual([{ id: "quote_1" }, { id: "quote_3" }]);
  });

  it("returns [] (a filter finding nothing, not an exclusion bug) when no quote's group is visible to the persona", () => {
    const state = makeState(
      {
        quotes: [
          { id: "quote_1", persona_groups: ["Music"] },
          { id: "quote_2", persona_groups: ["Cooking"] },
        ],
      } as unknown as Partial<StorageState["human"]>,
      { [PERSONA_ID]: makePersonaRecord(PERSONA_ID, "Woodworking", []) }
    );
    const results = [{ id: "quote_1" }, { id: "quote_2" }];
    expect(filterTypeSpecificByPersona(results, state, PERSONA_ID, "quotes")).toEqual([]);
  });

  it("returns [] when the persona id can't be resolved from state at all", () => {
    const state = makeState({
      quotes: [{ id: "quote_1", persona_groups: [] }],
    } as unknown as Partial<StorageState["human"]>);
    const results = [{ id: "quote_1" }];
    expect(filterTypeSpecificByPersona(results, state, "unknown-persona", "quotes")).toEqual([]);
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

// ── filterTypeSpecificBySource — quotes/personas fall-through ──
//
// Source filtering has no group-visibility semantic; only the persona-scoped
// path above changed. Quotes stay excluded here.

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

// ── filterByPersona — balanced-search quote group-visibility ──
//
// The balanced-search variant used to hard-code
// `if (result.type === "quote") return false` — total exclusion. It now
// resolves the original quote from state and applies the same
// group-visibility predicate as filterTypeSpecificByPersona above.

describe("filterByPersona — balanced search quote group-visibility", () => {
  it("keeps a quote result whose persona_groups intersect the persona's visible groups", () => {
    const state = makeState(
      { quotes: [{ id: "quote_1", persona_groups: ["Music"] }] } as unknown as Partial<StorageState["human"]>,
      { [PERSONA_ID]: makePersonaRecord(PERSONA_ID, "Music", []) }
    );
    const results = [
      { type: "quote", id: "quote_1", text: "hello", speaker: "human", timestamp: NOW, message_id: null, linked_items: [] },
    ] as unknown as BalancedResult[];
    expect(filterByPersona(results, state, PERSONA_ID)).toEqual(results);
  });

  it("drops a quote result whose persona_groups don't intersect the persona's visible groups — empty result is correct, not a bug", () => {
    const state = makeState(
      { quotes: [{ id: "quote_1", persona_groups: ["Cooking"] }] } as unknown as Partial<StorageState["human"]>,
      { [PERSONA_ID]: makePersonaRecord(PERSONA_ID, "Music", []) }
    );
    const results = [
      { type: "quote", id: "quote_1", text: "hello", speaker: "human", timestamp: NOW, message_id: null, linked_items: [] },
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
