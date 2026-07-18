import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { SettingsModal } from "./SettingsModal";
import { ProviderType, type ProviderAccount, type ModelConfig } from "../../../../src/core/types";
import type { Processor } from "../../../../src/core/processor";
import { Processor as RealProcessor } from "../../../../src/core/processor";
import type { Ei_Interface } from "../../../../src/core/types";
import type { Storage } from "../../../../src/storage/interface";

function makeProcessor(
  accounts: ProviderAccount[] = [],
  overrides: Partial<Pick<Processor, "deleteProvider" | "deleteModel" | "upsertProviderAccount" | "getHuman">> = {}
): Processor {
  // Mirrors StateManager.upsertProviderAccount's real semantics (replace-by-id
  // or push) against a private store, so getHuman() reflects saves the same
  // way SettingsModal.handleAccountSave now depends on post-fix.
  const store = [...accounts];
  return {
    deleteProvider: vi.fn().mockResolvedValue({ success: true }),
    deleteModel: vi.fn().mockResolvedValue({ success: true }),
    upsertProviderAccount: vi.fn().mockImplementation(async (account: ProviderAccount) => {
      const idx = store.findIndex((a) => a.id === account.id);
      if (idx >= 0) store[idx] = account;
      else store.push(account);
      return { success: true };
    }),
    getHuman: vi.fn().mockImplementation(async () => ({ settings: { accounts: store } })),
    ...overrides,
  } as unknown as Processor;
}

function makeRealStorage(): Storage {
  return {
    getDataPath: () => "/tmp/settings-modal-test",
    isAvailable: async () => true,
    load: async () => null,
    save: async () => {},
    moveToBackup: async () => {},
    loadBackup: async () => null,
    saveRollingBackup: async () => {},
  };
}

function makeNoopInterface(): Ei_Interface {
  return {};
}

function renderModal(accounts: ProviderAccount[], processor: Processor) {
  const onUpdate = vi.fn();
  render(
    <SettingsModal
      isOpen
      onClose={() => {}}
      settings={{ ceremony_time: "09:00", accounts }}
      onUpdate={onUpdate}
      onDownloadBackup={() => {}}
      onUploadBackup={() => {}}
      toolProviders={[]}
      toolDefinitions={[]}
      onToolProviderUpdate={() => {}}
      onToolProviderRemove={() => {}}
      onToolUpdate={() => {}}
      processor={processor}
    />
  );
  return onUpdate;
}

const modelA: ModelConfig = { id: "model-a", name: "Model A" };
const modelB: ModelConfig = { id: "model-b", name: "Model B" };

function makeAccount(): ProviderAccount {
  return {
    id: "provider-1",
    name: "Test Provider",
    type: ProviderType.LLM,
    url: "https://api.example.com",
    enabled: true,
    created_at: new Date().toISOString(),
    models: [modelA, modelB],
    default_model: modelA.id,
  };
}

describe("SettingsModal provider/model deletion cascade", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("deletes the whole provider through processor.deleteProvider and clears local state on success", async () => {
    const account = makeAccount();
    const processor = makeProcessor([account]);
    const onUpdate = renderModal([account], processor);

    fireEvent.click(screen.getByText("Providers"));
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));

    await waitFor(() => expect(processor.deleteProvider).toHaveBeenCalledWith(account.id));
    await waitFor(() => expect(onUpdate).toHaveBeenCalledWith({ accounts: [] }));
    expect(screen.queryByText("Test Provider")).not.toBeInTheDocument();
  });

  it("surfaces the error and keeps the account when processor.deleteProvider fails", async () => {
    const account = makeAccount();
    const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => {});
    const processor = makeProcessor([account], {
      deleteProvider: vi.fn().mockResolvedValue({ success: false, error: "boom" }),
    });
    const onUpdate = renderModal([account], processor);

    fireEvent.click(screen.getByText("Providers"));
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));

    await waitFor(() => expect(processor.deleteProvider).toHaveBeenCalledWith(account.id));
    expect(alertSpy).toHaveBeenCalledWith(expect.stringContaining("boom"));
    expect(onUpdate).not.toHaveBeenCalled();
    expect(screen.getByText("Test Provider")).toBeInTheDocument();
  });

  it("saves through processor.upsertProviderAccount when a model is removed in the editor", async () => {
    const account = makeAccount();
    const processor = makeProcessor([account]);
    const onUpdate = renderModal([account], processor);

    fireEvent.click(screen.getByText("Providers"));
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));

    const removeButtons = screen.getAllByRole("button", { name: "Remove model" });
    fireEvent.click(removeButtons[0]); // removes Model A, leaves Model B

    fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));

    await waitFor(() => expect(processor.upsertProviderAccount).toHaveBeenCalled());
    const savedAccount = (processor.upsertProviderAccount as Mock).mock.calls[0][0] as ProviderAccount;
    expect(savedAccount.models?.map((m) => m.id)).toEqual([modelB.id]);

    await waitFor(() => expect(onUpdate).toHaveBeenCalled());
    const lastCall = onUpdate.mock.calls[onUpdate.mock.calls.length - 1][0] as { accounts: ProviderAccount[] };
    expect(lastCall.accounts[0].models?.map((m) => m.id)).toEqual([modelB.id]);
  });

  it("surfaces the error and does not save when processor.upsertProviderAccount fails", async () => {
    const account = makeAccount();
    const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => {});
    const processor = makeProcessor([account], {
      upsertProviderAccount: vi.fn().mockResolvedValue({ success: false, error: "cannot delete the last model" }),
    });
    const onUpdate = renderModal([account], processor);

    fireEvent.click(screen.getByText("Providers"));
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));

    const removeButtons = screen.getAllByRole("button", { name: "Remove model" });
    fireEvent.click(removeButtons[0]);

    fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));

    await waitFor(() => expect(processor.upsertProviderAccount).toHaveBeenCalled());
    expect(alertSpy).toHaveBeenCalledWith(expect.stringContaining("cannot delete the last model"));
    expect(onUpdate).not.toHaveBeenCalled();
  });

  it("does not save when a model is removed in the editor and then cancelled (no save)", async () => {
    const account = makeAccount();
    const processor = makeProcessor([account]);
    renderModal([account], processor);

    fireEvent.click(screen.getByText("Providers"));
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));

    const removeButtons = screen.getAllByRole("button", { name: "Remove model" });
    fireEvent.click(removeButtons[0]);

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(processor.upsertProviderAccount).not.toHaveBeenCalled();
  });
});

// Beta's I1 finding (2026-07-18): the old sequencing computed removed model
// IDs, called deleteModel() per removed ID *against the current account*
// before saving the replacement, then saved separately. Replacing a
// provider's only model in one edit (remove A, add B) made deleteModel()
// correctly refuse - the provider still had only A at delete-time - which
// broke a previously valid save. Uses a real StateManager-backed Processor
// (not a mocked upsertProviderAccount) so the last-model guard is genuinely
// exercised, per Beta's explicit test-plan requirement (T2).
describe("SettingsModal provider save - I1 regression guard (real Processor)", () => {
  it("replaces a provider's only model in one save without tripping the last-model guard", async () => {
    const processor = new RealProcessor(makeNoopInterface());
    await processor.start(makeRealStorage());

    const account: ProviderAccount = {
      id: "provider-1",
      name: "Test Provider",
      type: ProviderType.LLM,
      url: "https://api.example.com",
      enabled: true,
      created_at: new Date().toISOString(),
      models: [modelA],
      default_model: modelA.id,
    };
    const upsertResult = await processor.upsertProviderAccount(account);
    expect(upsertResult.success).toBe(true);

    const personaId = await processor.createPersona({ name: "Pinned", long_description: "Pinned to model A" });
    await processor.updatePersona(personaId, { model: modelA.id });

    const onUpdate = renderModal([account], processor);

    fireEvent.click(screen.getByText("Providers"));
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));

    const removeButtons = screen.getAllByRole("button", { name: "Remove model" });
    fireEvent.click(removeButtons[0]); // removes Model A - the provider's only model

    fireEvent.click(screen.getByRole("button", { name: "+ Add Model" }));
    const nameInputs = screen.getAllByLabelText("Model name");
    fireEvent.change(nameInputs[nameInputs.length - 1], { target: { value: "model-b-name" } });

    fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));

    await waitFor(() => expect(onUpdate).toHaveBeenCalled());

    const human = await processor.getHuman();
    const savedAccount = human.settings?.accounts?.find((a) => a.id === account.id);
    expect(savedAccount?.models).toHaveLength(1);
    expect(savedAccount?.models?.[0].id).not.toBe(modelA.id);
    expect(savedAccount?.models?.[0].name).toBe("model-b-name");

    const persona = await processor.getPersona(personaId);
    expect(persona?.model).toBeUndefined();

    await processor.stop();
  });
});
