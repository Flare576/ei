import { describe, it, expect } from "vitest";
import { buildDedupPrompt, buildValidatePrompt } from "../../../../src/prompts/ceremony/dedup.js";
import { buildUserDedupPrompt } from "../../../../src/prompts/ceremony/user-dedup.js";
import { buildTopicRewriteScanPrompt, buildTopicRewriteSplitPrompt } from "../../../../src/prompts/ceremony/topic-rewrite.js";
import type { DataItemBase } from "../../../../src/core/types.js";

const EMBEDDING_SENTINEL = 987654321;

type Prompt = { system: string; user: string };
type TopicItem = DataItemBase & { category: string };

function makeItem(id: string, name: string): TopicItem {
  return {
    id,
    name,
    description: `DESCRIPTION_${id}`,
    sentiment: 0.42,
    last_updated: "2026-08-20T00:00:00.000Z",
    learned_on: "2026-08-01T00:00:00.000Z",
    learned_by: `LEARNED_BY_${id}`,
    last_changed_by: `CHANGED_BY_${id}`,
    interested_personas: [`INTERESTED_${id}`],
    sources: [`SOURCE_${id}`],
    category: `CATEGORY_${id}`,
    embedding: [EMBEDDING_SENTINEL],
  };
}

function expectRenderedContract(prompt: Prompt, sentinels: string[]): void {
  const rendered = `${prompt.system}\n${prompt.user}`;
  for (const sentinel of sentinels) {
    expect(rendered).toContain(sentinel);
  }
  expect(rendered).not.toContain(String(EMBEDDING_SENTINEL));
}

// S7: These literal snapshots deliberately freeze the full pre-substitution
// {system, user} output. The explicit sentinel checks make field loss and
// embedding leakage immediately legible even before inspecting the snapshot diff.
describe("ceremony prompt render parity", () => {
  it("freezes the Dedup cluster render while preserving every non-embedding field", () => {
    const first = makeItem("DEDUP_FIRST", "DEDUP_FIRST_NAME");
    const second = makeItem("DEDUP_SECOND", "DEDUP_SECOND_NAME");
    const prompt = buildDedupPrompt({
      cluster: [first, second],
      itemType: "topic",
      similarityRange: { min: 0.91, max: 0.97 },
    });

    expectRenderedContract(prompt, [
      first.id, first.name, first.description, first.learned_by!, first.last_changed_by!, first.interested_personas![0], first.sources![0], first.category,
      second.id, second.name, second.description, second.learned_by!, second.last_changed_by!, second.interested_personas![0], second.sources![0], second.category,
    ]);
    expect(prompt).toMatchSnapshot();
  });

  it("freezes the Validate established/newcomer render while preserving every non-embedding field", () => {
    const established = makeItem("ESTABLISHED", "ESTABLISHED_NAME");
    const newcomer = makeItem("NEWCOMER", "NEWCOMER_NAME");
    const prompt = buildValidatePrompt({
      established,
      newcomer,
      itemType: "topic",
      similarity: 0.93,
    });

    expectRenderedContract(prompt, [
      established.id, established.name, established.description, established.learned_by!, established.last_changed_by!, established.interested_personas![0], established.sources![0], established.category,
      newcomer.id, newcomer.name, newcomer.description, newcomer.learned_by!, newcomer.last_changed_by!, newcomer.interested_personas![0], newcomer.sources![0], newcomer.category,
    ]);
    expect(prompt).toMatchSnapshot();
  });

  it("freezes the user-confirmed Dedup cluster render while preserving every non-embedding field", () => {
    const first = makeItem("USER_DEDUP_FIRST", "USER_DEDUP_FIRST_NAME");
    const second = makeItem("USER_DEDUP_SECOND", "USER_DEDUP_SECOND_NAME");
    const prompt = buildUserDedupPrompt({
      cluster: [first, second],
      itemType: "topic",
      similarityRange: { min: 0.9, max: 0.99 },
    });

    expectRenderedContract(prompt, [
      first.id, first.name, first.description, first.learned_by!, first.last_changed_by!, first.interested_personas![0], first.sources![0], first.category,
      second.id, second.name, second.description, second.learned_by!, second.last_changed_by!, second.interested_personas![0], second.sources![0], second.category,
    ]);
    expect(prompt).toMatchSnapshot();
  });

  it("freezes the Topic Rewrite scan render while preserving every non-embedding field", () => {
    const original = makeItem("SCAN_ORIGINAL", "SCAN_ORIGINAL_NAME");
    const prompt = buildTopicRewriteScanPrompt({ item: original, itemType: "topic" });

    expectRenderedContract(prompt, [
      original.id, original.name, original.description, original.learned_by!, original.last_changed_by!, original.interested_personas![0], original.sources![0], original.category,
    ]);
    expect(prompt).toMatchSnapshot();
  });

  it("freezes the Topic Rewrite split render for original and nested match payloads", () => {
    const original = makeItem("SPLIT_ORIGINAL", "SPLIT_ORIGINAL_NAME");
    const nestedMatch = makeItem("SPLIT_NESTED", "SPLIT_NESTED_NAME");
    const prompt = buildTopicRewriteSplitPrompt({
      item: original,
      itemType: "topic",
      subjects: [{ searchTerm: "SPLIT_SEARCH_TERM", matches: [nestedMatch] }],
    });

    expectRenderedContract(prompt, [
      original.id, original.name, original.description, original.learned_by!, original.last_changed_by!, original.interested_personas![0], original.sources![0], original.category,
      "SPLIT_SEARCH_TERM",
      nestedMatch.id, nestedMatch.name, nestedMatch.description, nestedMatch.learned_by!, nestedMatch.last_changed_by!, nestedMatch.interested_personas![0], nestedMatch.sources![0], nestedMatch.category,
    ]);
    expect(prompt).toMatchSnapshot();
  });
});
