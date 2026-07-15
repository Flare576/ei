import { createSignal, createMemo, For, Show, Switch, Match } from "solid-js";
import { useKeyboard } from "@opentui/solid";
import type { KeyEvent } from "@opentui/core";
import type { ProviderAccount, HumanSettings } from "../../../src/core/types.js";

/** The minimal slice of EiContextValue this component needs — mirrors
 * ProviderForm.tsx's ProviderFormApi for the same testability reason. */
export interface ProviderSelectorApi {
  updateSettings: (updates: Partial<HumanSettings>) => Promise<void>;
}

export interface ProviderSelectorResult {
  account: ProviderAccount;
  conversationModelId: string;
  extractionModelId: string;
}

export interface ProviderSelectorProps {
  ei: ProviderSelectorApi;
  /** Caller-filtered to `type === "llm"` accounts. Must be non-empty — this
   * component only mounts when at least one such account already exists. */
  accounts: ProviderAccount[];
  /** Current settings' resolved ModelConfig GUIDs, used to pre-select the
   * owning account and the active model per slot. */
  initialConversationModelId?: string;
  initialExtractionModelId?: string;
  focused?: boolean;
  /** Fired when the user cannot proceed (the only account has no usable
   * models) and needs an escape hatch back to onboarding's skip state. */
  onCancel?: () => void;
  onDone: (result: ProviderSelectorResult) => void;
}

type Step = "account" | "models";
type ModelSlot = "chat" | "extraction";


function modelNameFor(account: ProviderAccount, modelId: string | undefined): string | undefined {
  return account.models?.find((m) => m.id === modelId)?.name;
}

/**
 * Onboarding's "already have a provider" path: pick which account to use
 * (skipped when there's only one) and which model backs each of the two
 * onboarding-managed slots (conversation/extraction), then write those two
 * settings fields directly. Deliberately does NOT touch `accounts` or any
 * credential — editing an account's own fields (API key, display name, its
 * model registry) stays behind the existing $EDITOR flow
 * (util/provider-editor.tsx via `/provider`) until that gets an in-app UI.
 */
export function ProviderSelector(props: ProviderSelectorProps) {
  const isFocused = () => props.focused ?? true;

  const initialAccount =
    props.accounts.find(
      (a) => props.initialConversationModelId && a.models?.some((m) => m.id === props.initialConversationModelId)
    ) ?? props.accounts[0]!;
  const initialAccountIndex = Math.max(0, props.accounts.indexOf(initialAccount));

  const [step, setStep] = createSignal<Step>(props.accounts.length > 1 ? "account" : "models");
  const [accountIndex, setAccountIndex] = createSignal(initialAccountIndex);
  const [activeSlot, setActiveSlot] = createSignal<ModelSlot>("chat");
  const [chatModel, setChatModel] = createSignal(
    modelNameFor(initialAccount, props.initialConversationModelId) ?? initialAccount.models?.[0]?.name ?? ""
  );
  const [extractionModel, setExtractionModel] = createSignal(
    modelNameFor(initialAccount, props.initialExtractionModelId) ?? initialAccount.models?.[0]?.name ?? ""
  );
  const [saving, setSaving] = createSignal(false);
  const [saveError, setSaveError] = createSignal("");
  // True only once the user has made an explicit choice (picked an account
  // from a multi-account list, or cycled/switched a model slot) — never
  // set merely by landing on a pre-filled screen. Confirming without ever
  // touching anything must round-trip an EXISTING persisted selection
  // byte-for-byte (I2), even when it doesn't resolve to a clean GUID match
  // (legacy "Provider:model" strings, a cross-account split selection). A
  // fresh setup with no prior selection at all has nothing to preserve —
  // that still writes on a bare confirm, matching onboarding's actual job.
  const [touched, setTouched] = createSignal(false);
  const hadExistingSelection =
    props.initialConversationModelId !== undefined || props.initialExtractionModelId !== undefined;

  const selectedAccount = createMemo(() => props.accounts[accountIndex()]!);
  const modelNames = createMemo(() => (selectedAccount().models ?? []).map((m) => m.name));

  const selectAccount = (index: number) => {
    setTouched(true);
    setAccountIndex(index);
    const account = props.accounts[index]!;
    setChatModel(modelNameFor(account, props.initialConversationModelId) ?? account.models?.[0]?.name ?? "");
    setExtractionModel(modelNameFor(account, props.initialExtractionModelId) ?? account.models?.[0]?.name ?? "");
    setActiveSlot("chat");
    setStep("models");
  };

  const cycleModel = (direction: 1 | -1) => {
    const names = modelNames();
    if (names.length === 0) return;
    setTouched(true);
    const setter = activeSlot() === "chat" ? setChatModel : setExtractionModel;
    setter((current) => {
      const idx = names.indexOf(current);
      const nextIdx = ((idx === -1 ? 0 : idx) + direction + names.length) % names.length;
      return names[nextIdx]!;
    });
  };

  const runConfirm = async () => {
    const account = selectedAccount();
    const conversationModel = account.models?.find((m) => m.name === chatModel());
    const extractionModelConfig = account.models?.find((m) => m.name === extractionModel());
    if (!conversationModel || !extractionModelConfig) {
      setSaveError("Could not resolve selected model configuration");
      return;
    }

    // Nothing was ever explicitly chosen AND there was an existing
    // selection to begin with — this is a passive re-confirm of whatever
    // was already pre-filled. Advance without writing so a legacy
    // "Provider:model" string or a cross-account split selection that this
    // picker can't fully represent is never silently normalized/collapsed
    // (a deliberate account pick or model cycle DOES write — see touched;
    // a fresh setup with nothing previously selected always writes).
    if (!touched() && hadExistingSelection) {
      props.onDone({
        account,
        conversationModelId: conversationModel.id,
        extractionModelId: extractionModelConfig.id,
      });
      return;
    }

    setSaving(true);
    setSaveError("");
    try {
      await props.ei.updateSettings({
        conversation_model: conversationModel.id,
        extraction_model: extractionModelConfig.id,
      });
      props.onDone({
        account,
        conversationModelId: conversationModel.id,
        extractionModelId: extractionModelConfig.id,
      });
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err));
      setSaving(false);
    }
  };

  useKeyboard((event: KeyEvent) => {
    if (!isFocused() || saving()) return;
    const key = event.name;
    const current = step();

    if (current === "account") {
      if (key === "down" || key === "j") {
        event.preventDefault();
        setAccountIndex((i) => Math.min(i + 1, props.accounts.length - 1));
      } else if (key === "up" || key === "k") {
        event.preventDefault();
        setAccountIndex((i) => Math.max(i - 1, 0));
      } else if (key === "return") {
        event.preventDefault();
        selectAccount(accountIndex());
      }
      return;
    }

    if (current === "models") {
      if (key === "tab" || key === "down" || key === "j" || key === "up" || key === "k") {
        event.preventDefault();
        setActiveSlot((s) => (s === "chat" ? "extraction" : "chat"));
      } else if (key === "left" || key === "h") {
        event.preventDefault();
        cycleModel(-1);
      } else if (key === "right" || key === "l") {
        event.preventDefault();
        cycleModel(1);
      } else if (key === "return" || key === "y") {
        event.preventDefault();
        void runConfirm();
      } else if (key === "escape") {
        event.preventDefault();
        if (props.accounts.length > 1) {
          setStep("account");
        } else if (modelNames().length === 0) {
          // Only escape hatch: a lone account with no usable models has no
          // account picker to fall back to and nothing to confirm (I1).
          props.onCancel?.();
        }
      }
      return;
    }
  });

  return (
    <box flexDirection="column">
      <Switch>
        <Match when={step() === "account"}>
          <box flexDirection="column">
            <text fg="#eee8d5" marginBottom={1}>Select a provider account</text>
            <For each={props.accounts}>
              {(account, index) => {
                const isSelected = () => accountIndex() === index();
                return (
                  <box backgroundColor={isSelected() ? "#2d3748" : "transparent"} paddingLeft={1}>
                    <text fg={isSelected() ? "#eee8d5" : "#839496"}>
                      {isSelected() ? "> " : "  "}{account.name}
                    </text>
                  </box>
                );
              }}
            </For>
            <text> </text>
            <text fg="#586e75">j/k or ↑/↓: navigate | Enter: select</text>
          </box>
        </Match>

        <Match when={step() === "models"}>
          <box flexDirection="column">
            <text fg="#eee8d5" marginBottom={1}>{selectedAccount().name}</text>
            <Show
              when={modelNames().length > 0}
              fallback={
                <box flexDirection="column">
                  <text fg="#dc322f">
                    No models configured for this account — run `/provider` to add one.
                  </text>
                  <text> </text>
                  <text fg="#586e75">
                    {props.accounts.length > 1 ? "Esc: choose a different account" : "Esc: skip provider setup for now"}
                  </text>
                </box>
              }
            >
              <box backgroundColor={activeSlot() === "chat" ? "#2d3748" : "transparent"} paddingLeft={1}>
                <text fg={activeSlot() === "chat" ? "#eee8d5" : "#839496"}>
                  Conversation model: {chatModel()} [Change]
                </text>
              </box>
              <box backgroundColor={activeSlot() === "extraction" ? "#2d3748" : "transparent"} paddingLeft={1}>
                <text fg={activeSlot() === "extraction" ? "#eee8d5" : "#839496"}>
                  Extraction model: {extractionModel()} [Change]
                </text>
              </box>
              <Show when={saveError()}>
                <text fg="#dc322f">{saveError()}</text>
              </Show>
              <text> </text>
              <text fg="#586e75">
                {`Tab: switch field | ←/→: change model | Enter: confirm${
                  props.accounts.length > 1 ? " | Esc: back" : ""
                }`}
              </text>
            </Show>
          </box>
        </Match>
      </Switch>
    </box>
  );
}
