import { createSignal, onMount, onCleanup, For, Show, Switch, Match, type Accessor } from "solid-js";
import { useKeyboard } from "@opentui/solid";
import type { KeyEvent } from "@opentui/core";
import { stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { useKeyboardNav } from "../context/keyboard.js";
import { useEi } from "../context/ei.js";
import type { ProviderDetectionStatus } from "../util/provider-detection.js";
import { runHarnessInstall as runHarnessInstallReal, stampInstalled, type HarnessInstallResult } from "../util/harness-install.js";
import { ProviderForm, type ProviderFormResult } from "./ProviderForm.js";
import { ProviderSelector, type ProviderSelectorResult } from "./ProviderSelector.js";
import type { HumanSettings, ProviderAccount } from "../../../src/core/types.js";
import pkg from "../../../package.json";

type WizardStep = "welcome" | "provider" | "install" | "done";
type InstallPhase = "confirm" | "running" | "result";
type ProviderPhase = "checking" | "create" | "select" | "skipped";

type InstallOutcome =
  | { status: "skipped" }
  | { status: "ok" }
  | { status: "failed"; failures: string[] };

/** Which of the four import-source integrations Ei found evidence of on this machine. */
export interface ImportSourceDetection {
  claudeCode: boolean;
  cursor: boolean;
  codex: boolean;
  /** Combined Pi + OMP — HumanSettings has no separate `omp` field; both write to `pi.integration`. */
  pi: boolean;
}

export interface OnboardingOverlayProps {
  onDismiss: () => void;
  detectedProviders: ProviderDetectionStatus[];
  isFirstBoot: boolean;
  dataPath: string;
  /** Injectable for tests; defaults to a real filesystem/command presence scan. */
  detectIntegrations?: () => Promise<ImportSourceDetection>;
  /**
   * Injectable for tests; defaults to the real harness installer. Tests
   * MUST use this prop instead of `mock.module()` on harness-install.ts —
   * that leaks process-wide (see notepad issues.md's T2/T11 entries) and
   * would clobber harness-install.test.ts's own coverage of the real
   * module whenever both run in the same `bun test` invocation.
   */
  runHarnessInstall?: () => Promise<HarnessInstallResult>;
}

const COLUMNS = 3;

const STEP_META: Record<WizardStep, { index: number; name: string }> = {
  welcome: { index: 1, name: "Welcome" },
  provider: { index: 2, name: "Provider" },
  install: { index: 3, name: "Install" },
  done: { index: 4, name: "Done" },
};

async function commandExists(command: string): Promise<boolean> {
  try {
    const proc = Bun.spawn([command, "--version"], { stdout: "ignore", stderr: "ignore" });
    await proc.exited;
    return proc.exitCode === 0;
  } catch {
    return false;
  }
}

/**
 * Real default for `detectIntegrations`. Mirrors (does not import — these
 * are private, inline checks inside `installMcpClients()`) the exact
 * presence heuristics `src/cli/install.ts` already uses to decide which
 * per-tool install steps to attempt: Cursor's 3-candidate `.../User` dir
 * check, Pi/OMP's settings-or-auth-file checks, Codex's `commandExists`.
 * Claude Code has no dedicated gate in install.ts (it always runs), so the
 * closest equivalent presence signal is the same `~/.claude.json` config
 * file installClaudeCode() itself edits.
 */
async function defaultDetectImportSources(): Promise<ImportSourceDetection> {
  const home = process.env.HOME || homedir();

  const claudeCode = await Bun.file(join(home, ".claude.json")).exists();

  const cursorDataDirs = [
    join(home, "Library", "Application Support", "Cursor"),
    join(home, ".config", "Cursor"),
    join(home, "AppData", "Roaming", "Cursor"),
  ];
  // Bun.file(x).exists() only detects regular files — it returns false for
  // a directory, and "<CursorDir>/User" is a directory. Use fs.stat()'s
  // isDirectory() instead.
  const cursor = (
    await Promise.all(
      cursorDataDirs.map(async (p) => {
        try {
          return (await stat(join(p, "User"))).isDirectory();
        } catch {
          return false;
        }
      })
    )
  ).some(Boolean);

  const codex = await commandExists("codex");

  const hasPi =
    (await Bun.file(join(home, ".pi", "agent", "settings.json")).exists()) ||
    (await Bun.file(join(home, ".pi", "agent", "auth.json")).exists());
  const hasOmp =
    (await Bun.file(join(home, ".omp", "agent", "settings.json")).exists()) ||
    (await Bun.file(join(home, ".omp", "agent", "auth.json")).exists()) ||
    (await Bun.file(join(home, ".omp", "agent", "config.yml")).exists()) ||
    (await Bun.file(join(home, ".omp", "agent", "agent.db")).exists());

  return { claudeCode, cursor, codex, pi: hasPi || hasOmp };
}

export function OnboardingOverlay(props: OnboardingOverlayProps) {
  const { setOverlayActive } = useKeyboardNav();
  const ei = useEi();

  const [step, setStep] = createSignal<WizardStep>("welcome");

  // --- Provider step ---
  const [providerPhase, setProviderPhase] = createSignal<ProviderPhase>("checking");
  const [providerSummary, setProviderSummary] = createSignal("");
  const [existingAccounts, setExistingAccounts] = createSignal<ProviderAccount[] | null>(null);
  const [conversationModelId, setConversationModelId] = createSignal<string | undefined>(undefined);
  const [extractionModelId, setExtractionModelId] = createSignal<string | undefined>(undefined);

  // --- Install step (also drives the former Import step's source detection
  // and attribution-flag writes — see runInstallYes below) ---
  const [installPhase, setInstallPhase] = createSignal<InstallPhase>("confirm");
  const [installOutcome, setInstallOutcome] = createSignal<InstallOutcome | null>(null);
  const [importDetection, setImportDetection] = createSignal<ImportSourceDetection | null>(null);

  onMount(() => {
    setOverlayActive(true);

    // Kick off both async checks as early as possible (well before the user
    // could ever reach the Provider or Install steps) so there is no risk of
    // either step's frame appearing before its data resolves.
    void (async () => {
      try {
        const human = await ei.getHuman();
        const accounts = human.settings?.accounts ?? [];
        setExistingAccounts(accounts);
        setConversationModelId(human.settings?.conversation_model);
        setExtractionModelId(human.settings?.extraction_model);
        setProviderPhase(accounts.some((a) => a.type === "llm" && a.enabled !== false) ? "select" : "create");
      } catch {
        setProviderPhase("create");
      }
    })();

    void (async () => {
      const detectFn = props.detectIntegrations ?? defaultDetectImportSources;
      setImportDetection(await detectFn());
    })();
  });
  onCleanup(() => setOverlayActive(false));

  // Re-launching /onboarding on an existing user never populates
  // props.detectedProviders (that only happens during ei.tsx's first-boot
  // scan) — for that case, derive the equivalent status list from the
  // same accounts fetched above instead of a permanently-empty prop.
  const effectiveDetectedProviders = (): ProviderDetectionStatus[] =>
    props.isFirstBoot
      ? props.detectedProviders
      : (existingAccounts() ?? []).map((account) => ({ name: account.name, detected: true }));
  const hasDetectedProvider = () => effectiveDetectedProviders().some((p) => p.detected);
  const detectedRows = () => {
    const items = effectiveDetectedProviders();
    const out: ProviderDetectionStatus[][] = [];
    for (let i = 0; i < items.length; i += COLUMNS) out.push(items.slice(i, i + COLUMNS));
    return out;
  };
  const llmAccounts = () => (existingAccounts() ?? []).filter((a) => a.type === "llm" && a.enabled !== false);

  // --- Provider step actions ---
  const goToInstall = () => setStep("install");
  const handleProviderDone = (result: ProviderFormResult) => {
    setProviderSummary(`${result.account.name} configured.`);
    goToInstall();
  };
  const handleProviderSelectDone = (result: ProviderSelectorResult) => {
    setProviderSummary(`${result.account.name} (configured)`);
    goToInstall();
  };
  const handleProviderSkip = () => {
    setProviderSummary("");
    setProviderPhase("skipped");
  };

  // --- Install step actions ---
  const runInstallYes = async () => {
    setInstallPhase("running");
    const result: HarnessInstallResult = await (props.runHarnessInstall ?? runHarnessInstallReal)();

    const detection = importDetection();
    if (detection) {
      const human = await ei.getHuman();
      const settings = human.settings;
      const updates: Partial<HumanSettings> = {};
      if (detection.claudeCode) updates.claudeCode = { ...(settings?.claudeCode ?? {}), integration: true };
      if (detection.cursor) updates.cursor = { ...(settings?.cursor ?? {}), integration: true };
      if (detection.codex) updates.codex = { ...(settings?.codex ?? {}), integration: true };
      if (detection.pi) updates.pi = { ...(settings?.pi ?? {}), integration: true };
      if (Object.keys(updates).length > 0) await ei.updateSettings(updates);
    }

    setInstallOutcome(result.ok ? { status: "ok" } : { status: "failed", failures: result.failures });
    setInstallPhase("result");
  };
  const runInstallNo = () => {
    setInstallOutcome({ status: "skipped" });
    setInstallPhase("result");
  };
  const installSummaryText = () => {
    const outcome = installOutcome();
    if (!outcome) return "not run";
    if (outcome.status === "ok") return "installed";
    if (outcome.status === "skipped") return "skipped";
    return `failed (${outcome.failures.join(", ")})`;
  };
  const installFailuresText = () => {
    const outcome = installOutcome();
    return outcome && outcome.status === "failed" ? outcome.failures.join(", ") : "";
  };

  // --- Done step actions ---
  const finishWizard = async () => {
    if (installOutcome()?.status === "ok") {
      await stampInstalled(props.dataPath, pkg.version);
    }
    props.onDismiss();
  };

  useKeyboard((event: KeyEvent) => {
    const key = event.name;
    const s = step();

    if (s === "welcome") {
      event.preventDefault();
      if (key === "escape") {
        props.onDismiss();
      } else {
        setStep("provider");
      }
      return;
    }

    if (s === "provider") {
      if (providerPhase() === "skipped" && key === "return") {
        event.preventDefault();
        goToInstall();
      }
      // "checking"/"create"/"select": nothing to do here — ProviderForm and
      // ProviderSelector each own their own useKeyboard (gated by being
      // mounted only in their respective phase).
      return;
    }

    if (s === "install") {
      const phase = installPhase();
      if (phase === "confirm") {
        if (importDetection() === null) return;
        if (key === "y") {
          event.preventDefault();
          void runInstallYes();
        } else if (key === "n" || key === "escape") {
          event.preventDefault();
          runInstallNo();
        }
        return;
      }
      if (phase === "result" && key === "return") {
        event.preventDefault();
        setStep("done");
      }
      return;
    }

    if (s === "done") {
      if (key === "return") {
        event.preventDefault();
        void finishWizard();
      }
      return;
    }
  });

  return (
    <box
      position="absolute"
      width="100%"
      height="100%"
      left={0}
      top={0}
      backgroundColor="#000000"
      alignItems="center"
      justifyContent="center"
    >
      <box width={95} backgroundColor="#1a1a2e" borderStyle="single" borderColor="#586e75" padding={2} flexDirection="column">
        <text fg="#93a1a1">{`Step ${STEP_META[step()].index}/4: ${STEP_META[step()].name}`}</text>
        <text> </text>

        <Switch>
          <Match when={step() === "welcome"}>
            <box flexDirection="column">
              <text fg="#eee8d5">
                {props.isFirstBoot ? "Welcome to Ei!" : "Welcome back! Let's review your Ei setup."}
              </text>
              <box visible={hasDetectedProvider()} flexDirection="column">
                <For each={detectedRows()}>
                  {(row) => (
                    <box flexDirection="row">
                      <For each={row}>
                        {(provider) => (
                          <box width={30} flexDirection="row">
                            <text fg="#93a1a1">{provider.name}: </text>
                            <text fg={provider.detected ? "#859900" : "#586e75"}>
                              {provider.detected ? "[✓] detected" : "[ ] not detected"}
                            </text>
                          </box>
                        )}
                      </For>
                    </box>
                  )}
                </For>
              </box>
              <text> </text>
              <box visible={!hasDetectedProvider()} flexDirection="column">
                <text fg="#dc322f">No LLM provider detected.</text>
                <text> </text>
                <text fg="#93a1a1">Use /provider new to configure one manually, or</text>
                <text fg="#93a1a1">start LMStudio (port 1234) / Ollama (port 11434), or</text>
                <text fg="#93a1a1">set ANTHROPIC_API_KEY, OPENAI_API_KEY, etc. and restart.</text>
              </box>
              <text fg="#586e75">Press any key to get started</text>
            </box>
          </Match>

          <Match when={step() === "provider"}>
            <box flexDirection="column">
              <Show when={providerPhase() === "checking"}>
                <text fg="#586e75">Checking existing provider configuration...</text>
              </Show>
              <Show when={providerPhase() === "create"}>
                <ProviderForm ei={ei} onDone={handleProviderDone} onCancel={handleProviderSkip} />
              </Show>
              <Show when={providerPhase() === "select"}>
                <ProviderSelector
                  ei={ei}
                  accounts={llmAccounts()}
                  initialConversationModelId={conversationModelId()}
                  initialExtractionModelId={extractionModelId()}
                  onDone={handleProviderSelectDone}
                  onCancel={handleProviderSkip}
                />
              </Show>
              <Show when={providerPhase() === "skipped"}>
                <text fg="#b58900">Skipped — no AI provider configured.</text>
                <text> </text>
                <text fg="#586e75">Enter: continue</text>
              </Show>
            </box>
          </Match>

          <Match when={step() === "install"}>
            <box flexDirection="column">
              <Show when={installPhase() === "confirm"}>
                <Show
                  when={importDetection()}
                  fallback={<text fg="#586e75">Detecting installed coding tools...</text>}
                >
                  {(detection: Accessor<ImportSourceDetection>) => (
                    <box flexDirection="column">
                      <text fg="#eee8d5">
                        {"Set up Skills, hooks, and harness integrations for your installed coding tools?\n\n" +
                          "Note: the MCP entry is removed — Skills replace it."}
                      </text>
                      <text> </text>
                      <Show
                        when={detection().claudeCode || detection().cursor || detection().codex || detection().pi}
                        fallback={<text fg="#93a1a1">No supported coding tools detected on this machine.</text>}
                      >
                        <box flexDirection="row">
                          <text fg="#93a1a1">Claude Code: </text>
                          <text fg={detection().claudeCode ? "#859900" : "#586e75"}>
                            {detection().claudeCode ? "[✓] found" : "[ ] not found"}
                          </text>
                        </box>
                        <box flexDirection="row">
                          <text fg="#93a1a1">Cursor: </text>
                          <text fg={detection().cursor ? "#859900" : "#586e75"}>
                            {detection().cursor ? "[✓] found" : "[ ] not found"}
                          </text>
                        </box>
                        <box flexDirection="row">
                          <text fg="#93a1a1">Codex: </text>
                          <text fg={detection().codex ? "#859900" : "#586e75"}>
                            {detection().codex ? "[✓] found" : "[ ] not found"}
                          </text>
                        </box>
                        <box flexDirection="row">
                          <text fg="#93a1a1">Pi / OMP: </text>
                          <text fg={detection().pi ? "#859900" : "#586e75"}>
                            {detection().pi ? "[✓] found" : "[ ] not found"}
                          </text>
                        </box>
                      </Show>
                      <Show when={detection().cursor}>
                        <text> </text>
                        <text fg="#b58900">
                          {"Cursor: enabling this installs a hook that injects your recent Ei\n" +
                            "context into Cursor's prompts on every request — which may be sent\n" +
                            "to Cursor's configured model backend."}
                        </text>
                      </Show>
                      <text> </text>
                      <text fg="#586e75">(y/N)</text>
                    </box>
                  )}
                </Show>
              </Show>
              <Show when={installPhase() === "running"}>
                <text fg="#eee8d5">Installing Skills, hooks, and harness integrations...</text>
              </Show>
              <Show when={installPhase() === "result"}>
                <box flexDirection="column">
                  <Switch>
                    <Match when={installOutcome()?.status === "ok"}>
                      <text fg="#859900">✓ Skills, hooks, and harness integrations installed.</text>
                    </Match>
                    <Match when={installOutcome()?.status === "skipped"}>
                      <text fg="#b58900">Skipped — run this later via `ei --install` or `/onboarding`.</text>
                    </Match>
                    <Match when={installOutcome()?.status === "failed"}>
                      <text fg="#dc322f">
                        {`✗ Some integrations failed to install: ${installFailuresText()}`}
                      </text>
                    </Match>
                  </Switch>
                  <text> </text>
                  <text fg="#586e75">Enter: continue</text>
                </box>
              </Show>
            </box>
          </Match>

          <Match when={step() === "done"}>
            <box flexDirection="column">
              <text fg="#859900">You're all set!</text>
              <text> </text>
              <text fg="#eee8d5">{`Data path: ${props.dataPath}`}</text>
              <text fg="#eee8d5">{`Install: ${installSummaryText()}`}</text>
              <text fg="#eee8d5">{`Provider: ${providerSummary() || "not configured"}`}</text>
              <text> </text>
              <text fg="#586e75">Enter: finish</text>
            </box>
          </Match>
        </Switch>
      </box>
    </box>
  );
}
