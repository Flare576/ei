/**
 * Plan 1 (ADR-029 merge-patch), TODO 2 — direct unit tests on the derived
 * schema pair, independent of the CLI surface. Per the plan's own
 * Verification Strategy: "Schema-pair direct test... assert omitting a
 * formerly-defaulted field via the permissive parse does NOT produce the
 * default value; assert the derivation itself doesn't throw for
 * personSchema's .refine() wrapper." Evidence for
 * `.sisyphus/evidence/issues-wave-2/plan1-todo2-schema-pair.txt`.
 *
 * "Red first" per Flare's own framing (not TDD): "'Red first' is simply
 * 'something is broken right now — write a test that shows it is broken,
 * so that when it is fixed, we know that we fixed it, and if we break it
 * again, we have a signal we can trust.'" Before this plan, there was no
 * schema-pair mechanism at all — a naive `.partial()` on the existing
 * schemas (the literal instruction the recovered ADR-029 ticket gave)
 * reproduces GH-82 exactly for every defaulted field. These tests target
 * that exact failure mode directly against the derived artifacts.
 */
import { describe, it, expect } from "vitest";

// Bare-specifier mock (matches corrections-endpoints.test.ts's own shim) --
// without it, evaluating corrections-endpoints.ts's module-level zod schema
// literals throws "z.string is not a function" while this file's other
// imports are being collected.
import { vi } from "vitest";
vi.mock("zod", async (importOriginal) => {
  const actual = await importOriginal() as Record<string, unknown>;
  return {
    ...actual,
    z: (actual.z ?? actual.default ?? actual) as Record<string, unknown>,
  };
});

import { deriveSchemaPair } from "../../../src/core/entity-schemas.js";
import {
  topicPatchSchema,
  topicCandidateSchema,
  personPatchSchema,
  personCandidateSchema,
} from "../../../src/cli/corrections-endpoints.js";
import { personaPatchSchema, personaCandidateSchema } from "../../../src/cli/persona-corrections.js";
import { z } from "zod";

describe("deriveSchemaPair — generic mechanism", () => {
  it("strips a .default() on the patch form: an omitted defaulted field parses to undefined, never the default", () => {
    const { patchSchema } = deriveSchemaPair({
      required: z.string(),
      defaulted: z.number().default(42),
      optional: z.string().optional(),
    });

    const result = patchSchema.parse({});
    expect(result.defaulted).toBeUndefined();
    expect(result.required).toBeUndefined();
    expect(result.optional).toBeUndefined();
  });

  it("re-requires a .default() field on the candidate form, with the default itself stripped", () => {
    const { candidateSchema } = deriveSchemaPair({
      required: z.string(),
      defaulted: z.number().default(42),
      optional: z.string().optional(),
    });

    // The candidate form must reject a candidate missing the formerly-
    // defaulted field outright -- it must never silently supply 42.
    expect(() => candidateSchema.parse({ required: "x" })).toThrow();
    // But it accepts a candidate that actually supplies a concrete value.
    expect(candidateSchema.parse({ required: "x", defaulted: 7 })).toMatchObject({ required: "x", defaulted: 7 });
  });

  it("leaves an already-optional, never-defaulted field optional on both forms (e.g. topic's `category`)", () => {
    const { patchSchema, candidateSchema } = deriveSchemaPair({
      required: z.string(),
      optional: z.string().optional(),
    });

    expect(patchSchema.parse({}).optional).toBeUndefined();
    // The candidate form must NOT force this field mandatory -- this is
    // exactly what bare `.required()` gets wrong (rejects any existing
    // sparse entity); masked/selective required-ness must leave it alone.
    expect(() => candidateSchema.parse({ required: "x" })).not.toThrow();
  });

  it("accepts `null` for every field on the patch form, per RFC 7396 — even a normally-required one (candidate validation, not the patch schema, is what rejects an invalid removal)", () => {
    const { patchSchema } = deriveSchemaPair({
      required: z.string(),
      defaulted: z.number().default(42),
    });

    const result = patchSchema.parse({ required: null, defaulted: null });
    expect(result.required).toBeNull();
    expect(result.defaulted).toBeNull();
  });
});

describe("topic schema pair", () => {
  it("patch: an empty patch parses with every field undefined -- no default silently reappears", () => {
    const result = topicPatchSchema.parse({});
    expect(result.name).toBeUndefined();
    expect(result.description).toBeUndefined();
    expect(result.sentiment).toBeUndefined();
    expect(result.category).toBeUndefined();
  });

  it("candidate: a full valid record's projection validates", () => {
    expect(() =>
      topicCandidateSchema.parse({ name: "Project X", description: "d", sentiment: 0.5, category: "Project" })
    ).not.toThrow();
  });

  it("candidate: rejects a projection missing a required field (name cleared by a merge)", () => {
    expect(() => topicCandidateSchema.parse({ description: "d", sentiment: 0.5 })).toThrow();
  });
});

describe("person schema pair", () => {
  it("patch: an empty patch (omitting identifiers entirely) does not throw -- the refine wrapper never runs on the patch form", () => {
    expect(() => personPatchSchema.parse({})).not.toThrow();
    const result = personPatchSchema.parse({});
    expect(result.identifiers).toBeUndefined();
    expect(result.name).toBeUndefined();
    expect(result.relationship).toBeUndefined();
  });

  it("patch: a patch supplying only sentiment (no identifiers, no name) is legitimate and does not throw", () => {
    expect(() => personPatchSchema.parse({ description: "d", sentiment: 0.2 })).not.toThrow();
  });

  it("candidate: the derivation itself does not throw for personSchema's .refine() wrapper", () => {
    expect(() =>
      personCandidateSchema.parse({ description: "d", sentiment: 0, relationship: "friend", name: "Alice" })
    ).not.toThrow();
  });

  it("candidate: a full valid record with at least one identifier (no name) validates", () => {
    expect(() =>
      personCandidateSchema.parse({
        description: "d",
        sentiment: 0,
        relationship: "friend",
        identifiers: [{ type: "Nickname", value: "Al", is_primary: true }],
      })
    ).not.toThrow();
  });

  it("candidate: rejects a projection with neither identifiers nor a name (the refine predicate re-enforced through the masked-required derivation)", () => {
    expect(() =>
      personCandidateSchema.parse({ description: "d", sentiment: 0, relationship: "friend" })
    ).toThrow(/at least one identifier or a name/);
  });
});

describe("persona schema pair", () => {
  it("patch: an empty patch parses with every field undefined, including formerly-defaulted traits/topics/external_reflection_only", () => {
    const result = personaPatchSchema.parse({});
    expect(result.display_name).toBeUndefined();
    expect(result.traits).toBeUndefined();
    expect(result.topics).toBeUndefined();
    expect(result.external_reflection_only).toBeUndefined();
  });

  it("patch: accepts pending_update: null (Clearable) and rejects any other value for it", () => {
    expect(() => personaPatchSchema.parse({ pending_update: null })).not.toThrow();
    expect(() =>
      personaPatchSchema.parse({ pending_update: { critique: "forged" } })
    ).toThrow();
  });

  it("patch: rejects every ADR-031 Hidden/System-Visible field as unrecognized (they are simply absent from the shape)", () => {
    for (const field of [
      "tools", "model", "heartbeat_delay_ms", "context_window_ms",
      "include_message_timestamps", "context_boundary", "is_paused",
      "pause_until", "is_archived", "archived_at", "group_primary",
      "groups_visible",
    ]) {
      expect(() => personaPatchSchema.parse({ [field]: true })).toThrow(/Unrecognized key/);
    }
  });

  it("candidate: a full valid record's projection validates", () => {
    expect(() =>
      personaCandidateSchema.parse({
        display_name: "Nova",
        traits: [],
        topics: [],
        external_reflection_only: false,
      })
    ).not.toThrow();
  });

  it("candidate: rejects a projection missing display_name (cleared by a merge)", () => {
    expect(() => personaCandidateSchema.parse({ traits: [], topics: [], external_reflection_only: false })).toThrow();
  });
});
