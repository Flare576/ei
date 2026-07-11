import { describe, it, expect, mock } from "bun:test";
import { testRender } from "@opentui/solid";
import { ProviderForm, type ProviderFormApi, type ProviderFormResult } from "../../src/components/ProviderForm";
import type { HumanEntity, HumanSettings, ProviderAccount } from "../../../src/core/types";

function makeHuman(accounts: ProviderAccount[] = []): HumanEntity {
  return {
    entity: "human",
    facts: [],
    topics: [],
    people: [],
    quotes: [],
    last_updated: new Date().toISOString(),
    settings: { accounts },
  };
}

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return { ok, status, json: async () => body } as Response;
}

// Mocked async work here is pure Promise resolution (no real I/O), so a short
// real-timer wait is enough to flush the probe/save chain between keystrokes.
function wait(ms = 20): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, ms);
  return promise;
}

describe("ProviderForm", () => {
  it("confirm path calls ei.updateSettings with accounts + conversation_model + extraction_model, and masks the API key throughout", async () => {
    const getHuman = mock(async () => makeHuman([]));
    const updateSettings = mock(async (_updates: Partial<HumanSettings>) => {});
    const ei: ProviderFormApi = { getHuman, updateSettings };

    const fetchFn = mock(async (url: string) => {
      expect(url).toBe("https://api.anthropic.com/v1/models");
      return jsonResponse({ data: [{ id: "claude-sonnet-4-6" }, { id: "claude-haiku-4-5" }] });
    });

    let result: ProviderFormResult | undefined;

    const { renderOnce, mockInput, captureCharFrame, renderer } = await testRender(
      () => (
        <ProviderForm ei={ei} fetchFn={fetchFn} focused onDone={(r) => (result = r)} />
      ),
      { width: 70, height: 20 }
    );

    try {
      await renderOnce();

      // Provider step: LMStudio(0) -> Ollama(1) -> Anthropic(2).
      mockInput.pressArrow("down");
      mockInput.pressArrow("down");
      await renderOnce();
      mockInput.pressEnter();
      await renderOnce();

      // Display-name step: prefilled "Anthropic" — append mixed-case text to
      // prove this plain text field preserves case (event.sequence, not the
      // lowercased event.name).
      await mockInput.typeText(" PROD");
      await renderOnce();
      const nameFrame = captureCharFrame();
      expect(nameFrame).toContain("Anthropic PROD");
      expect(nameFrame).not.toContain("anthropic prod");
      mockInput.pressEnter();
      await renderOnce();

      // API-key step: typed key must never appear in a rendered frame.
      const apiKey = "sk-test-KeyWithCase";
      await mockInput.typeText(apiKey);
      await renderOnce();
      const keyFrame = captureCharFrame();
      expect(keyFrame).not.toContain(apiKey);
      expect(keyFrame).toContain("•");
      mockInput.pressEnter(); // submit -> test connection
      await renderOnce();
      await wait();
      await renderOnce();

      // Models step: accept the suggested conversation/extraction models.
      const modelsFrame = captureCharFrame();
      expect(modelsFrame).toContain("claude-sonnet-4-6");
      expect(modelsFrame).toContain("claude-haiku-4-5");
      mockInput.pressEnter(); // confirm -> save
      await renderOnce();
      await wait();
      await renderOnce();

      expect(getHuman).toHaveBeenCalledTimes(1);
      expect(updateSettings).toHaveBeenCalledTimes(1);

      const payload = updateSettings.mock.calls[0]![0] as Partial<HumanSettings> & {
        accounts: ProviderAccount[];
      };
      expect(payload.accounts).toHaveLength(1);
      expect(payload.accounts[0]!.name).toBe("Anthropic PROD");
      expect(payload.accounts[0]!.api_key).toBe(apiKey);
      const conversationModelId = payload.conversation_model;
      const extractionModelId = payload.extraction_model;
      expect(typeof conversationModelId).toBe("string");
      expect(typeof extractionModelId).toBe("string");
      expect((payload as Record<string, unknown>).default_model).toBeUndefined();

      const savedModelIds = new Set(payload.accounts[0]!.models!.map((m) => m.id));
      expect(savedModelIds.has(conversationModelId!)).toBe(true);
      expect(savedModelIds.has(extractionModelId!)).toBe(true);

      expect(result).toBeDefined();
      expect(result!.account.api_key).toBe(apiKey);
      expect(result!.conversationModelId).toBe(conversationModelId!);
      expect(result!.extractionModelId).toBe(extractionModelId!);
    } finally {
      renderer.destroy();
    }
  });

  it("test-connection failure surfaces a visible error and never saves a broken account", async () => {
    const getHuman = mock(async () => makeHuman([]));
    const updateSettings = mock(async (_updates: Partial<HumanSettings>) => {});
    const ei: ProviderFormApi = { getHuman, updateSettings };

    const fetchFn = mock(async () => jsonResponse({}, false, 401));
    const onCancel = mock(() => {});

    const { renderOnce, mockInput, captureCharFrame, renderer } = await testRender(
      () => <ProviderForm ei={ei} fetchFn={fetchFn} focused onCancel={onCancel} />,
      { width: 70, height: 20 }
    );

    try {
      await renderOnce();

      // Provider step: LMStudio(0) -> Ollama(1) — a local provider, no key.
      mockInput.pressArrow("down");
      await renderOnce();
      mockInput.pressEnter(); // -> displayName "Ollama"
      await renderOnce();
      mockInput.pressEnter(); // accept default name -> apiKey step
      await renderOnce();
      mockInput.pressEnter(); // submit blank key -> test connection
      await renderOnce();
      await wait();
      await renderOnce();

      const frame = captureCharFrame();
      expect(frame).toContain("Connection failed");
      expect(frame).toContain("HTTP 401");

      // Retrying (still failing) must not save anything either.
      mockInput.pressEnter();
      await renderOnce();
      await wait();
      await renderOnce();
      expect(captureCharFrame()).toContain("Connection failed");

      expect(getHuman).not.toHaveBeenCalled();
      expect(updateSettings).not.toHaveBeenCalled();

      // Esc backs out to the API-key step without saving either.
      mockInput.pressEscape();
      await renderOnce();
      await wait();
      await renderOnce();
      expect(captureCharFrame()).toContain("API key for Ollama");
      expect(updateSettings).not.toHaveBeenCalled();
    } finally {
      renderer.destroy();
    }
  });
});
