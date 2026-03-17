---
description: Cut a new release - bumps version, commits, tags, and pushes
---

Cut a new release for the ei-tui package.

Current version in package.json:
!`node -e "const p = require('./package.json'); console.log(p.version)"`

Current git status:
!`git status --short`

Recent tags:
!`git tag -l --sort=-version:refname | head -5`

## Pre-Flight Checks (MANDATORY — do not skip)

Before touching package.json or creating any tag, run ALL of these and confirm each passes:

**1. Lockfile must be in sync with package.json**
```
npm ci
```
If this fails: the lockfile is out of sync with `package.json` (e.g. new packages were added via bun but `package-lock.json` was never regenerated). Fix with `npm install`, commit the updated `package-lock.json`, then re-run the release. This is what broke CI from v0.2.1 through v0.3.1.

**2. Working tree must be clean**
```
git status --short
```
If anything is shown: STOP. Ask Flare how to handle the uncommitted changes.

**3. Must be on main, up to date with origin**
```
git branch --show-current
git fetch origin && git status
```
If not on main or behind origin: STOP. Do not release from a branch or stale checkout.

**4. Unit tests must pass**
```
npm test
```
If any test fails: STOP. Do not release with failing tests.

**5. Core TypeScript build must pass (`tsc` — catches type errors Vite/Bun miss)**
```
npm run build
```
If build fails: STOP. Fix the type errors before releasing. This is what broke v0.1.15.

**6. Web build must succeed — BOTH `tsc` and Vite (catches different classes of errors)**
```
cd web && npx tsc --noEmit && npx vite build 2>&1 | tail -5
```
If either fails: STOP. Fix before releasing. `tsc --noEmit` catches dead-code/type errors (`noUnusedLocals`) that Vite's lenient bundler misses. `vite build` catches bundler errors that `tsc` misses. Both must pass — this is what the CI pipeline runs. (v0.1.9 = vite; v0.1.18 deploy = tsc)
**7. Web E2E tests must pass**
```
npm run test:e2e
```
If any E2E test fails: STOP. Do not release with failing E2E tests.
Only proceed to the steps below after ALL seven checks pass.

---

## Instructions

The user may have provided a version as $ARGUMENTS. If not, suggest the next patch version based on the current version above.

**Steps to perform:**

1. **Confirm the target version** with the user before making any changes (unless $ARGUMENTS explicitly provides one like "0.1.4").

2. **Bump version** in `package.json` — update the `"version"` field to the new version.

3. **Commit** the change:
   ```
   git commit -am "chore: bump to v{VERSION}"
   ```

4. **Create an annotated tag**:
   ```
   git tag v{VERSION}
   ```

5. **Push** the commit and then the tag:
   ```
   git push && git push --tags
   ```

GitHub Actions will pick up the tag and publish to npm automatically. The tag also triggers the CI test suite — if tests fail there, the publish job will not run.

**Do NOT proceed if there are uncommitted changes unrelated to the version bump** — flag them and ask the user how to handle them first.
