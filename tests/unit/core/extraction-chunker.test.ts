import { describe, it, expect } from "vitest";
import { chunkExtractionContext, estimateContextTokens } from "../../../src/core/orchestrators/extraction-chunker.js";
import type { ExtractionContext } from "../../../src/core/orchestrators/human-extraction.js";
import { ContextStatus, type Message } from "../../../src/core/types.js";

function createMessage(text: string): Message {
  return {
    id: crypto.randomUUID(),
    role: "human",
    content: text,
    timestamp: new Date().toISOString(),
    read: false,
    context_status: ContextStatus.Default,
  };
}

function createLargeMessage(charCount: number): Message {
  return createMessage("x".repeat(charCount));
}

function createSilentMessage(silenceReasonLength: number): Message {
  return {
    id: crypto.randomUUID(),
    role: "human",
    content: "", // raw content is empty — a raw-content-only pricer sees ~0 tokens here
    timestamp: new Date().toISOString(),
    read: false,
    context_status: ContextStatus.Default,
    silence_reason: "x".repeat(silenceReasonLength),
  };
}

describe("extraction-chunker", () => {
  describe("chunkExtractionContext", () => {
    it("returns empty chunks for empty analyze messages", () => {
      const context: ExtractionContext = {
        personaId: "test-id",
      channelDisplayName: "Test",
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
      channelDisplayName: "Test",
        messages_context: [createMessage("some context")],
        messages_analyze: [createMessage("some analyze")],
      };

      const result = chunkExtractionContext(context);

      expect(result.chunks).toHaveLength(1);
      expect(result.chunks[0].channelDisplayName).toBe("Test");
      expect(result.chunks[0].messages_analyze).toHaveLength(1);
    });

    it("splits large message sets into multiple chunks", () => {
      const context: ExtractionContext = {
        personaId: "test-id",
      channelDisplayName: "Test",
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
      channelDisplayName: "Test",
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
          (m.content ?? '').includes("original-context-marker")
        )).toBe(true);

        expect(result.chunks[1].messages_context.every(m => 
          !(m.content ?? '').includes("original-context-marker")
        )).toBe(true);
      }
    });

    it("respects custom maxTokens parameter", () => {
      const context: ExtractionContext = {
        personaId: "test-id",
      channelDisplayName: "Test",
        messages_context: [],
        messages_analyze: [
          createLargeMessage(8000),
          createLargeMessage(8000),
        ],
      };

      const result = chunkExtractionContext(context, 5000);

      expect(result.chunks.length).toBeGreaterThan(1);
    });

    it("preserves personaId and channelDisplayName across all chunks", () => {
      const context: ExtractionContext = {
        personaId: "unique-id",
      channelDisplayName: "Unique",
        messages_context: [],
        messages_analyze: [
          createLargeMessage(15000),
          createLargeMessage(15000),
        ],
      };

      const result = chunkExtractionContext(context);

      result.chunks.forEach(chunk => {
        expect(chunk.channelDisplayName).toBe("Unique");
      });
    });

    it("ensures all analyze messages are covered across chunks", () => {
      const context: ExtractionContext = {
        personaId: "test-id",
      channelDisplayName: "Test",
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

    it("sizes context budget off actual analyze content, not the model's total token budget (regression: large-context models no longer raid Earlier Conversation)", () => {
      const context: ExtractionContext = {
        personaId: "test-id",
        channelDisplayName: "Test",
        // ~504 tokens — would fit under the old bugged ~14,850-token budget (0.15 * 99,000 available
        // tokens on a 100k-limit model), must NOT fit under the correct content-sized budget (~1 token).
        messages_context: [createLargeMessage(2000)],
        messages_analyze: [createMessage("small update")],
      };

      // maxTokens=100000 mirrors a large-context model (e.g. Haiku's 100k limit) — the exact
      // shape of the production leak this fix targets.
      const result = chunkExtractionContext(context, 100000);

      expect(result.chunks).toHaveLength(1);
      expect(result.chunks[0].messages_context).toHaveLength(0);
    });

    it("clamps context budget to MAX_CONTEXT_TOKENS even when 0.15x the analyze content would allow more", () => {
      const contextMessages = Array.from({ length: 10 }, () => createLargeMessage(400));
      const context: ExtractionContext = {
        personaId: "test-id",
        channelDisplayName: "Test",
        messages_context: contextMessages,
        // ~7504 tokens; 0.15x = 1125, above the 1000-token ceiling.
        messages_analyze: [createLargeMessage(30000)],
      };

      const result = chunkExtractionContext(context, 100000);

      expect(result.chunks).toHaveLength(1);
      // Ratio alone (1125 tokens) would fit all 10 context messages (~1040 tokens); the
      // 1000-token ceiling must still exclude the oldest one.
      expect(result.chunks[0].messages_context.length).toBeLessThan(contextMessages.length);
      expect(result.chunks[0].messages_context.length).toBe(9);
    });

    it("prices earlier-context admission using rendered display text, not raw content (regression: silence_reason bypassed the context budget)", () => {
      const context: ExtractionContext = {
        personaId: "test-id",
        channelDisplayName: "Test",
        // Raw content is empty (~4 tokens); the rendered display text (content + silence_reason
        // wrapper) is ~1264 tokens once hydrated into the actual prompt.
        messages_context: [createSilentMessage(5000)],
        // ~329 tokens -> contextBudget = min(floor(0.15 * 329), 1000) = 49.
        messages_analyze: [createLargeMessage(1300)],
      };

      const result = chunkExtractionContext(context, 100000);

      expect(result.chunks).toHaveLength(1);
      // Priced at raw content (~4 tokens) this would fit the 49-token budget; priced at its
      // actual rendered size (~1264 tokens) it must not.
      expect(result.chunks[0].messages_context).toHaveLength(0);
    });

    it("prices analyze-batch splitting using rendered display text, not raw content (regression: silence_reason bypassed the analyze allocation)", () => {
      const context: ExtractionContext = {
        personaId: "test-id",
        channelDisplayName: "Test",
        messages_context: [],
        // First message's raw content is empty (~4 tokens) but its rendered display text
        // (~843 tokens, via a large silence_reason) is just under the 850-token analyze
        // allocation on its own — small enough to NOT trigger the separate oversized-message
        // split (C1), isolating this test to admission pricing. Combined with the second
        // message (~8 tokens) it exceeds the allocation (851 > 850): a raw-content-only pricer
        // would wrongly pull both into one chunk; display-text pricing must split them.
        messages_analyze: [createSilentMessage(3315), createMessage("a short reply")],
      };

      const result = chunkExtractionContext(context, 2000);

      expect(result.chunks.length).toBeGreaterThan(1);
      expect(result.chunks[0].messages_analyze).toHaveLength(1);
      expect(result.chunks[0].messages_analyze[0].silence_reason).toBeDefined();
    });
  });

  describe("estimateContextTokens", () => {
    it("includes system prompt buffer in estimate", () => {
      const context: ExtractionContext = {
        personaId: "test-id",
      channelDisplayName: "Test",
        messages_context: [],
        messages_analyze: [],
      };

      const estimate = estimateContextTokens(context);

      expect(estimate).toBeGreaterThanOrEqual(1000);
    });

    it("increases with message content", () => {
      const small: ExtractionContext = {
        personaId: "test-id",
      channelDisplayName: "Test",
        messages_context: [createMessage("small")],
        messages_analyze: [],
      };

      const large: ExtractionContext = {
        personaId: "test-id",
      channelDisplayName: "Test",
        messages_context: [createLargeMessage(10000)],
        messages_analyze: [],
      };

      expect(estimateContextTokens(large)).toBeGreaterThan(estimateContextTokens(small));
    });
  });
});
