import { test, expect, describe } from "bun:test";
import { buildCYPEditorYAML, parseCYPEditorYAML } from "../../../src/util/cyp-editor";
import type { RoomMessage, PersonaSummary } from "../../../../src/core/types";
import { ContextStatus } from "../../../../src/core/types";

function makeMsg(overrides: Partial<RoomMessage> & { id: string; parent_id: string | null }): RoomMessage {
  return {
    role: "human",
    timestamp: "2024-01-01T00:00:00.000Z",
    read: false,
    context_status: ContextStatus.Default,
    ...overrides,
  };
}

function makePersona(id: string, display_name: string): PersonaSummary {
  return {
    id,
    display_name,
    aliases: [],
    is_paused: false,
    is_archived: false,
    unread_count: 0,
  };
}

describe("buildCYPEditorYAML", () => {
  describe("header", () => {
    test("output starts with the CYP header comment", () => {
      const yaml = buildCYPEditorYAML("root", [], []);
      expect(yaml).toContain("# Choose Your Path");
      expect(yaml).toContain("# Mark exactly ONE response with _chosen: true");
    });
  });

  describe("child filtering", () => {
    test("includes only messages whose parent_id === activeNodeId", () => {
      const msgs = [
        makeMsg({ id: "root",       parent_id: null }),
        makeMsg({ id: "child1",     parent_id: "root" }),
        makeMsg({ id: "child2",     parent_id: "root" }),
        makeMsg({ id: "grandchild", parent_id: "child1" }),
        makeMsg({ id: "unrelated",  parent_id: "other-node" }),
      ];
      const yaml = buildCYPEditorYAML("root", msgs, []);
      expect(yaml).toContain(`id: "child1"`);
      expect(yaml).toContain(`id: "child2"`);
      expect(yaml).not.toContain(`id: "root"`);
      expect(yaml).not.toContain(`id: "grandchild"`);
      expect(yaml).not.toContain(`id: "unrelated"`);
    });

    test("returns only the header when there are no children", () => {
      const yaml = buildCYPEditorYAML("root", [], []);
      expect(yaml).toContain("# Choose Your Path");
      expect(yaml).not.toContain("- id:");
    });
  });

  describe("speaker resolution", () => {
    test("human role → speaker 'You'", () => {
      const msgs = [makeMsg({ id: "m1", parent_id: "root", role: "human" })];
      const yaml = buildCYPEditorYAML("root", msgs, []);
      expect(yaml).toContain(`speaker: "You"`);
    });

    test("persona role → speaker display_name from personas list", () => {
      const msgs = [
        makeMsg({ id: "m1", parent_id: "root", role: "persona", persona_id: "p1" }),
      ];
      const personas = [makePersona("p1", "Aria")];
      const yaml = buildCYPEditorYAML("root", msgs, personas);
      expect(yaml).toContain(`speaker: "Aria"`);
      expect(yaml).not.toContain(`speaker: "You"`);
    });

    test("persona role with unknown persona_id falls back to persona_id string", () => {
      const msgs = [
        makeMsg({ id: "m1", parent_id: "root", role: "persona", persona_id: "mystery-bot" }),
      ];
      const yaml = buildCYPEditorYAML("root", msgs, []);
      expect(yaml).toContain(`speaker: "mystery-bot"`);
    });

    test("persona role without persona_id falls back to 'You' (persona_id guard is falsy)", () => {
      const msgs = [
        makeMsg({ id: "m1", parent_id: "root", role: "persona" }),
      ];
      const yaml = buildCYPEditorYAML("root", msgs, []);
      expect(yaml).toContain(`speaker: "You"`);
    });
  });

  describe("content formatting", () => {
    test("content appears as block scalar with 4-space-indented content", () => {
      const msgs = [
        makeMsg({ id: "m1", parent_id: "root", content: "Hello there" }),
      ];
      const yaml = buildCYPEditorYAML("root", msgs, []);
      expect(yaml).toContain("content: |");
      expect(yaml).toContain("    Hello there");
    });

    test("multi-line content: each line indented 4 spaces", () => {
      const msgs = [
        makeMsg({ id: "m1", parent_id: "root", content: "Line one\nLine two" }),
      ];
      const yaml = buildCYPEditorYAML("root", msgs, []);
      expect(yaml).toContain("    Line one");
      expect(yaml).toContain("    Line two");
    });

    test("action inline in content with underscore wrapping appears as block scalar", () => {
      const msgs = [
        makeMsg({ id: "m1", parent_id: "root", content: "_*nods quietly*_" }),
      ];
      const yaml = buildCYPEditorYAML("root", msgs, []);
      expect(yaml).toContain("content: |");
      expect(yaml).toContain("    _*nods quietly*_");
    });

    test("content with inline action: single field, renders correctly", () => {
      const msgs = [
        makeMsg({
          id: "m1",
          parent_id: "root",
          content: "I speak\n\n_*also does something*_",
        }),
      ];
      const yaml = buildCYPEditorYAML("root", msgs, []);
      expect(yaml).toContain("content: |");
      expect(yaml).toContain("    I speak");
      expect(yaml).toContain("    _*also does something*_");
    });

    test("silence_reason shown as inline string when content is absent", () => {
      const msgs = [
        makeMsg({ id: "m1", parent_id: "root", silence_reason: "deep in thought" }),
      ];
      const yaml = buildCYPEditorYAML("root", msgs, []);
      expect(yaml).toContain(`silence_reason: "deep in thought"`);
      expect(yaml).not.toContain("content:");
    });

    test("silence_reason suppressed when content is present", () => {
      const msgs = [
        makeMsg({
          id: "m1",
          parent_id: "root",
          content: "I do speak",
          silence_reason: "should be hidden",
        }),
      ];
      const yaml = buildCYPEditorYAML("root", msgs, []);
      expect(yaml).toContain("content: |");
      expect(yaml).not.toContain("silence_reason:");
    });

    test("message with none of verbal/action/silence_reason shows '# (no content)' comment", () => {
      const msgs = [makeMsg({ id: "m1", parent_id: "root" })];
      const yaml = buildCYPEditorYAML("root", msgs, []);
      expect(yaml).toContain("# (no content)");
      expect(yaml).not.toContain("content:");
      expect(yaml).not.toContain("silence_reason:");
    });
  });

  describe("explored flag", () => {
    test("explored: true when message has at least one child in messages list", () => {
      const msgs = [
        makeMsg({ id: "child1",     parent_id: "root" }),
        makeMsg({ id: "grandchild", parent_id: "child1" }),
      ];
      const yaml = buildCYPEditorYAML("root", msgs, []);
      const child1Block = yaml.split("- id:").find((b) => b.includes(`"child1"`));
      expect(child1Block).toBeDefined();
      expect(child1Block).toContain("explored: true");
    });

    test("explored: false when message has no children in messages list", () => {
      const msgs = [makeMsg({ id: "child1", parent_id: "root" })];
      const yaml = buildCYPEditorYAML("root", msgs, []);
      expect(yaml).toContain("explored: false");
    });

    test("explored correctly differentiates explored vs unexplored siblings", () => {
      const msgs = [
        makeMsg({ id: "child1",          parent_id: "root" }),
        makeMsg({ id: "child2",          parent_id: "root" }),
        makeMsg({ id: "grandchild-of-1", parent_id: "child1" }),
      ];
      const yaml = buildCYPEditorYAML("root", msgs, []);
      const blocks = yaml.split("- id:").filter((b) => b.trim());
      const block1 = blocks.find((b) => b.includes(`"child1"`));
      const block2 = blocks.find((b) => b.includes(`"child2"`));
      expect(block1).toContain("explored: true");
      expect(block2).toContain("explored: false");
    });
  });

  describe("_chosen field", () => {
    test("all blocks start with _chosen: false", () => {
      const msgs = [
        makeMsg({ id: "m1", parent_id: "root" }),
        makeMsg({ id: "m2", parent_id: "root" }),
        makeMsg({ id: "m3", parent_id: "root" }),
      ];
      const yaml = buildCYPEditorYAML("root", msgs, []);
      const chosenTrueCount  = (yaml.match(/  _chosen: true/g) || []).length;
      const chosenFalseCount = (yaml.match(/  _chosen: false/g) || []).length;
      expect(chosenTrueCount).toBe(0);
      expect(chosenFalseCount).toBe(3);
    });
  });
});

describe("parseCYPEditorYAML", () => {
  test("empty string returns empty array", () => {
    expect(parseCYPEditorYAML("")).toEqual([]);
  });

  test("comment-only content returns empty array", () => {
    const yaml = "# just a comment\n# another comment\n";
    expect(parseCYPEditorYAML(yaml)).toEqual([]);
  });

  test("single block with _chosen: false", () => {
    const yaml = `- id: "msg-1"\n  _chosen: false\n`;
    const blocks = parseCYPEditorYAML(yaml);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].id).toBe("msg-1");
    expect(blocks[0].chosen).toBe(false);
  });

  test("single block with _chosen: true", () => {
    const yaml = `- id: "msg-1"\n  _chosen: true\n`;
    const blocks = parseCYPEditorYAML(yaml);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].id).toBe("msg-1");
    expect(blocks[0].chosen).toBe(true);
  });

  test("multiple blocks, none chosen → all chosen: false", () => {
    const yaml = `- id: "a"\n  _chosen: false\n\n- id: "b"\n  _chosen: false\n`;
    const blocks = parseCYPEditorYAML(yaml);
    expect(blocks).toHaveLength(2);
    expect(blocks.every((b) => !b.chosen)).toBe(true);
  });

  test("multiple blocks, exactly one chosen", () => {
    const yaml = `- id: "a"\n  _chosen: false\n\n- id: "b"\n  _chosen: true\n`;
    const blocks = parseCYPEditorYAML(yaml);
    expect(blocks).toHaveLength(2);
    const chosen = blocks.filter((b) => b.chosen);
    expect(chosen).toHaveLength(1);
    expect(chosen[0].id).toBe("b");
  });

  test("multiple blocks with multiple _chosen: true → returns all of them", () => {
    const yaml = `- id: "a"\n  _chosen: true\n\n- id: "b"\n  _chosen: true\n`;
    const blocks = parseCYPEditorYAML(yaml);
    expect(blocks).toHaveLength(2);
    expect(blocks.filter((b) => b.chosen)).toHaveLength(2);
  });

  test("id quotes are stripped", () => {
    const yaml = `- id: "quoted-id"\n  _chosen: false\n`;
    const blocks = parseCYPEditorYAML(yaml);
    expect(blocks[0].id).toBe("quoted-id");
  });

  test("id without quotes is parsed correctly", () => {
    const yaml = `- id: bare-id\n  _chosen: false\n`;
    const blocks = parseCYPEditorYAML(yaml);
    expect(blocks[0].id).toBe("bare-id");
  });

  test("speaker and explored lines are ignored (only id and _chosen matter)", () => {
    const yaml = [
      `- id: "msg-x"`,
      `  speaker: "Aria"`,
      `  explored: true`,
      `  _chosen: true`,
    ].join("\n");
    const blocks = parseCYPEditorYAML(yaml);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].id).toBe("msg-x");
    expect(blocks[0].chosen).toBe(true);
  });

  test("4-space-indented content lines (block scalar body) do not corrupt chosen state", () => {
    const yaml = [
      `- id: "msg-y"`,
      `  content: |`,
      `    some response text`,
      `    more text`,
      `  _chosen: false`,
    ].join("\n");
    const blocks = parseCYPEditorYAML(yaml);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].id).toBe("msg-y");
    expect(blocks[0].chosen).toBe(false);
  });

  test("header comment block is skipped, id blocks are still parsed", () => {
    const yaml = [
      `# Choose Your Path`,
      `# Mark exactly ONE response with _chosen: true`,
      ``,
      `- id: "m1"`,
      `  _chosen: false`,
    ].join("\n");
    const blocks = parseCYPEditorYAML(yaml);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].id).toBe("m1");
    expect(blocks[0].chosen).toBe(false);
  });
});

describe("round-trip: build → (user marks chosen) → parse", () => {
  test("basic round-trip: mark one child chosen → parser returns its ID", () => {
    const msgs = [
      makeMsg({ id: "opt-a", parent_id: "root", content: "Option A" }),
      makeMsg({ id: "opt-b", parent_id: "root", content: "Option B" }),
    ];
    const yaml = buildCYPEditorYAML("root", msgs, []);
    const edited = yaml.replace(
      /- id: "opt-a"([\s\S]*?)_chosen: false/,
      `- id: "opt-a"$1_chosen: true`,
    );

    const blocks = parseCYPEditorYAML(edited);
    const chosen = blocks.filter((b) => b.chosen);
    expect(chosen).toHaveLength(1);
    expect(chosen[0].id).toBe("opt-a");
  });

  test("round-trip with inline action in content: renders and parses correctly", () => {
    const msgs = [
      makeMsg({
        id: "combo",
        parent_id: "root",
        content: "I speak words\n\n_*does a thing*_",
      }),
    ];
    const yaml = buildCYPEditorYAML("root", msgs, []);
    expect(yaml).toContain("content: |");
    expect(yaml).toContain("    I speak words");
    expect(yaml).toContain("    _*does a thing*_");

    const blocks = parseCYPEditorYAML(yaml);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].id).toBe("combo");
    expect(blocks[0].chosen).toBe(false);
  });

  test("silence-only message: silence_reason in YAML, parseable", () => {
    const msgs = [
      makeMsg({ id: "silent-bob", parent_id: "root", silence_reason: "too cool to talk" }),
    ];
    const yaml = buildCYPEditorYAML("root", msgs, []);
    expect(yaml).toContain(`silence_reason: "too cool to talk"`);
    expect(yaml).not.toContain("verbal_response:");

    const blocks = parseCYPEditorYAML(yaml);
    expect(blocks[0].id).toBe("silent-bob");
  });

  test("no-content message: shows comment, parseable", () => {
    const msgs = [makeMsg({ id: "empty", parent_id: "root" })];
    const yaml = buildCYPEditorYAML("root", msgs, []);
    expect(yaml).toContain("# (no content)");

    const blocks = parseCYPEditorYAML(yaml);
    expect(blocks[0].id).toBe("empty");
  });

  test("explored: true accurately reflects prior branching from a node", () => {
    const msgs = [
      makeMsg({ id: "branched",   parent_id: "root" }),
      makeMsg({ id: "fresh",      parent_id: "root" }),
      makeMsg({ id: "descended",  parent_id: "branched" }),
    ];
    const yaml = buildCYPEditorYAML("root", msgs, []);
    const allBlocks = yaml.split("- id:").filter((b) => b.trim());
    const branchedBlock = allBlocks.find((b) => b.includes(`"branched"`));
    const freshBlock    = allBlocks.find((b) => b.includes(`"fresh"`));

    expect(branchedBlock).toContain("explored: true");
    expect(freshBlock).toContain("explored: false");
  });

  test("three children: marking second one chosen works correctly", () => {
    const msgs = [
      makeMsg({ id: "a", parent_id: "root", content: "A speaks" }),
      makeMsg({ id: "b", parent_id: "root", content: "B speaks" }),
      makeMsg({ id: "c", parent_id: "root", content: "C speaks" }),
    ];
    const yaml = buildCYPEditorYAML("root", msgs, []);
    const edited = yaml.replace(
      /- id: "b"([\s\S]*?)_chosen: false/,
      `- id: "b"$1_chosen: true`,
    );

    const blocks = parseCYPEditorYAML(edited);
    expect(blocks).toHaveLength(3);
    const chosen = blocks.filter((b) => b.chosen);
    expect(chosen).toHaveLength(1);
    expect(chosen[0].id).toBe("b");
  });

  test("persona display name resolved correctly in full round-trip", () => {
    const msgs = [
      makeMsg({ id: "response", parent_id: "root", role: "persona", persona_id: "p42", content: "greetings" }),
    ];
    const personas = [makePersona("p42", "Oracle")];
    const yaml = buildCYPEditorYAML("root", msgs, personas);
    expect(yaml).toContain(`speaker: "Oracle"`);

    const blocks = parseCYPEditorYAML(yaml);
    expect(blocks[0].id).toBe("response");
  });
});
