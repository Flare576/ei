import { createSignal, onMount, onCleanup, For, Show, Switch, Match, type Accessor } from "solid-js";
import { useKeyboard } from "@opentui/solid";
import type { KeyEvent } from "@opentui/core";
import { stat, access, mkdir } from "node:fs/promises";
import { constants as fsConstants, type Stats } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { useKeyboardNav } from "../context/keyboard.js";
import { useEi } from "../context/ei.js";
import type { ProviderDetectionStatus } from "../util/provider-detection.js";
import { runHarnessInstall as runHarnessInstallReal, stampInstalled, type HarnessInstallResult } from "../util/harness-install.js";
import { resolveDataPath } from "../util/resolve-data-path.js";
import { writeShellExport, type ResolveShellProfileOptions } from "../util/shell-profile.js";
import { ProviderForm, type ProviderFormResult } from "./ProviderForm.js";
import type { HumanSettings } from "../../../src/core/types.js";
import pkg from "../../../package.json";

type WizardStep = "welcome" | "install" | "data-path" | "provider" | "import" | "done";
type InstallPhase = "confirm" | "running" | "result";
type DataPathMode = "view" | "editing";
type ProviderPhase = "checking" | "configured" | "form" | "skipped";

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
  /** Forwarded to shell-profile.ts's writeShellExport for env/home injection in tests. */
  shellProfileOptions?: ResolveShellProfileOptions;
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
  install: { index: 2, name: "Install" },
  "data-path": { index: 3, name: "Data Path" },
  provider: { index: 4, name: "Provider" },
  import: { index: 5, name: "Import" },
  done: { index: 6, name: "Done" },
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
  const cursor = (await Promise.all(cursorDataDirs.map((p) => Bun.file(join(p, "User")).exists()))).some(Boolean);

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

  const initialDataPath = props.dataPath;

  const [step, setStep] = createSignal<WizardStep>("welcome");

  // --- Install step ---
  const [installPhase, setInstallPhase] = createSignal<InstallPhase>("confirm");
  const [installOutcome, setInstallOutcome] = createSignal<InstallOutcome | null>(null);

  // --- Data Path step ---
  const [currentDataPath, setCurrentDataPath] = createSignal(props.dataPath);
  const [dpMode, setDpMode] = createSignal<DataPathMode>("view");
  const [dpInput, setDpInput] = createSignal("");
  const [dpError, setDpError] = createSignal<string | null>(null);
  const [dpShellNote, setDpShellNote] = createSignal<string | null>(null);
  const [dpBusy, setDpBusy] = createSignal(false);

  // --- Provider step ---
  const [providerPhase, setProviderPhase] = createSignal<ProviderPhase>("checking");
  const [providerSummary, setProviderSummary] = createSignal("");

  // --- Import step ---
  const [importDetection, setImportDetection] = createSignal<ImportSourceDetection | null>(null);

  onMount(() => {
    setOverlayActive(true);

    // Kick off the "already configured?" check as early as possible (well
    // before the user could ever reach the Provider step) so there is no
    // risk of the Provider step's frame appearing before this resolves.
    void (async () => {
      try {
        const human = await ei.getHuman();
        const accounts = human.settings?.accounts ?? [];
        const lastAccount = accounts[accounts.length - 1];
        if (lastAccount) {
          setProviderSummary(`${lastAccount.name} (already configured)`);
          setProviderPhase("configured");
        } else {
          setProviderPhase("form");
        }
      } catch {
        setProviderPhase("form");
      }
    })();
  });
  onCleanup(() => setOverlayActive(false));

  const hasDetectedProvider = () => props.detectedProviders.some((p) => p.detected);
  const detectedRows = () => {
    const items = props.detectedProviders;
    const out: ProviderDetectionStatus[][] = [];
    for (let i = 0; i < items.length; i += COLUMNS) out.push(items.slice(i, i + COLUMNS));
    return out;
  };

  // --- Install step actions ---
  const runInstallYes = async () => {
    setInstallPhase("running");
    const result: HarnessInstallResult = await (props.runHarnessInstall ?? runHarnessInstallReal)();
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

  // --- Data Path step actions ---
  const validateAndApplyDataPath = async (rawInput: string) => {
    const path = rawInput.trim();
    if (!path) {
      setDpError("Path cannot be empty");
      return;
    }

    let stats: Stats | null;
    try {
      stats = await stat(path);
    } catch {
      stats = null;
    }

    if (stats) {
      if (!stats.isDirectory()) {
        setDpError(`Not a directory: ${path}`);
        return;
      }
      try {
        await access(path, fsConstants.R_OK | fsConstants.W_OK);
      } catch {
        setDpError(`No read/write access: ${path}`);
        return;
      }
    } else {
      try {
        await mkdir(path, { recursive: true });
      } catch (e) {
        setDpError(`Could not create ${path}: ${e instanceof Error ? e.message : String(e)}`);
        return;
      }
    }

    setDpError(null);
    setCurrentDataPath(path);
    setDpMode("view");

    if (path !== resolveDataPath()) {
      const result = await writeShellExport("EI_DATA_PATH", path, props.shellProfileOptions);
      if (!result.success && result.reason === "unknown_shell") {
        setDpShellNote(
          `Could not detect your shell to update it automatically. Add this line to your shell profile manually: export EI_DATA_PATH="${path}"`
        );
      } else if (!result.success) {
        setDpShellNote(`Could not update your shell profile: ${result.message}`);
      } else {
        setDpShellNote(null);
      }
    } else {
      setDpShellNote(null);
    }
  };

  const goToProvider = () => setStep("provider");

  // --- Provider step actions ---
  const handleProviderDone = (result: ProviderFormResult) => {
    setProviderSummary(`${result.account.name} configured.`);
    setProviderPhase("configured");
  };
  const handleProviderSkip = () => setProviderPhase("skipped");

  const goToImport = () => {
    setStep("import");
    void loadImportDetection();
  };

  // --- Import step actions ---
  const loadImportDetection = async () => {
    const detectFn = props.detectIntegrations ?? defaultDetectImportSources;
    const result = await detectFn();

    const human = await ei.getHuman();
    const settings = human.settings;
    const updates: Partial<HumanSettings> = {};
    if (result.claudeCode) updates.claudeCode = { ...(settings?.claudeCode ?? {}), integration: true };
    if (result.cursor) updates.cursor = { ...(settings?.cursor ?? {}), integration: true };
    if (result.codex) updates.codex = { ...(settings?.codex ?? {}), integration: true };
    if (result.pi) updates.pi = { ...(settings?.pi ?? {}), integration: true };
    if (Object.keys(updates).length > 0) await ei.updateSettings(updates);

    // Set the detection signal LAST — the Import step's "continue" key only
    // unlocks once this is non-null, so by the time the user can advance,
    // the settings flags above are already guaranteed to be applied.
    setImportDetection(result);
  };

  // --- Done step actions ---
  const finishWizard = async () => {
    await stampInstalled(currentDataPath(), pkg.version);
    props.onDismiss();
  };

  useKeyboard((event: KeyEvent) => {
    const key = event.name;
    const s = step();

    if (s === "welcome") {
      event.preventDefault();
      setStep("install");
      return;
    }

    if (s === "install") {
      const phase = installPhase();
      if (phase === "confirm") {
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
        setStep("data-path");
      }
      return;
    }

    if (s === "data-path") {
      if (dpMode() === "view") {
        if (key === "c") {
          event.preventDefault();
          setDpInput("");
          setDpError(null);
          setDpMode("editing");
        } else if (key === "return") {
          event.preventDefault();
          goToProvider();
        }
        return;
      }

      // editing
      if (key === "return") {
        if (dpBusy()) return;
        event.preventDefault();
        setDpBusy(true);
        void validateAndApplyDataPath(dpInput()).finally(() => setDpBusy(false));
      } else if (key === "escape") {
        event.preventDefault();
        setDpMode("view");
        setDpError(null);
        setDpInput("");
      } else if (key === "backspace" || key === "delete") {
        event.preventDefault();
        setDpInput((v) => v.slice(0, -1));
      } else if (key === "space" && !event.ctrl && !event.meta) {
        event.preventDefault();
        setDpInput((v) => v + " ");
      } else if (key.length === 1 && !event.ctrl && !event.meta) {
        event.preventDefault();
        // Case-preserving: event.name is lowercased for letters regardless
        // of shift state; event.sequence carries the real typed character.
        setDpInput((v) => v + event.sequence);
      }
      return;
    }

    if (s === "provider") {
      const phase = providerPhase();
      if ((phase === "configured" || phase === "skipped") && key === "return") {
        event.preventDefault();
        goToImport();
      }
      // "checking"/"form": nothing to do here — ProviderForm owns its own
      // useKeyboard (gated by being mounted only in the "form" phase).
      return;
    }

    if (s === "import") {
      if (key === "return" && importDetection() !== null) {
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
      <box width={150} backgroundColor="#1a1a2e" borderStyle="single" borderColor="#586e75" padding={2} flexDirection="column">
        <text fg="#93a1a1">{`Step ${STEP_META[step()].index}/6: ${STEP_META[step()].name}`}</text>
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
                          <box width={22} flexDirection="row">
                            <text fg="#93a1a1">{provider.name}:</text>
                          </box>
                        )}
                      </For>
                    </box>
                  )}
                </For>
              </box>
              <text> </text>
              <text fg="#586e75">Press any key to get started</text>
            </box>
          </Match>

          <Match when={step() === "install"}>
            <box flexDirection="column">
              <Show when={installPhase() === "confirm"}>
                <text fg="#eee8d5">
                  {"Set up recommended Skills, hooks, and harness integrations (Claude Code, Cursor, Pi, ...)?\n\n" +
                    "Note: the MCP entry is removed — Skills replace it."}
                </text>
                <text> </text>
                <text fg="#586e75">(y/N)</text>
              </Show>
              <Show when={installPhase() === "running"}>
                <text fg="#eee8d5">Installing Skills, hooks, and harness integrations...</text>
              </Show>
              <Show when={installPhase() === "result"}>
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
              </Show>
            </box>
          </Match>

          <Match when={step() === "data-path"}>
            <box flexDirection="column">
              <Show when={dpMode() === "view"}>
                <text fg="#eee8d5">
                  {currentDataPath() === initialDataPath
                    ? `Data path: ${currentDataPath()}${currentDataPath() === resolveDataPath() ? " (default)" : ""}`
                    : `Using data path: ${currentDataPath()}`}
                </text>
                <Show when={dpShellNote()}>
                  <text fg="#b58900">{dpShellNote()}</text>
                </Show>
                <text> </text>
                <text fg="#586e75">c: change data path | Enter: continue</text>
              </Show>
              <Show when={dpMode() === "editing"}>
                <text fg="#eee8d5">{`New data path: ${dpInput()}_`}</text>
                <Show when={dpError()}>
                  <text fg="#dc322f">{dpError()}</text>
                </Show>
                <text> </text>
                <text fg="#586e75">Enter: validate | Esc: back</text>
              </Show>
            </box>
          </Match>

          <Match when={step() === "provider"}>
            <box flexDirection="column">
              <Show when={providerPhase() === "checking"}>
                <text fg="#586e75">Checking existing provider configuration...</text>
              </Show>
              <Show when={providerPhase() === "configured"}>
                <text fg="#859900">{providerSummary()}</text>
                <text> </text>
                <text fg="#586e75">Enter: continue</text>
              </Show>
              <Show when={providerPhase() === "skipped"}>
                <text fg="#b58900">Skipped — no AI provider configured.</text>
                <text> </text>
                <text fg="#586e75">Enter: continue</text>
              </Show>
              <Show when={providerPhase() === "form"}>
                <ProviderForm ei={ei} onDone={handleProviderDone} onCancel={handleProviderSkip} />
              </Show>
            </box>
          </Match>

          <Match when={step() === "import"}>
            <box flexDirection="column">
              <Show when={importDetection() === null}>
                <text fg="#586e75">Detecting available integrations...</text>
              </Show>
              <Show when={importDetection()}>
                {(detection: Accessor<ImportSourceDetection>) => (
                  <box flexDirection="column">
                    <text fg="#eee8d5">Ei will import over the next several minutes as you use it.</text>
                    <text> </text>
                    <Show
                      when={detection().claudeCode || detection().cursor || detection().codex || detection().pi}
                      fallback={<text fg="#93a1a1">No supported integrations detected.</text>}
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
                    <text> </text>
                    <text fg="#586e75">Enter: continue</text>
                  </box>
                )}
              </Show>
            </box>
          </Match>

          <Match when={step() === "done"}>
            <box flexDirection="column">
              <text fg="#859900">You're all set!</text>
              <text> </text>
              <text fg="#eee8d5">{`Data path: ${currentDataPath()}`}</text>
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
