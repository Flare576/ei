# 0138: CLI Distribution (npm publish)

**Status**: PENDING
**Depends on**: None
**Priority**: High (V1.2 release blocker)

## Summary

Make Ei installable via `npm install -g @flare576/ei` (or `bun install -g`) so both humans and AI agents can use it. CLI-first architecture—no MCP server mode needed.

## Background

### Why CLI > MCP for AI Agents

Tom Saleeba's insight (RNP #ai-tools, Feb 13):
> "I've been using an MCP CLI tool that wraps MCP server calls... and I think the CLI solution is way better."

Key advantages:
- **Token efficiency**: Dynamic discovery (`ei --help`) vs 47k tokens for static MCP schemas
- **Zero config for agents**: If they can run shell commands, they can use Ei
- **Composability**: Unix pipes, jq, scripts
- **Human/agent parity**: Same commands work for both

### Current State

- CLI exists at `src/cli.ts` with commands: `quotes`, `facts`, `traits`, `people`, `topics`
- Uses Bun-specific APIs (`Bun.argv`, `Bun.spawn`, `Bun.file`)
- `package.json` bin points to `.ts` file (works locally, not for npm)
- `.opencode/tools/ei.ts` wraps CLI for OpenCode (project-local only)

## Acceptance Criteria

### Package Configuration

- [ ] `package.json` bin entry points to compiled JS: `"bin": { "ei": "./dist/cli.js" }`
- [ ] Add `"engines": { "bun": ">=1.0.0" }` to document runtime requirement
- [ ] Add build script: `"build:cli": "bun build src/cli.ts --outfile dist/cli.js --target bun"`
- [ ] Add `"prepublishOnly": "npm run build:cli"` to ensure dist is current
- [ ] Scope package name: `@flare576/ei` (you own the npm org)
- [ ] Add `"files": ["dist", "README.md", "LICENSE"]` to control what's published

### CLI Compatibility

- [ ] Replace `Bun.argv` with `process.argv` (works in both Bun and Node)
- [ ] Replace `Bun.file()` with `fs/promises` for file reading
- [ ] Keep `Bun.spawn` for TUI launch (acceptable—TUI requires Bun anyway)
- [ ] Shebang: `#!/usr/bin/env bun` (explicit Bun requirement)

### Agent-Friendly Output

- [ ] All commands support `--help` flag with clear usage examples
- [ ] All commands output JSON by default (already done)
- [ ] Add `--format` flag for future text/markdown options
- [ ] Exit codes: 0 = success, 1 = error (already done)

### Documentation

- [ ] README.md installation section:
  ```markdown
  ## Installation
  
  ### Prerequisites
  Ei requires [Bun](https://bun.sh) runtime:
  ```bash
  curl -fsSL https://bun.sh/install | bash
  ```
  
  ### Install Ei
  ```bash
  npm install -g @flare576/ei
  # or
  bun install -g @flare576/ei
  ```
  ```

- [ ] README.md usage section for AI agents:
  ```markdown
  ## For AI Agents (OpenCode, Claude, etc.)
  
  Ei exposes a CLI that AI agents can call directly:
  
  ```bash
  # Query the knowledge base
  ei facts --snippet "work preferences"
  ei people --snippet "family"
  ei topics --snippet "current projects"
  
  # Get help on any command
  ei --help
  ei facts --help
  ```
  
  All commands output JSON for easy parsing.
  ```

### Publishing

- [ ] `npm publish --access public` (scoped packages are private by default)
- [ ] Verify installation: `npm install -g @flare576/ei && ei --help`
- [ ] Test from fresh machine (or Docker container)

## Technical Design

### File Changes

```
src/cli.ts           # Replace Bun.argv → process.argv
src/cli/retrieval.ts # Replace Bun.file → fs/promises
package.json         # bin, engines, files, scripts
README.md            # Installation + usage docs
dist/cli.js          # Built output (gitignored)
```

### package.json Changes

```jsonc
{
  "name": "@flare576/ei",
  "version": "1.2.0",
  "bin": {
    "ei": "./dist/cli.js"
  },
  "engines": {
    "bun": ">=1.0.0"
  },
  "files": [
    "dist",
    "README.md", 
    "LICENSE"
  ],
  "scripts": {
    "build:cli": "bun build src/cli.ts --outfile dist/cli.js --target bun",
    "prepublishOnly": "npm run build:cli"
  }
}
```

### CLI Changes (minimal)

```typescript
// src/cli.ts
#!/usr/bin/env bun

// Before
const args = Bun.argv.slice(2);

// After  
const args = process.argv.slice(2);
```

```typescript
// src/cli/retrieval.ts
import { readFile } from "fs/promises";

// Before
const file = Bun.file(filePath);
const text = await file.text();

// After
const text = await readFile(filePath, "utf-8");
```

## What We're NOT Doing

### MCP Server Mode (Skip)

Per research, CLI-first is superior for local tools. MCP is better suited for hosted services.

If users explicitly request MCP mode in the future, we can add:
```bash
ei serve-mcp --stdio  # MCP server over stdio
```

But this is unlikely—agents with shell access prefer CLI.

### Node.js Compatibility (Skip)

Requiring Bun is acceptable:
- Bun is mainstream in 2026
- Single runtime simplifies maintenance
- TUI requires Bun anyway (OpenTUI)
- One-line install: `curl -fsSL https://bun.sh/install | bash`

### Compiled Binaries (Skip for V1)

`bun build --compile` produces standalone binaries but:
- ~90MB filesize
- Platform-specific builds needed
- Complicates npm distribution

Future consideration for GitHub releases alongside npm.

## OpenCode Integration

After npm publish, users have two options:

### Option A: Direct CLI (Recommended)

Agent calls `ei` directly via shell. Works automatically if `ei` is on PATH.

Document in project AGENTS.md:
```markdown
## Ei Integration

Query the human's knowledge base:
- `ei facts --snippet "..."` - Factual information
- `ei people --snippet "..."` - People in their life  
- `ei topics --snippet "..."` - Topics of interest
- `ei traits --snippet "..."` - Personality traits
- `ei quotes --snippet "..."` - Memorable quotes

Use `ei --help` for full documentation.
```

### Option B: OpenCode Tools (Optional)

For projects wanting explicit tool definitions, copy `.opencode/tools/ei.ts` to project or global config. But this is unnecessary if agent can just call `ei` directly.

## Verification

```bash
# Build
npm run build:cli

# Test locally
./dist/cli.js --help
./dist/cli.js facts --snippet "work"

# Publish (dry run first)
npm publish --dry-run
npm publish --access public

# Test install
npm install -g @flare576/ei
ei --help
ei facts --snippet "test"
```

## Notes

- Package name `ei` is likely taken on npm, hence `@flare576/ei`
- The `ei` binary name is short and memorable
- Version 1.2.0 aligns with "V1.2 - Ei & Ei Online" release
- Existing homebrew symlink at `/opt/homebrew/bin/ei` may conflict—document or handle

## Future: Homebrew Distribution

Flare has an existing homebrew tap: https://github.com/Flare576/homebrew-scripts

Could add an `ei.rb` formula there for `brew install flare576/scripts/ei`. This would require Bun as a dependency. See existing formulas in that tap (e.g., `vroom.rb`) for patterns.

## Related

- 0136: Unified Context Query (adds `ei context` command)
- 0137: Semantic Prompt Context (internal use of same retrieval)
