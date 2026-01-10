# 0018: Warn on Public Repository Storage

**Status**: PENDING

## Summary

Detect when `EI_DATA_PATH` points to a public git repository and warn the user before writing sensitive personal data.

## Problem

Users might accidentally configure EI to store data in a public repository, exposing personal information (conversation history, concept maps with kinks/preferences/rants) to the internet.

## Proposed Solution

On startup, if `EI_DATA_PATH` is inside a git repository:

1. Attempt `git fetch` with no credentials
2. If fetch succeeds → repo is likely public → show warning
3. Require explicit confirmation to proceed

### Implementation

```typescript
function checkPublicRepo(dataPath: string): boolean {
  try {
    // Find git root
    const gitRoot = execSync("git rev-parse --show-toplevel", { 
      cwd: dataPath, 
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"]
    }).trim();
    
    // Try anonymous fetch
    const result = spawnSync("git", ["fetch", "--dry-run"], {
      cwd: gitRoot,
      env: { ...process.env, GIT_ASKPASS: "echo", GIT_TERMINAL_PROMPT: "0" },
      timeout: 10000
    });
    
    // If fetch succeeds without auth, likely public
    return result.status === 0;
  } catch {
    return false; // Not a git repo or can't determine
  }
}
```

### Warning Message

```
⚠️  WARNING: Public Repository Detected

EI data path appears to be inside a PUBLIC git repository.
Your personal data (conversations, preferences, concept maps) 
will be visible to anyone if committed and pushed.

Path: /Users/flare/public-notes/ei-data
Repo: https://github.com/flare576/public-notes

Are you sure you want to continue? [y/N]
```

### Bypass Option

- `EI_SKIP_REPO_CHECK=1` to disable (for CI, testing, or "I know what I'm doing")

## Acceptance Criteria

- [ ] Detect if data path is inside git repo
- [ ] Attempt anonymous fetch to detect public repos
- [ ] Show clear warning with repo URL if public
- [ ] Require explicit confirmation to proceed
- [ ] Provide env var to skip check
- [ ] Don't block on private repos or non-repos

## Value Statement

Prevent accidental exposure of deeply personal information. One prompt could save a divorce.

## Dependencies

- Ticket 0007 (configurable storage) - implements the path this validates

## Priority

**Medium** - Important safety feature, but not blocking initial functionality.

## Effort Estimate

Small-Medium: ~2-3 hours
