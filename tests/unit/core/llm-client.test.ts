import { describe, it, expect } from "vitest";
import { cleanResponseContent, parseJSONResponse, repairJSON } from "../../../src/core/llm-client.js";

describe("cleanResponseContent", () => {
  describe("paired tags", () => {
    it("strips <think>...</think>", () => {
      const input = `<think>I should reason about this carefully.</think>\n{"key": "value"}`;
      expect(cleanResponseContent(input)).toBe(`{"key": "value"}`);
    });

    it("strips <thinking>...</thinking>", () => {
      const input = `<thinking>Let me consider the options.</thinking>\n{"key": "value"}`;
      expect(cleanResponseContent(input)).toBe(`{"key": "value"}`);
    });

    it("is case-insensitive", () => {
      expect(cleanResponseContent(`<THINK>reasoning</THINK>\nresult`)).toBe("result");
      expect(cleanResponseContent(`<Thinking>reasoning</Thinking>\nresult`)).toBe("result");
    });

    it("handles space-padded tags", () => {
      expect(cleanResponseContent(`< think >reasoning</ think >\nresult`)).toBe("result");
      expect(cleanResponseContent(`< thinking >reasoning</ thinking >\nresult`)).toBe("result");
    });

    it("strips multiple thinking blocks", () => {
      const input = `<think>first</think>\nmiddle\n<think>second</think>\nfinal`;
      // Surrounding newlines remain — double newline between sections is correct
      expect(cleanResponseContent(input)).toBe("middle\n\nfinal");
    });

    it("strips multiline thinking blocks", () => {
      const input = `<think>\nLine one of thinking.\nLine two of thinking.\n</think>\nActual response.`;
      expect(cleanResponseContent(input)).toBe("Actual response.");
    });

    it("returns content unchanged when no tags present", () => {
      expect(cleanResponseContent(`{"key": "value"}`)).toBe(`{"key": "value"}`);
      expect(cleanResponseContent("Plain text response")).toBe("Plain text response");
    });
  });

  describe("orphaned closing tags (streaming / MiniMax M2.5 style)", () => {
    it("strips content before orphaned </think>", () => {
      const input = `I was thinking about this problem...\n</think>\n{"answer": 42}`;
      expect(cleanResponseContent(input)).toBe(`{"answer": 42}`);
    });

    it("strips content before orphaned </thinking>", () => {
      const input = `Some reasoning here\n</thinking>\nFinal response`;
      expect(cleanResponseContent(input)).toBe("Final response");
    });

    it("handles streaming accumulation: content before first orphaned closing tag", () => {
      // Simulates chunks accumulated without an opening tag
      const input = `Chunk 1 thinking...\nChunk 2 thinking...\n</think>\n\nHere's my answer`;
      expect(cleanResponseContent(input)).toBe("Here's my answer");
    });

    it("strips remaining orphaned closing tags", () => {
      const input = `thinking 1\n</think>\nresponse part 1\n</think>\nresponse part 2`;
      // First orphaned </think> strips "thinking 1\n", then subsequent </think> tags are removed
      // Double newline between sections is expected (newline on each side of removed tag)
      expect(cleanResponseContent(input)).toBe("response part 1\n\nresponse part 2");
    });
  });

  describe("orphaned opening tags", () => {
    it("strips orphaned <think> with no closing tag", () => {
      const input = "Normal response\n<think>";
      expect(cleanResponseContent(input)).toBe("Normal response");
    });

    it("strips orphaned <thinking> with no closing tag", () => {
      const input = "Normal response\n<thinking>";
      expect(cleanResponseContent(input)).toBe("Normal response");
    });
  });

  describe("edge cases", () => {
    it("handles empty string", () => {
      expect(cleanResponseContent("")).toBe("");
    });

    it("trims surrounding whitespace", () => {
      expect(cleanResponseContent(`  <think>stuff</think>  result  `)).toBe("result");
    });

    it("handles response that is entirely thinking with no real content", () => {
      expect(cleanResponseContent(`<think>Only thinking, no response</think>`)).toBe("");
    });

    it("does not strip think-like text inside JSON values", () => {
      const input = `{"message": "no think tags here", "value": 42}`;
      expect(cleanResponseContent(input)).toBe(`{"message": "no think tags here", "value": 42}`);
    });
  });

  describe("Seed-OSS (ByteDance) namespaced tags", () => {
    it("strips <seed:think>...</seed:think>", () => {
      const input = `<seed:think>\nLet me reason about this.\n</seed:think>\n{"answer": 42}`;
      expect(cleanResponseContent(input)).toBe(`{"answer": 42}`);
    });

    it("strips budget reflection tokens within thinking block", () => {
      const input = `<seed:think>\nThinking...\n<seed:cot_budget_reflect>129 tokens used, 383 remaining.</seed:cot_budget_reflect>\nMore thinking.\n</seed:think>\nFinal answer.`;
      expect(cleanResponseContent(input)).toBe("Final answer.");
    });

    it("strips orphaned budget reflection token outside thinking block", () => {
      const input = `Some response.\n<seed:cot_budget_reflect>64 tokens used.</seed:cot_budget_reflect>\nMore response.`;
      expect(cleanResponseContent(input)).toBe("Some response.\n\nMore response.");
    });
  });
});

describe("parseJSONResponse", () => {
  it("parses plain JSON", () => {
    expect(parseJSONResponse(`{"key": "value"}`)).toEqual({ key: "value" });
  });

  it("parses JSON wrapped in markdown code block", () => {
    const input = "```json\n{\"key\": \"value\"}\n```";
    expect(parseJSONResponse(input)).toEqual({ key: "value" });
  });

  it("parses JSON wrapped in plain code block", () => {
    const input = "```\n{\"key\": \"value\"}\n```";
    expect(parseJSONResponse(input)).toEqual({ key: "value" });
  });

  it("parses JSON after think tags are pre-stripped", () => {
    // cleanResponseContent should be called before parseJSONResponse in practice;
    // verify the two work correctly in sequence
    const cleaned = cleanResponseContent(`<think>reasoning</think>\n{"answer": true}`);
    expect(parseJSONResponse(cleaned)).toEqual({ answer: true });
  });

  it("throws on truly invalid JSON", () => {
    expect(() => parseJSONResponse("not json at all!!!")).toThrow();
  });
});

describe("repairJSON", () => {
  it("removes trailing commas", () => {
    const result = repairJSON(`{"key": "value",}`);
    expect(JSON.parse(result)).toEqual({ key: "value" });
  });

  it("removes JS-style comments", () => {
    const result = repairJSON("{\"key\": \"value\" // comment\n}");
    expect(JSON.parse(result)).toEqual({ key: "value" });
  });
});
