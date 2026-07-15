import { describe, it, expect, mock } from "bun:test";
import { testRender } from "@opentui/solid";
import { ProviderSelector, type ProviderSelectorApi, type ProviderSelectorResult } from "../../src/components/ProviderSelector";
import { ProviderType, type ProviderAccount, type HumanSettings } from "../../../src/core/types";

function makeAccount(overrides: Partial<ProviderAccount> = {}): ProviderAccount {
  return {
    id: "account-1",
    name: "Account 1",
    type: ProviderType.LLM,
    url: "http://127.0.0.1:1",
    models: [
      { id: "model-a", name: "model-a" },
      { id: "model-b", name: "model-b" },
    ],
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

// Mocked updateSettings here is pure Promise resolution (no real I/O), so a
// short real-timer wait is enough to flush the confirm chain between
// keystrokes — matches provider-form.test.tsx's own convention.
function wait(ms = 20): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, ms);
  return promise;
}

describe("ProviderSelector", () => {
  it("single account, pre-filled from valid existing model ids: confirming without changing anything advances but does NOT write (I2 — nothing was touched)", async () => {
    const account = makeAccount();
    const updateSettings = mock(async (_updates: Partial<HumanSettings>) => {});
    const ei: ProviderSelectorApi = { updateSettings };

    let result: ProviderSelectorResult | undefined;

    const { renderOnce, mockInput, captureCharFrame, renderer } = await testRender(
      () => (
        <ProviderSelector
          ei={ei}
          accounts={[account]}
          initialConversationModelId="model-a"
          initialExtractionModelId="model-b"
          focused
          onDone={(r) => (result = r)}
        />
      ),
      { width: 70, height: 20 }
    );

    try {
      await renderOnce();
      const frame = captureCharFrame();
      // No account picker — straight to the model slot picker.
      expect(frame).not.toContain("Select a provider account");
      expect(frame).toContain("Account 1");
      expect(frame).toContain("Conversation model: model-a");
      expect(frame).toContain("Extraction model: model-b");

      mockInput.pressEnter();
      await wait();

      // A bare, untouched Enter must never write — see the "explicit touch"
      // test below for the write path.
      expect(updateSettings).not.toHaveBeenCalled();
      expect(result).toBeDefined();
      expect(result!.account.id).toBe("account-1");
      expect(result!.conversationModelId).toBe("model-a");
      expect(result!.extractionModelId).toBe("model-b");
    } finally {
      renderer.destroy();
    }
  });
  it("multiple accounts with split existing model selections: deliberately confirming account A writes both model ids from A (I2)", async () => {
    const accountA = makeAccount({
      id: "account-a",
      name: "Account A",
      models: [{ id: "a-model", name: "A model" }],
    });
    const accountB = makeAccount({
      id: "account-b",
      name: "Account B",
      models: [{ id: "b-model", name: "B model" }],
    });
    const updateSettings = mock(async (_updates: Partial<HumanSettings>) => {});
    const ei: ProviderSelectorApi = { updateSettings };
    let result: ProviderSelectorResult | undefined;

    const { renderOnce, mockInput, captureCharFrame, renderer } = await testRender(
      () => (
        <ProviderSelector
          ei={ei}
          accounts={[accountA, accountB]}
          initialConversationModelId="a-model"
          initialExtractionModelId="b-model"
          focused
          onDone={(r) => (result = r)}
        />
      ),
      { width: 70, height: 20 }
    );

    try {
      await renderOnce();
      expect(captureCharFrame()).toContain("Select a provider account");

      mockInput.pressEnter(); // Deliberately select the initially highlighted Account A.
      await renderOnce();
      mockInput.pressEnter(); // Confirm Account A's resolved model selections.
      await wait();

      expect(updateSettings).toHaveBeenCalledTimes(1);
      expect(updateSettings.mock.calls[0]![0]).toEqual({
        conversation_model: "a-model",
        extraction_model: "a-model",
      });
      expect(result).toBeDefined();
      expect(result!.account.id).toBe("account-a");
      expect(result!.conversationModelId).toBe("a-model");
      expect(result!.extractionModelId).toBe("a-model");
    } finally {
      renderer.destroy();
    }
  });


  it("single account, pre-filled from valid existing model ids: cycling a model before confirming DOES write (deliberate change)", async () => {
    const account = makeAccount();
    const updateSettings = mock(async (_updates: Partial<HumanSettings>) => {});
    const ei: ProviderSelectorApi = { updateSettings };

    const { renderOnce, mockInput, renderer } = await testRender(
      () => (
        <ProviderSelector
          ei={ei}
          accounts={[account]}
          initialConversationModelId="model-a"
          initialExtractionModelId="model-b"
          focused
          onDone={() => {}}
        />
      ),
      { width: 70, height: 20 }
    );

    try {
      await renderOnce();
      mockInput.pressArrow("right"); // model-a -> model-b on the chat slot
      await renderOnce();
      mockInput.pressEnter();
      await wait();

      expect(updateSettings).toHaveBeenCalledTimes(1);
      expect(updateSettings.mock.calls[0]![0]).toEqual({
        conversation_model: "model-b",
        extraction_model: "model-b",
      });
    } finally {
      renderer.destroy();
    }
  });

  it("single account with NO prior selection at all: confirming without touching still writes (fresh setup, nothing to silently overwrite)", async () => {
    const account = makeAccount();
    const updateSettings = mock(async (_updates: Partial<HumanSettings>) => {});
    const ei: ProviderSelectorApi = { updateSettings };

    const { renderOnce, mockInput, renderer } = await testRender(
      () => <ProviderSelector ei={ei} accounts={[account]} focused onDone={() => {}} />,
      { width: 70, height: 20 }
    );

    try {
      await renderOnce();
      mockInput.pressEnter();
      await wait();

      expect(updateSettings).toHaveBeenCalledTimes(1);
      expect(updateSettings.mock.calls[0]![0]).toEqual({
        conversation_model: "model-a",
        extraction_model: "model-a",
      });
    } finally {
      renderer.destroy();
    }
  });

  it("single account with a legacy/unresolvable prior selection (e.g. a colon-form string): confirming without touching does NOT write, and does not crash", async () => {
    const account = makeAccount();
    const updateSettings = mock(async (_updates: Partial<HumanSettings>) => {});
    const ei: ProviderSelectorApi = { updateSettings };

    let result: ProviderSelectorResult | undefined;

    const { renderOnce, mockInput, captureCharFrame, renderer } = await testRender(
      () => (
        <ProviderSelector
          ei={ei}
          accounts={[account]}
          initialConversationModelId="Account 1:model-b"
          initialExtractionModelId="Account 1:model-b"
          focused
          onDone={(r) => (result = r)}
        />
      ),
      { width: 70, height: 20 }
    );

    try {
      await renderOnce();
      // Neither id matches a real ModelConfig.id -> falls back to the
      // account's first model for display, exactly as it would for a fresh
      // setup — but the write below must still be suppressed, because a
      // prior selection DID exist (I2's core distinction).
      expect(captureCharFrame()).toContain("Conversation model: model-a");

      mockInput.pressEnter();
      await wait();

      expect(updateSettings).not.toHaveBeenCalled();
      expect(result).toBeDefined();
    } finally {
      renderer.destroy();
    }
  });

  it("Escape on a lone account with no usable models fires onCancel (I1 — no other exit exists)", async () => {
    const account = makeAccount({ models: undefined });
    const onCancel = mock(() => {});
    const ei: ProviderSelectorApi = { updateSettings: mock(async () => {}) };

    const { renderOnce, mockInput, captureCharFrame, renderer } = await testRender(
      () => <ProviderSelector ei={ei} accounts={[account]} focused onDone={() => {}} onCancel={onCancel} />,
      { width: 70, height: 20 }
    );

    try {
      await renderOnce();
      expect(captureCharFrame()).toContain("Esc: skip provider setup for now");

      mockInput.pressEscape();
      await renderOnce();
      await wait(50); // real ANSI escape-sequence disambiguation delay
      await renderOnce();

      expect(onCancel).toHaveBeenCalledTimes(1);
    } finally {
      renderer.destroy();
    }
  });

  it("Escape with no models on the CURRENT account, but multiple accounts available, goes back to the account picker instead of cancelling", async () => {
    const emptyAccount = makeAccount({ id: "account-1", name: "Account One", models: undefined });
    const usableAccount = makeAccount({ id: "account-2", name: "Account Two" });
    const onCancel = mock(() => {});
    const ei: ProviderSelectorApi = { updateSettings: mock(async () => {}) };

    const { renderOnce, mockInput, captureCharFrame, renderer } = await testRender(
      () => (
        <ProviderSelector
          ei={ei}
          accounts={[emptyAccount, usableAccount]}
          focused
          onDone={() => {}}
          onCancel={onCancel}
        />
      ),
      { width: 70, height: 20 }
    );

    try {
      await renderOnce();
      // Two accounts -> starts at the account picker, not the models step.
      expect(captureCharFrame()).toContain("Select a provider account");

      mockInput.pressEnter(); // pick the highlighted (first) account: emptyAccount
      await renderOnce();
      expect(captureCharFrame()).toContain("Esc: choose a different account");

      mockInput.pressEscape();
      await renderOnce();
      await wait(50);
      await renderOnce();

      expect(captureCharFrame()).toContain("Select a provider account");
      expect(onCancel).not.toHaveBeenCalled();
    } finally {
      renderer.destroy();
    }
  });

  it("Tab switches the active slot and left/right cycles the model for that slot, wrapping around", async () => {
    const account = makeAccount();
    const ei: ProviderSelectorApi = { updateSettings: mock(async () => {}) };

    const { renderOnce, mockInput, captureCharFrame, renderer } = await testRender(
      () => <ProviderSelector ei={ei} accounts={[account]} focused onDone={() => {}} />,
      { width: 70, height: 20 }
    );

    try {
      await renderOnce();
      // No initial ids -> both slots default to the account's first model.
      expect(captureCharFrame()).toContain("Conversation model: model-a");
      expect(captureCharFrame()).toContain("Extraction model: model-a");

      // Right on the (default active) chat slot cycles forward, then wraps.
      mockInput.pressArrow("right");
      await renderOnce();
      expect(captureCharFrame()).toContain("Conversation model: model-b");
      mockInput.pressArrow("right");
      await renderOnce();
      expect(captureCharFrame()).toContain("Conversation model: model-a"); // wrapped

      // Tab moves to the extraction slot; left cycles it backward (wraps).
      mockInput.pressTab();
      await renderOnce();
      mockInput.pressArrow("left");
      await renderOnce();
      const frame = captureCharFrame();
      expect(frame).toContain("Extraction model: model-b");
      // Chat model untouched by extraction-slot cycling.
      expect(frame).toContain("Conversation model: model-a");
    } finally {
      renderer.destroy();
    }
  });

  it("multiple accounts: shows the account picker first, j/k navigates, Enter selects and moves to that account's models; Esc backs out", async () => {
    const accountOne = makeAccount({
      id: "account-1",
      name: "Account One",
      models: [{ id: "one-a", name: "one-model" }],
    });
    const accountTwo = makeAccount({
      id: "account-2",
      name: "Account Two",
      models: [{ id: "two-a", name: "two-model" }],
    });
    const ei: ProviderSelectorApi = { updateSettings: mock(async () => {}) };

    const { renderOnce, mockInput, captureCharFrame, renderer } = await testRender(
      () => <ProviderSelector ei={ei} accounts={[accountOne, accountTwo]} focused onDone={() => {}} />,
      { width: 70, height: 20 }
    );

    try {
      await renderOnce();
      let frame = captureCharFrame();
      expect(frame).toContain("Select a provider account");
      expect(frame).toContain("Account One");
      expect(frame).toContain("Account Two");

      mockInput.pressKey("j");
      await renderOnce();
      mockInput.pressEnter();
      await renderOnce();

      frame = captureCharFrame();
      expect(frame).not.toContain("Select a provider account");
      expect(frame).toContain("Account Two");
      expect(frame).toContain("Conversation model: two-model");

      // Esc from the models step (with >1 accounts) goes back to the account picker.
      mockInput.pressEscape();
      await renderOnce();
      await wait(50);
      await renderOnce();
      expect(captureCharFrame()).toContain("Select a provider account");
    } finally {
      renderer.destroy();
    }
  });

  it("an account with no models shows a clear message instead of a blank, unconfirmable picker", async () => {
    const account = makeAccount({ models: undefined });
    const updateSettings = mock(async () => {});
    const ei: ProviderSelectorApi = { updateSettings };

    const { renderOnce, mockInput, captureCharFrame, renderer } = await testRender(
      () => <ProviderSelector ei={ei} accounts={[account]} focused onDone={() => {}} />,
      { width: 70, height: 20 }
    );

    try {
      await renderOnce();
      const frame = captureCharFrame();
      expect(frame).toContain("No models configured for this account");
      expect(frame).not.toContain("[Change]");

      mockInput.pressEnter();
      await wait();
      expect(updateSettings).not.toHaveBeenCalled();
    } finally {
      renderer.destroy();
    }
  });
});
