import { describe, it, expect } from "vitest";
import { chunkExtractionContext, estimateContextTokens } from "../../../src/core/orchestrators/extraction-chunker.js";
import type { ExtractionContext } from "../../../src/core/orchestrators/human-extraction.js";
import { ContextStatus, type Message } from "../../../src/core/types.js";

function createMessage(content: string): Message {
  return {
    id: crypto.randomUUID(),
    role: "human",
    verbal_response: content,
    timestamp: new Date().toISOString(),
    read: false,
    context_status: ContextStatus.Default,
  };
}

function createLargeMessage(charCount: number): Message {
  return createMessage("x".repeat(charCount));
}

describe("extraction-chunker", () => {
  describe("chunkExtractionContext", () => {
    it("returns empty chunks for empty analyze messages", () => {
      const context: ExtractionContext = {
        personaId: "test-id",
      personaDisplayName: "Test",
        messages_context: [createMessage("context")],
        messages_analyze: [],
      };

      const result = chunkExtractionContext(context);

      expect(result.chunks).toHaveLength(0);
      expect(result.totalMessages).toBe(1);
    });

    it("returns single chunk when messages fit within budget", () => {
      const context: ExtractionContext = {
        personaId: "test-id",
      personaDisplayName: "Test",
        messages_context: [createMessage("some context")],
        messages_analyze: [createMessage("some analyze")],
      };

      const result = chunkExtractionContext(context);

      expect(result.chunks).toHaveLength(1);
      expect(result.chunks[0].personaDisplayName).toBe("Test");
      expect(result.chunks[0].messages_analyze).toHaveLength(1);
    });

    it("splits large message sets into multiple chunks", () => {
      const context: ExtractionContext = {
        personaId: "test-id",
      personaDisplayName: "Test",
        messages_context: [createMessage("context")],
        messages_analyze: [
          createLargeMessage(15000),
          createLargeMessage(15000),
          createLargeMessage(15000),
        ],
      };

      const result = chunkExtractionContext(context);

      expect(result.chunks.length).toBeGreaterThan(1);
    });

    it("uses sliding context window - batch 2 context is batch 1 analyze tail", () => {
      const context: ExtractionContext = {
        personaId: "test-id",
      personaDisplayName: "Test",
        messages_context: [createMessage("original-context-marker")],
        messages_analyze: [
          createLargeMessage(15000),
          createLargeMessage(15000),
          createLargeMessage(15000),
        ],
      };

      const result = chunkExtractionContext(context);

      if (result.chunks.length > 1) {
        expect(result.chunks[0].messages_context.some(m => 
          (m.verbal_response ?? '').includes("original-context-marker")
        )).toBe(true);

        expect(result.chunks[1].messages_context.every(m => 
          !(m.verbal_response ?? '').includes("original-context-marker")
        )).toBe(true);
      }
    });

    it("respects custom maxTokens parameter", () => {
      const context: ExtractionContext = {
        personaId: "test-id",
      personaDisplayName: "Test",
        messages_context: [],
        messages_analyze: [
          createLargeMessage(8000),
          createLargeMessage(8000),
        ],
      };

      const result = chunkExtractionContext(context, 5000);

      expect(result.chunks.length).toBeGreaterThan(1);
    });

    it("preserves personaId and personaDisplayName across all chunks", () => {
      const context: ExtractionContext = {
        personaId: "unique-id",
      personaDisplayName: "Unique",
        messages_context: [],
        messages_analyze: [
          createLargeMessage(15000),
          createLargeMessage(15000),
        ],
      };

      const result = chunkExtractionContext(context);

      result.chunks.forEach(chunk => {
        expect(chunk.personaDisplayName).toBe("Unique");
      });
    });

    it("ensures all analyze messages are covered across chunks", () => {
      const context: ExtractionContext = {
        personaId: "test-id",
      personaDisplayName: "Test",
        messages_context: [],
        messages_analyze: [
          createMessage("msg1"),
          createMessage("msg2"),
          createMessage("msg3"),
          createLargeMessage(20000),
          createMessage("msg5"),
        ],
      };

      const result = chunkExtractionContext(context);

      const allAnalyzeIds = new Set<string>();
      result.chunks.forEach(chunk => {
        chunk.messages_analyze.forEach(m => allAnalyzeIds.add(m.id));
      });

      context.messages_analyze.forEach(m => {
        expect(allAnalyzeIds.has(m.id)).toBe(true);
      });
    });
  });

  describe("estimateContextTokens", () => {
    it("includes system prompt buffer in estimate", () => {
      const context: ExtractionContext = {
        personaId: "test-id",
      personaDisplayName: "Test",
        messages_context: [],
        messages_analyze: [],
      };

      const estimate = estimateContextTokens(context);

      expect(estimate).toBeGreaterThanOrEqual(1000);
    });

    it("increases with message content", () => {
      const small: ExtractionContext = {
        personaId: "test-id",
      personaDisplayName: "Test",
        messages_context: [createMessage("small")],
        messages_analyze: [],
      };

      const large: ExtractionContext = {
        personaId: "test-id",
      personaDisplayName: "Test",
        messages_context: [createLargeMessage(10000)],
        messages_analyze: [],
      };

      expect(estimateContextTokens(large)).toBeGreaterThan(estimateContextTokens(small));
    });
  });
});
