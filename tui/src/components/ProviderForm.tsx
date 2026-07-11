import { createSignal, createMemo, For, Switch, Match } from "solid-js";
import { useKeyboard } from "@opentui/solid";
import type { KeyEvent } from "@opentui/core";
import { MaskedInput } from "./MaskedInput.js";
import {
  ALL_PROVIDER_NAMES,
  LOCAL_PROVIDERS,
  CLOUD_PROVIDERS,
  selectModelsForProvider,
  buildProviderAccounts,
  type ProviderDetectionResult,
  type SelectedModels,
} from "../util/provider-detection.js";
import type { ProviderAccount, HumanSettings, HumanEntity } from "../../../src/core/types.js";

type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;

// The minimal slice of EiContextValue this form needs. Accepted as an
// explicit prop (rather than calling useEi() internally) so the component
// stays testable without a Solid context provider — mirrors how
// commands/registry.ts's CommandContext takes `ei: EiContextValue` for the
// same reason.
export interface ProviderFormApi {
  getHuman: () => Promise<HumanEntity>;
  updateSettings: (updates: Partial<HumanSettings>) => Promise<void>;
}

export interface ProviderFormResult {
  account: ProviderAccount;
  conversationModelId: string;
  extractionModelId: string;
}

export interface ProviderFormProps {
  ei: ProviderFormApi;
  /** Whether this form currently owns keyboard input. Defaults to true; the
   * host (an overlay/wizard step) is responsible for toggling this so only
   * one field/form reacts to keystrokes at a time — same convention as
   * MaskedInput's `focused` prop. */
  focused?: boolean;
  onDone?: (result: ProviderFormResult) => void;
  onCancel?: () => void;
  /** Injectable for tests; defaults to the global fetch. */
  fetchFn?: FetchFn;
}

type Step =
  | "provider"
  | "displayName"
  | "apiKey"
  | "testing"
  | "testFailed"
  | "models"
  | "saving"
  | "saveFailed";

type ModelSlot = "chat" | "extraction";

function providerUrlFor(name: string): string {
  const local = LOCAL_PROVIDERS.find((p) => p.name === name);
  if (local) return local.url;
  const cloud = CLOUD_PROVIDERS.find((p) => p.name === name);
  return cloud?.url ?? "";
}

function buildAuthHeaders(url: string, apiKey: string | undefined): Record<string, string> {
  if (!apiKey) return {};
  if (url.includes("api.anthropic.com")) {
    return { "x-api-key": apiKey, "anthropic-version": "2023-06-01" };
  }
  return { Authorization: `Bearer ${apiKey}` };
}

// Local, error-surfacing counterpart to provider-detection.ts's private
// probeModels() (which swallows failures into a `null`, fine for silent
// auto-detection but wrong here — this form must show *why* the test
// failed). Not exported from provider-detection.ts, so reimplemented here
// rather than widening that module's export surface for one caller.
async function probeProviderModels(
  url: string,
  apiKey: string | undefined,
  fetchFn: FetchFn
): Promise<string[]> {
  let response: Response;
  try {
    response = await fetchFn(`${url}/models`, {
      method: "GET",
      headers: buildAuthHeaders(url, apiKey),
      signal: AbortSignal.timeout(5000),
    });
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new Error(`Could not reach ${url}: ${reason}`);
  }
  if (!response.ok) {
    throw new Error(`Provider rejected the request (HTTP ${response.status})`);
  }
  const json = (await response.json()) as { data?: Array<{ id: string }> };
  return (json.data ?? []).map((m) => m.id).filter(Boolean);
}

/**
 * Reusable, self-contained provider-creation form: provider type -> API key
 * (masked) -> test connection -> suggested model confirmation -> save.
 *
 * Deliberately NOT wired into any command or overlay (that's T12's job in
 * Wave 3) and deliberately does not call setOverlayActive/registerTextarea —
 * same reasoning as MaskedInput.tsx: a composable field/form must not fight
 * whatever host (a wizard step, a future standalone dialog) owns the global
 * overlay/focus state. The host mounts this, controls `focused`, and reacts
 * to `onDone`/`onCancel`.
 */
export function ProviderForm(props: ProviderFormProps) {
  const isFocused = () => props.focused ?? true;

  const [step, setStep] = createSignal<Step>("provider");
  const [providerIndex, setProviderIndex] = createSignal(0);
  const [displayName, setDisplayName] = createSignal("");
  const [apiKey, setApiKey] = createSignal("");
  const [modelIds, setModelIds] = createSignal<string[]>([]);
  const [chatModel, setChatModel] = createSignal("");
  const [extractionModel, setExtractionModel] = createSignal("");
  const [activeSlot, setActiveSlot] = createSignal<ModelSlot>("chat");
  const [testError, setTestError] = createSignal("");
  const [saveError, setSaveError] = createSignal("");

  const providerName = createMemo(() => ALL_PROVIDER_NAMES[providerIndex()] ?? ALL_PROVIDER_NAMES[0]!);
  const providerUrl = createMemo(() => providerUrlFor(providerName()));

  const runTest = async (key: string) => {
    setApiKey(key);
    setStep("testing");
    try {
      const ids = await probeProviderModels(providerUrl(), key || undefined, props.fetchFn ?? fetch);
      const selected = selectModelsForProvider(providerName(), ids);
      setModelIds(ids);
      setChatModel(selected.chatModel);
      setExtractionModel(selected.extractionModel);
      setActiveSlot("chat");
      setStep("models");
    } catch (err) {
      setTestError(err instanceof Error ? err.message : String(err));
      setStep("testFailed");
    }
  };

  const cycleModel = (direction: 1 | -1) => {
    const ids = modelIds();
    if (ids.length === 0) return;
    const setter = activeSlot() === "chat" ? setChatModel : setExtractionModel;
    setter((current) => {
      const idx = ids.indexOf(current);
      const nextIdx = ((idx === -1 ? 0 : idx) + direction + ids.length) % ids.length;
      return ids[nextIdx]!;
    });
  };

  const runSave = async () => {
    setStep("saving");
    try {
      const selected: SelectedModels = { chatModel: chatModel(), extractionModel: extractionModel() };
      const detectionResult: ProviderDetectionResult = {
        name: providerName(),
        url: providerUrl(),
        apiKey: apiKey() || undefined,
        modelIds: modelIds(),
        selected,
        status: "detected",
      };
      const { accounts } = buildProviderAccounts([detectionResult]);
      const account = accounts[0];
      if (!account) throw new Error("Failed to build provider account");

      account.name = displayName().trim() || providerName();
      // buildProviderAccounts() substitutes a "$ENVVAR" placeholder for
      // known cloud providers — that's the auto-detect flow's convention
      // for a key that was read FROM that env var. This form's key was
      // typed by the user directly, not sourced from the environment, so
      // restore the literal value here (or leave it unset for a
      // blank/local-provider entry).
      account.api_key = apiKey() || undefined;

      const conversationModel = account.models?.find((m) => m.name === selected.chatModel);
      const extractionModelConfig = account.models?.find((m) => m.name === selected.extractionModel);
      if (!conversationModel || !extractionModelConfig) {
        throw new Error("Could not resolve selected model configuration");
      }

      const human = await props.ei.getHuman();
      const existingAccounts = human.settings?.accounts ?? [];
      await props.ei.updateSettings({
        accounts: [...existingAccounts, account],
        conversation_model: conversationModel.id,
        extraction_model: extractionModelConfig.id,
      });

      props.onDone?.({
        account,
        conversationModelId: conversationModel.id,
        extractionModelId: extractionModelConfig.id,
      });
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err));
      setStep("saveFailed");
    }
  };

  useKeyboard((event: KeyEvent) => {
    if (!isFocused()) return;
    const key = event.name;
    const current = step();

    if (current === "provider") {
      if (key === "down" || key === "j") {
        event.preventDefault();
        setProviderIndex((i) => Math.min(i + 1, ALL_PROVIDER_NAMES.length - 1));
      } else if (key === "up" || key === "k") {
        event.preventDefault();
        setProviderIndex((i) => Math.max(i - 1, 0));
      } else if (key === "return") {
        event.preventDefault();
        setDisplayName(providerName());
        setStep("displayName");
      } else if (key === "escape") {
        event.preventDefault();
        props.onCancel?.();
      }
      return;
    }

    if (current === "displayName") {
      if (key === "return") {
        event.preventDefault();
        if (displayName().trim().length > 0) setStep("apiKey");
      } else if (key === "backspace" || key === "delete") {
        event.preventDefault();
        setDisplayName((v) => v.slice(0, -1));
      } else if (key === "escape") {
        event.preventDefault();
        setStep("provider");
      } else if (key === "space" && !event.ctrl && !event.meta) {
        event.preventDefault();
        setDisplayName((v) => v + " ");
      } else if (key.length === 1 && !event.ctrl && !event.meta) {
        event.preventDefault();
        // `event.name` is lowercased by the parser for letters regardless
        // of shift state (shift+Z -> name "z") — the case-preserving
        // character comes from `event.sequence`. See MaskedInput.tsx /
        // .sisyphus/notepads/.../issues.md's T4 entry.
        setDisplayName((v) => v + event.sequence);
      }
      return;
    }

    if (current === "apiKey") {
      // Typing/Enter is handled by MaskedInput's own useKeyboard (scoped via
      // its `focused` prop) — only handle backward navigation here.
      if (key === "escape") {
        event.preventDefault();
        setStep("displayName");
      }
      return;
    }

    if (current === "testFailed") {
      if (key === "return") {
        event.preventDefault();
        void runTest(apiKey());
      } else if (key === "escape") {
        event.preventDefault();
        setStep("apiKey");
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
        void runSave();
      } else if (key === "escape") {
        event.preventDefault();
        setStep("apiKey");
      }
      return;
    }

    if (current === "saveFailed") {
      if (key === "return") {
        event.preventDefault();
        void runSave();
      } else if (key === "escape") {
        event.preventDefault();
        setStep("models");
      }
      return;
    }
  });

  return (
    <box flexDirection="column" padding={1}>
      <text fg="#eee8d5" marginBottom={1}>
        Add Provider
      </text>

      <Switch>
        <Match when={step() === "provider"}>
          <box flexDirection="column">
            <text fg="#eee8d5" marginBottom={1}>Select a provider type</text>
            <For each={ALL_PROVIDER_NAMES}>
              {(name, index) => {
                const isSelected = () => providerIndex() === index();
                return (
                  <box backgroundColor={isSelected() ? "#2d3748" : "transparent"} paddingLeft={1}>
                    <text fg={isSelected() ? "#eee8d5" : "#839496"}>
                      {isSelected() ? "> " : "  "}{name}
                    </text>
                  </box>
                );
              }}
            </For>
            <text> </text>
            <text fg="#586e75">j/k or ↑/↓: navigate | Enter: select | Esc: cancel</text>
          </box>
        </Match>

        <Match when={step() === "displayName"}>
          <box flexDirection="column">
            <text fg="#eee8d5" marginBottom={1}>Display name for {providerName()}</text>
            <text fg="#eee8d5">{displayName()}_</text>
            <text> </text>
            <text fg="#586e75">Enter: continue | Esc: back</text>
          </box>
        </Match>

        <Match when={step() === "apiKey"}>
          <box flexDirection="column">
            <text fg="#eee8d5" marginBottom={1}>
              API key for {providerName()} (leave blank for local providers)
            </text>
            <MaskedInput
              ref={(h) => h.setValue(apiKey())}
              focused={isFocused() && step() === "apiKey"}
              placeholder="sk-..."
              onSubmit={(value) => {
                void runTest(value);
              }}
            />
            <text> </text>
            <text fg="#586e75">Enter: test connection | Esc: back</text>
          </box>
        </Match>

        <Match when={step() === "testing"}>
          <text fg="#eee8d5">Testing connection to {providerUrl()}...</text>
        </Match>

        <Match when={step() === "testFailed"}>
          <box flexDirection="column">
            <text fg="#dc322f">Connection failed: {testError()}</text>
            <text> </text>
            <text fg="#586e75">Enter: retry | Esc: edit API key</text>
          </box>
        </Match>

        <Match when={step() === "models"}>
          <box flexDirection="column">
            <text fg="#eee8d5" marginBottom={1}>Suggested models for {providerName()}</text>
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
            <text> </text>
            <text fg="#586e75">Tab: switch field | ←/→: change model | Enter: confirm | Esc: back</text>
          </box>
        </Match>

        <Match when={step() === "saving"}>
          <text fg="#eee8d5">Saving provider account...</text>
        </Match>

        <Match when={step() === "saveFailed"}>
          <box flexDirection="column">
            <text fg="#dc322f">Save failed: {saveError()}</text>
            <text> </text>
            <text fg="#586e75">Enter: retry | Esc: back</text>
          </box>
        </Match>
      </Switch>
    </box>
  );
}
