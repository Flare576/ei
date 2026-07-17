import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { SettingsModal } from "./SettingsModal";
import { ProviderType, type ProviderAccount, type ModelConfig } from "../../../../src/core/types";
import type { Processor } from "../../../../src/core/processor";

function makeProcessor(overrides: Partial<Pick<Processor, "deleteProvider" | "deleteModel">> = {}): Processor {
  return {
    deleteProvider: vi.fn().mockResolvedValue({ success: true }),
    deleteModel: vi.fn().mockResolvedValue({ success: true }),
    ...overrides,
  } as unknown as Processor;
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
    const processor = makeProcessor();
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
    const processor = makeProcessor({
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

  it("cascades processor.deleteModel for every model removed in the editor before saving", async () => {
    const account = makeAccount();
    const processor = makeProcessor();
    const onUpdate = renderModal([account], processor);

    fireEvent.click(screen.getByText("Providers"));
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));

    const removeButtons = screen.getAllByRole("button", { name: "Remove model" });
    fireEvent.click(removeButtons[0]); // removes Model A, leaves Model B

    fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));

    await waitFor(() => expect(processor.deleteModel).toHaveBeenCalledWith(account.id, modelA.id));
    expect(processor.deleteModel).not.toHaveBeenCalledWith(account.id, modelB.id);

    await waitFor(() => expect(onUpdate).toHaveBeenCalled());
    const lastCall = onUpdate.mock.calls[onUpdate.mock.calls.length - 1][0] as { accounts: ProviderAccount[] };
    expect(lastCall.accounts[0].models?.map((m) => m.id)).toEqual([modelB.id]);
  });

  it("surfaces the error and does not save when processor.deleteModel fails", async () => {
    const account = makeAccount();
    const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => {});
    const processor = makeProcessor({
      deleteModel: vi.fn().mockResolvedValue({ success: false, error: "cannot delete the last model" }),
    });
    const onUpdate = renderModal([account], processor);

    fireEvent.click(screen.getByText("Providers"));
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));

    const removeButtons = screen.getAllByRole("button", { name: "Remove model" });
    fireEvent.click(removeButtons[0]);

    fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));

    await waitFor(() => expect(processor.deleteModel).toHaveBeenCalled());
    expect(alertSpy).toHaveBeenCalledWith(expect.stringContaining("cannot delete the last model"));
    expect(onUpdate).not.toHaveBeenCalled();
  });

  it("does not cascade when a model is removed in the editor and then cancelled (no save)", async () => {
    const account = makeAccount();
    const processor = makeProcessor();
    renderModal([account], processor);

    fireEvent.click(screen.getByText("Providers"));
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));

    const removeButtons = screen.getAllByRole("button", { name: "Remove model" });
    fireEvent.click(removeButtons[0]);

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(processor.deleteModel).not.toHaveBeenCalled();
  });
});
