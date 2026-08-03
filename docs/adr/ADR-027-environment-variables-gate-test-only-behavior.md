# ADR-027: Environment Variables Gate Test-Only Behavior, Never Real Config

## Status

Accepted

## Date

2026-08-03

## Context

**This is a backfill ADR.** The decision it records was made in an investigation
(`.sisyphus/investigations/tui-test-network-blocking.md`, 2026-03-11, status COMPLETE) that predates
this `docs/adr/` directory. The investigation is preserved unmodified; this ADR is the retroactive
record of what its recommendation turned into once implemented.

### The problem the investigation found

`tui/src/context/ei.tsx` runs provider auto-detection at TUI startup whenever no LLM accounts are
configured. At the time of the investigation this was a direct `fetch("http://127.0.0.1:1234/v1/models", ...)`
(cited at lines 494-519, now refactored — see below) checking for a locally running LM Studio
instance. If an engineer happened to have LM Studio running on their own machine, a TUI E2E test
run would silently take a different code path — the "Welcome" onboarding overlay a test expected
would never appear, replaced by an auto-configured provider. `tui/tests/e2e/provider-command.test.ts`
had already hit this: its test acknowledged the problem with a try/catch and a
`console.log("Turn off your local LLM to run these tests")`, rather than solving it. Ei's own memory
of this period (topic *"E2E Test Regex Flag Bug & tui-test Infrastructure"*) independently
corroborates the same root cause: *"local LLM on port 1234 can interfere with `/model` no-provider
test, causing historical flakiness."*

The investigation asked a narrower question first: can `tui-test` (the TUI's PTY-based E2E
framework, `@microsoft/tui-test` v0.0.1-rc.5) block or intercept network requests the way
Playwright's `page.route()` does? It examined the package's type definitions and `TestOptions`
surface and found **no** network-layer API at all — `tui-test` operates purely at the terminal PTY
layer (spawn a process, read its terminal buffer, send keystrokes); it has no hook into the Bun
runtime executing inside the spawned process, and Bun itself has no built-in global `fetch` mock.
Blocking the request from the test side would require either a custom HTTP proxy (~200+ LOC,
estimated "significant" effort) or patching `globalThis.fetch`, which is Bun-specific and fragile
and, more fundamentally, would need to run *inside* the spawned subprocess — a process `tui-test`
has no code-injection access to, only PTY input/output and the `env`/`program.args` it launches
with.

The investigation's recommendation: **add the guard in application code**, gated by a single
environment variable read before the fetch, e.g.:

```typescript
if (process.env.EI_DISABLE_LOCAL_LLM_DETECTION === "true") return;
```

—set only inside a test's own `test.use({ env: { ... } })` block, never in a real user's
environment. The investigation was explicit that this is a compromise, not a clean win: it is
"application-level logic, not test infrastructure," a test-awareness seam that exists solely
because the test framework's own capabilities stopped short of the layer that needed control.

### What actually shipped

The literal `EI_DISABLE_LOCAL_LLM_DETECTION` boolean was never added — grepping current
`tui/src/context/ei.tsx` and `tui/tests/e2e/` for that name or for the raw
`http://127.0.0.1:1234` fetch finds nothing matching the investigation's exact proposal. What
shipped instead, about a month later, generalizes the same idea:

- **`tui/src/util/e2e-flags.ts`** (added in `e14a9b86`, 2026-04-10, *"add EI_E2E_MODE bitfield seam
  for environment-dependent tests"*) — a 14-line module that reads a single bitfield env var once
  at import time:

  ```typescript
  /**
   * EI_E2E_MODE — bitfield for test seams that can't be solved via data seeding.
   *
   * Use prime-power bits so combinations are unambiguous:
   *   1  — skip local LLM auto-detect (fetch to :1234/:11434)
   *   2  — skip cloud provider auto-detect (env var → /models checks)
   *   3  — flags 1 + 2 combined (skip all auto-detect)
   *
   * Production code should never set this. Tests pass it via env in test.use({ env: { EI_E2E_MODE: "1" } }).
   */
  const E2E_MODE = parseInt(process.env.EI_E2E_MODE ?? "0", 10);

  export const E2E_SKIP_LOCAL_DETECT  = (E2E_MODE & 1) !== 0;
  export const E2E_SKIP_CLOUD_DETECT  = (E2E_MODE & 2) !== 0;
  ```

- **`tui/src/util/provider-detection.ts`** (`4a071538`, 2026-05-01, *"add provider auto-detection
  logic and e2e skip flag"*) — the detection logic the investigation's own alternatives table had
  separately proposed ("Refactor detection: move detection logic to separate function, mock in
  tests") was extracted into `detectProviders(options, fetchFn)`, taking a
  `DetectProvidersOptions { skipLocalDetect?, skipCloudDetect?, env? }` object (lines 38-41) and an
  injectable `FetchFn` (default `fetch`, lines 272-274). `skipLocalDetect`/`skipCloudDetect` are
  checked as plain booleans inside the probe loops (lines 285, 309) — this function itself has no
  idea an env var exists.

- **`tui/src/context/ei.tsx:865-868`** — the only place `E2E_SKIP_LOCAL_DETECT`/
  `E2E_SKIP_CLOUD_DETECT` are imported and read, threading them into `detectProviders()`:

  ```typescript
  const { detected, statuses } = await detectProviders({
    skipLocalDetect: E2E_SKIP_LOCAL_DETECT,
    skipCloudDetect: E2E_SKIP_CLOUD_DETECT,
  });
  ```

So the shipped design is a **hybrid** of two of the investigation's four listed alternatives — the
recommended env-var guard, generalized to one bitfield covering both auto-detect paths instead of
one boolean for one path, *and* the "refactor detection into an injectable function" alternative it
had filed separately. The env var is read exactly once, at the narrowest possible point (a
7-line derivation module), and never touched again outside it; the actual detection code takes
plain options, not an env var name.

### Where it's set

- **`tui-test` E2E** (`tui/tests/e2e/*.test.ts`, e.g. `provider-command.test.ts:289-291,317-320`,
  `final-qa-onboarding-width-regression.test.ts:92-93,114-115`,
  `final-qa-onboarding-wizard-happy.test.ts:87-88`) — exclusively via
  `test.use({ env: { EI_E2E_MODE: "1" | "3" } })`, matching the investigation's own recommended
  pattern verbatim. This is the *only* channel available: `tui-test` spawns Bun as a genuine
  subprocess over a PTY, so `env` at process-spawn time is the sole communication surface between
  the test and code running inside it — there is no shared module graph to inject through.

- **`bun:test` unit tests** (`tui/tests/unit/*.test.tsx`, e.g. `onboarding-wiring-autodetect.test.tsx:9-14`,
  `onboarding-wiring.test.tsx:6-11`, `onboarding-overlay.test.tsx:13`,
  `final-qa-onboarding-rerun.test.tsx:19`) — via a direct `process.env.EI_E2E_MODE = "N"`
  assignment before any import that transitively touches `e2e-flags.ts` (module-load-time
  evaluation means the assignment must precede the first such import). These tests run in-process
  and *could* reach the code via other means, but the local-detect skip is still needed here
  because `detectProviders()`'s injectable `fetchFn` parameter is never threaded through the
  `ei.tsx` call site — a documented gap (`onboarding-wiring-autodetect.test.tsx:9-13`): *"cloud
  detection runs for real against a mocked global fetch — this is the only way to exercise
  ei.tsx's `detected.length > 0` branch, since detectProviders()'s fetch override is not threaded
  through the EiProvider bootstrap call site."* So these tests combine the env flag (skip local) with a
  direct `globalThis.fetch` mock (exercise cloud) — two different seams for two different
  auto-detect paths in the same file.

### The contrasting in-process seam

Where a test genuinely can reach into the code directly, the codebase does **not** reach for an env
var. `tui/src/components/OnboardingOverlay.tsx:39-48` injects both `detectIntegrations` and
`runHarnessInstall` as optional props, defaulting to the real implementations, with an explicit
comment on why: *"Injectable for tests; defaults to the real harness installer. Tests MUST use this
prop instead of `mock.module()` on harness-install.ts — that leaks process-wide ... and would
clobber harness-install.test.ts's own coverage of the real module."* This is the same underlying
problem class (production code makes a real side-effecting call that a test needs to intercept)
solved with dependency injection through the component tree instead of a global flag, because
these tests run in the same process as the component and can pass a prop.

The web app's E2E suite (`tests/e2e/`, Playwright, driving a browser against the real backend with
a per-worker mock LLM server) has **no equivalent env var anywhere in `web/src`** — confirmed by
grep. It needs none: Playwright's `page.route()`/mock-server model gives it real network
interception, so the class of problem this ADR is about — a test needing to stop a real network
call the framework has no native way to intercept — simply doesn't arise there. This is direct
evidence that the seam in `tui/` is forced by `tui-test`'s specific missing capability, not a
general principle the codebase applies uniformly.

## Decision

**A single, narrowly-scoped environment variable may gate test-only behavior in application code,
but only when the test framework has no other way to reach the code, and only under a fixed set of
constraints:**

1. **One bitfield, not one variable per behavior.** `EI_E2E_MODE` covers every current auto-detect
   skip with prime-power bits (`1`, `2`, `3 = 1|2`) rather than accumulating a new boolean env var
   per behavior — the investigation's own literal proposal (`EI_DISABLE_LOCAL_LLM_DETECTION`) would
   not have generalized to the second auto-detect path (cloud provider probing) without a second,
   differently-named variable.

2. **The guard lives in one derivation module, not scattered at call sites.**
   `tui/src/util/e2e-flags.ts` is the only file that reads `process.env.EI_E2E_MODE`. It exports
   plain booleans; nothing downstream — `provider-detection.ts`, `ei.tsx` — knows the env var's name
   or exists. This means `detectProviders()` itself stays a normal, testable function taking plain
   options, and the *only* test-awareness in the entire call chain is the one line where `ei.tsx`
   reads two exported constants.

3. **A documented, load-bearing "never in production" comment is the guardrail.** There is no lint
   rule or CI check enforcing this; the doc comment in `e2e-flags.ts` (*"Production code should
   never set this"*) is the only thing preventing a real deploy from ever setting `EI_E2E_MODE`.

4. **It is reserved for the layer a test cannot otherwise reach.** `tui-test`'s PTY-spawned
   subprocess has env/argv/PTY-stdio as its only surface — no shared module graph, no prop tree, no
   `mock.module()` that survives the process boundary. That is the one case in this codebase where
   an env-var seam is the *only* option, and it is exactly where the convention is used. Everywhere
   else the codebase can reach the code in-process, it injects instead (`OnboardingOverlay`'s
   `detectIntegrations`/`runHarnessInstall` props), and the web E2E suite needed no seam of this
   kind at all because Playwright's own interception already covers it.

5. **It is disjoint from real config vars in purpose, even where naming looks similar.**
   `EI_DATA_PATH` (`src/cli/retrieval.ts:29-34`, etc.) selects a real data location for both
   production and test use — it has a legitimate value for a real user. `EI_E2E_MODE` has no real
   value for a real user; setting it in a shipped build is a bug by definition, not a
   configuration choice.

## Alternatives Considered

### Alternative A: The literal `EI_DISABLE_LOCAL_LLM_DETECTION` boolean (the investigation's exact proposal)
- **Description**: One boolean env var, checked directly before the fetch call in `ei.tsx`.
- **Pros**: Minimal, single-purpose, exactly matches the investigation with no design risk.
- **Cons**: Does not generalize — cloud-provider auto-detect (env-var-keyed API key probes hitting
  real provider `/models` endpoints from tests) has the identical problem and would need its own,
  differently-named variable, and every future auto-detect path added after it would need another.
- **Why not chosen**: Superseded by the bitfield once the cloud-detect path needed the same
  treatment — one name to remember and grep instead of an open-ended set of single-purpose flags.

### Alternative B: HTTP proxy interception layer
- **Description**: A custom proxy server tests point at via `HTTP_PROXY`, blocking `:1234`
  specifically.
- **Cons**: The investigation's own effort estimate — "significant," 200+ LOC of test
  infrastructure with ongoing maintenance burden — for a problem the env-var guard solves in five
  lines.
- **Why not chosen**: No corresponding benefit over the guard; rejected in the investigation itself
  before implementation ever started.

### Alternative C: Mock `globalThis.fetch` exclusively, no env var at all
- **Description**: Patch the global fetch function inside the test process before the code under
  test runs.
- **Pros**: Works well for `bun:test` (used today for the cloud-detect path in
  `onboarding-wiring-autodetect.test.tsx`, `onboarding-wiring.test.tsx`) with zero application-code
  changes.
- **Cons**: Only works when the mock and the code under test share a process. `tui-test` spawns a
  separate Bun process over a PTY; there is no handle to patch `globalThis` on the other side of
  that boundary.
- **Why not chosen as the sole mechanism**: Doesn't solve the actual blocking case the investigation
  was filed to answer. Used today as a *complement* to `EI_E2E_MODE` in unit tests, not a
  replacement for it.

### Alternative D: Extend prop/DI injection (the `OnboardingOverlay` pattern) to provider detection
- **Description**: Thread an injectable `detectProvidersFn` prop through `EiProvider`, the same way
  `OnboardingOverlay` injects `runHarnessInstall`.
- **Pros**: Consistent with the codebase's stated preference for in-process DI over env-var
  branching; would also close the documented gap where `detectProviders()`'s `fetchFn` override
  isn't threaded through the `ei.tsx` call site.
- **Cons**: Solves the `bun:test` case but not the `tui-test` case — a PTY-spawned subprocess has no
  prop tree to inject through, so this alone cannot replace `EI_E2E_MODE` for E2E coverage.
- **Why not chosen as the sole mechanism**: Necessary condition, not sufficient. Nothing here rules
  out adopting it *in addition* to close the gap noted in Consequences below — it just wasn't done
  as of this ADR.

## Consequences

### Positive

- One greppable, documented name (`EI_E2E_MODE`) instead of open-ended env-var sprawl every time a
  new startup-time real-network call needs a test bypass.
- The actual root cause the investigation diagnosed — `tui-test` having no `route()`/`intercept()`
  equivalent — is solved for both current auto-detect paths without needing test-side network
  infrastructure of any kind.
- `provider-command.test.ts`'s prior "turn off your local LLM to run these tests" try/catch
  workaround is no longer the only defense; a developer with LM Studio running no longer gets
  divergent, silently-passing-or-failing E2E behavior.
- The guard's blast radius is two files (`e2e-flags.ts`, its one read site in `ei.tsx`) plus test
  call sites — nothing about the data model, on-disk format, or any other subsystem depends on it.

### Negative

- The investigation's literal proposal (`EI_DISABLE_LOCAL_LLM_DETECTION`) does not exist anywhere
  in current source; anyone searching the investigation file for that exact name will find nothing
  — this ADR is the only place that bridges "what was recommended" to "what shipped."
- `ei.tsx`'s call site threads `skipLocalDetect`/`skipCloudDetect` but not a `fetchFn` override, so
  unit tests covering the cloud-detect branch still resort to mutating `globalThis.fetch` directly
  rather than using one clean seam — two different test-control mechanisms cover two halves of the
  same function call.
- No lint rule or CI check would catch `EI_E2E_MODE` (or any future bit) leaking into a real deploy
  path; the doc comment is the entire guardrail, the same category of unenforced-by-tooling risk
  ADR-014 names for its own field-repurposing decision.

### Risks

- **Bitfield growth has no schema.** Two of an open-ended set of bits are defined today (`1`, `2`).
  Nothing prevents a future auto-detect path from claiming bit `4`, `8`, etc. indefinitely; the doc
  comment in `e2e-flags.ts` is the only source of truth for what each bit means, and nothing forces
  it to be kept current as bits are added.
- **The convention is currently scoped entirely to `tui/`.** If the web E2E suite (root
  `tests/e2e/`, Playwright) ever needs a genuine process-boundary seam of its own — a spawned CLI
  subprocess test, for instance — the `tui-test`-specific justification recorded here doesn't
  automatically transfer; whoever hits that case would need to re-derive from this ADR whether a new
  env var is actually warranted, or whether Playwright's native interception already covers it (as
  it does today for every existing web E2E test).

## Reversibility

High. `EI_E2E_MODE` is additive and its entire surface is grep-complete: one derivation module, one
consumer read site, and a bounded set of test call sites. Removing or renaming it touches no data
model, no on-disk format, and no production code path (by design — the doc comment states
production code should never read it, and nothing in `src/` or `web/src` does).

## References

- `.sisyphus/investigations/tui-test-network-blocking.md` — the source investigation (2026-03-11,
  COMPLETE), preserved unmodified
- `tui/src/util/e2e-flags.ts` — the `EI_E2E_MODE` bitfield definition and its
  "production code should never set this" guardrail
- `tui/src/context/ei.tsx:865-868` — the sole consumer call site, threading the derived booleans
  into `detectProviders()`
- `tui/src/util/provider-detection.ts:38-41,272-331` — `DetectProvidersOptions`, the injectable
  `FetchFn` parameter, and `detectProviders()`'s use of `skipLocalDetect`/`skipCloudDetect`
- `tui/src/components/OnboardingOverlay.tsx:39-48` — the contrasting in-process DI seam
  (`detectIntegrations`/`runHarnessInstall` props) used where the test framework can reach the code
  directly, and its comment on why `mock.module()` was rejected
- `tui/tests/e2e/provider-command.test.ts:289-291,317-320` — `tui-test` usage via
  `test.use({ env: { EI_E2E_MODE: "1" } })`
- `tui/tests/unit/onboarding-wiring-autodetect.test.tsx:9-14` — `bun:test` usage via direct
  `process.env.EI_E2E_MODE` assignment, plus the documented `fetchFn`-not-threaded-through gap
- `tests/e2e/AGENTS.md` — the web app's Playwright E2E conventions; no equivalent env-var seam
  exists there, corroborating that this pattern is a `tui-test`-specific accommodation rather than
  a general one
- git `e14a9b86` (2026-04-10) — *"test(e2e): add EI_E2E_MODE bitfield seam for
  environment-dependent tests"*
- git `4a071538` (2026-05-01) — *"feat(tui): add provider auto-detection logic and e2e skip flag"*
