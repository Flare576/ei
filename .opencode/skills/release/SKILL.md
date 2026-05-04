---
name: release
description: "Load when cutting a new ei-tui release — version bump, tag, npm publish. Runs the full pre-flight checklist interactively with Flare confirming each gate before proceeding. Triggers: 'cut a release', 'bump the version', 'tag and publish', 'release v0.x.y'."
---

# Release Skill — ei-tui

You are running a release for the `ei-tui` package. This is a **collaborative, step-by-step process** — you run each check, report the result to Flare, and confirm before proceeding. Do not batch steps silently.

**Always use the `git-master` skill for all git operations.**

---

## Step 0: Orient

Run these in parallel and report all results to Flare before doing anything else:

```bash
node -e "const p = require('./package.json'); console.log(p.version)"
git branch --show-current
git status --short
git tag -l --sort=-version:refname | head -5
```

Suggest the next patch version (e.g. 0.3.7 → 0.3.8) unless Flare already provided a target.

**Confirm the target version with Flare before touching anything.**

---

## Pre-Flight Checklist (run in order — stop and report on any failure)

### Check 1 — Lockfile sync
```bash
npm ci
```
If this fails: the lockfile is out of sync with `package.json`. Fix with `npm install`, commit the updated `package-lock.json`, then re-run. This broke CI from v0.2.1 through v0.3.1.

### Check 2 — Clean working tree
```bash
git status --short
```
If anything shows up: STOP. Ask Flare how to handle the uncommitted changes before proceeding.

### Check 3 — On main, up to date
```bash
git branch --show-current
git fetch origin && git status
```
If not on `main` or behind origin: STOP. Do not release from a branch or stale checkout.

### Check 4 — Unit tests
```bash
npm test
```
If any test fails: STOP.

### Check 5 — Structural invariants
```bash
bash ci/structural-checks.sh
```
If any check fails: STOP. These are fast grep-based rules for architectural patterns (prompt builder purity, overlay keyboard registration, etc.). A failure here means a convention was violated that TypeScript won't catch.

### Check 6 — Core TypeScript build
```bash
npm run build
```
If this fails: STOP. Fix type errors before releasing. This is what broke v0.1.15.

### Check 7 — Web build (BOTH tsc and Vite — they catch different errors)
```bash
cd web && npx tsc --noEmit && npx vite build 2>&1 | tail -5
```
Both must pass independently:
- `tsc --noEmit` catches `noUnusedLocals` dead-code violations Vite silently ignores
- `vite build` catches bundler/JSX/circular-import errors tsc misses

This is what CI runs. (v0.1.9 = vite caught it; v0.1.18 deploy failure = tsc caught it)

### Check 8 — Web E2E tests
```bash
CI= npm run test:e2e > .sisyphus/evidence/e2e-pre-release.txt 2>&1; echo "EXIT: $?"
```
**`CI=` is required.** The playwright config uses `reuseExistingServer: !process.env.CI` — if `CI` is set (as it is in the agent's default env), Playwright refuses to reuse Flare's running dev server and fails with a port conflict instead of running the tests.

Save to file, then grep the summary:
```bash
grep -E "(passed|failed)" .sisyphus/evidence/e2e-pre-release.txt | tail -5
```
If any test fails: STOP.

### Check 9 — TUI E2E tests
CI cannot run these — `tui-e2e-experimental.yml` is manual-trigger only because `tui-test` requires Node 20 and native PTY bindings that break on newer versions. The skill runs them locally where Node 20 is available via nvm.

```bash
cd tui && npm run test:e2e > ../.sisyphus/evidence/tui-e2e-pre-release.txt 2>&1; echo "EXIT: $?"
```

The `npm run test:e2e` script in `tui/package.json` handles the `nvm use 20` switch automatically. Save to file, then check:
```bash
grep -E "(passed|failed|FAILED)" ../.sisyphus/evidence/tui-e2e-pre-release.txt | tail -5
```
If any test fails: STOP.

### Check 10 — Prompt eval coverage

Only runs if prompt files changed since the last tag. First, check:

```bash
git diff $(git describe --tags --abbrev=0)..HEAD --name-only -- src/prompts/
```

**If nothing changed in `src/prompts/`: skip this check entirely.**

If prompts did change:

**10a — Identify changed prompts and their evals**

Show Flare:
1. Which prompt files changed (from the diff above)
2. Which eval files exist for those prompts — convention is `tests/evals/<prompt-name>.eval.ts` matching the prompt filename (e.g. `topic-scan.ts` → `topic-scan.eval.ts`)
3. The actual diff of each changed prompt section so Flare can see what moved

```bash
git diff $(git describe --tags --abbrev=0)..HEAD -- src/prompts/
```

**10b — Human adequacy review (mandatory pause)**

Present the mapping and ask Flare:

> "These prompts changed: [list]. These evals cover them: [list]. Any gaps or evals that don't cover the actual change? Say yes to continue, no to stop and write more evals first."

**Do not proceed past this point without an explicit yes from Flare.** This is intentionally a human judgment call — eval adequacy is too contextual to automate reliably right now.

**10c — Run the relevant evals**

Run only the evals that map to changed prompts. Use the file-match argument to target specific suites:

```bash
npm run test:evals -- <file-match> > .sisyphus/evidence/evals-pre-release.txt 2>&1; echo "EXIT: $?"
```

For example, if `person-scan.ts` and `topic-scan.ts` changed:
```bash
npm run test:evals -- person-scan >> .sisyphus/evidence/evals-pre-release.txt 2>&1
npm run test:evals -- topic-scan >> .sisyphus/evidence/evals-pre-release.txt 2>&1
```

Check results:

```bash
grep -E "(passed|failed|FAILED|✓|✗)" .sisyphus/evidence/evals-pre-release.txt | tail -20
```

These run against local Gemma (with thinking enabled by default) and take roughly as long as both E2E suites combined — budget 10-15 minutes. If any eval fails: STOP.

**After all 10 checks pass, report a clean summary to Flare and ask for explicit go-ahead before cutting the release.**

---

## Release Steps (only after Flare confirms)

1. **Bump version** in `package.json` — update the `"version"` field.

2. **Commit**:
   ```bash
   git add package.json
   git commit -m "chore: bump to v{VERSION}"
   ```

3. **Tag**:
   ```bash
   git tag v{VERSION}
   ```

4. **Push commit then tags**:
   ```bash
   git push && git push --tags
   ```

GitHub Actions picks up the tag and publishes to npm via OIDC (no stored secrets). The tag also re-runs the full CI suite — if tests fail there, the publish job will not run.

---

## Release Notes (write while CI runs — don't wait for green)

### 1. Collect the commits

```bash
git log $(git describe --tags --abbrev=0 HEAD^)..HEAD --oneline
```

Skip: merge commits, `chore: bump to v*` commits.

### 2. Check if this is the first GitHub Release

```bash
gh release list --limit 1
```

### 3. Draft the body

**If no prior GitHub Releases exist**, open with:

> 👋 Ohai, didn't see you there! Ei has been shipping quietly since v0.1.0 — check the [README](../README.md) for background on what it is and how to get started. These notes cover what's new in *this* release specifically.

**For all releases**, group into sections — write for a human reader, not a git log. Use the flare-voice skill for tone: direct, punchy, occasionally self-deprecating. Skip anything that's purely internal scaffolding.

```markdown
## What's New
<!-- feat commits — describe the user-facing change, not the implementation -->

## Fixed
<!-- fix commits — say what was wrong and what it felt like, briefly -->

## Under the Hood
<!-- refactor/test/chore — one short line each, or just skip entirely if boring -->
```

### 4. Create the release

Write the body to a temp file, then:

```bash
gh release create v{VERSION} \
  --title "v{VERSION}" \
  --notes-file /tmp/ei-release-notes.md
```

### 5. Confirm CI goes green

```bash
gh run list --limit 3
```

The publish job gates on CI — if tests fail, npm doesn't get updated even though the tag exists.

---

## Hard Rules

- Never skip a preflight check, even if "we just ran tests" — this includes Check 9 (TUI E2E) and Check 10 (prompt evals), neither of which CI runs
- Never tag from a branch — must be on `main`
- Never tag with uncommitted changes unrelated to the version bump
- Always confirm the target version with Flare before bumping `package.json`
- Always confirm all checks passed before tagging
- Use `git-master` skill for every git operation
