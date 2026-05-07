#!/usr/bin/env bash
# Structural invariant checks — fast grep-based fitness functions.
# Exits 1 if any check fails. All checks run (no early exit) so you see all failures at once.
set -uo pipefail

FAILURES=0
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

pass() { echo "  ✓ $1"; }
fail() { echo "  ✗ $1"; echo "    $2"; ((FAILURES++)) || true; }

echo "=== Structural Checks ==="
echo ""

# ------------------------------------------------------------------
# 1. Prompt builders must be synchronous (no async/await)
# ------------------------------------------------------------------
echo "Prompt builders — synchronous"
ASYNC=$(grep -rn "async function\|async (" "$ROOT/src/prompts/" --include="*.ts" 2>/dev/null || true)
if [ -z "$ASYNC" ]; then pass "no async in src/prompts/"; else fail "async found in src/prompts/" "$ASYNC"; fi

AWAIT=$(grep -rn "\bawait\b" "$ROOT/src/prompts/" --include="*.ts" 2>/dev/null || true)
if [ -z "$AWAIT" ]; then pass "no await in src/prompts/"; else fail "await found in src/prompts/" "$AWAIT"; fi

echo ""

# ------------------------------------------------------------------
# 2. Prompt builders must not do computation (filter/map/sort = logic creep)
# ------------------------------------------------------------------
echo "Prompt builders — pure (no computation)"
# .filter(Boolean) is allowed — string-building pattern (.filter(Boolean).join(...))
# .filter((name): ...) is allowed — TypeScript type guard, not data logic
# .sort() is allowed — presentation ordering (AGENTS.md violation list: filter/map only)
# .filter(predicate) with business logic is a violation — belongs in the Processor
COMPUTE=$(grep -rn "\.filter(\|\.reduce(" "$ROOT/src/prompts/" --include="*.ts" 2>/dev/null \
  | grep -v "filter(Boolean)" \
  | grep -v "filter((name)" \
  | grep -v "src/prompts/trait-utils.ts" \
  || true)
if [ -z "$COMPUTE" ]; then pass "no data computation in src/prompts/"; else fail "computation found in src/prompts/ (move logic to Processor)" "$COMPUTE"; fi

echo ""

# ------------------------------------------------------------------
# 3. No hardcoded prompt strings outside src/prompts/
#    Exception: queue-processor.ts (JSON repair heuristic — see src/prompts/AGENTS.md)
# ------------------------------------------------------------------
echo "Prompt strings — stay in src/prompts/"
ESCAPED=$(grep -rn "const system\s*=" "$ROOT/src/core/handlers/" "$ROOT/src/core/orchestrators/" --include="*.ts" 2>/dev/null || true)
if [ -z "$ESCAPED" ]; then pass "no escaped prompt strings in handlers/orchestrators"; else fail "prompt strings outside src/prompts/" "$ESCAPED"; fi

echo ""

# ------------------------------------------------------------------
# 4. All *Overlay.tsx components must register with the keyboard context
# ------------------------------------------------------------------
echo "TUI Overlays — keyboard registration"
MISSING=$(find "$ROOT/tui/src/components" -name "*Overlay.tsx" | xargs grep -L "setOverlayActive" 2>/dev/null || true)
if [ -z "$MISSING" ]; then pass "all Overlay components call setOverlayActive"; else fail "Overlay components missing setOverlayActive" "$MISSING"; fi

echo ""

# ------------------------------------------------------------------
# 5. Prompt module structure — every subdirectory needs types.ts + index.ts
# ------------------------------------------------------------------
echo "Prompt module structure"
MISSING_FILES=""
for dir in "$ROOT/src/prompts"/*/; do
  [ -d "$dir" ] || continue
  name=$(basename "$dir")
  [ -f "$dir/types.ts" ] || MISSING_FILES="$MISSING_FILES\n  $name/types.ts missing"
  [ -f "$dir/index.ts" ] || MISSING_FILES="$MISSING_FILES\n  $name/index.ts missing"
done
if [ -z "$MISSING_FILES" ]; then pass "all prompt subdirs have types.ts + index.ts"; else fail "prompt subdir missing required files" "$MISSING_FILES"; fi

echo ""

# ------------------------------------------------------------------
# 6. Handlers must not silently drop queue items
#    console.error() + return without throw = data graveyard.
#    If a handler can't process an item, it must throw so the
#    retry/DLQ machinery fires. (Bug: person records silently dropped
#    when result.name was missing after prompt schema change.)
# ------------------------------------------------------------------
echo "Handlers — no silent drops (console.error + return without throw)"
# All handlers must throw on unrecoverable error — no queue item is ok to drop silently.
# The processor's error path surfaces failures to the user via onError.
# Legitimate flow-control returns (e.g. should_respond=false, no changes needed) use
# console.log, not console.error — this check only flags console.error + return pairs.
ALL_HANDLERS=$(ls "$ROOT"/src/core/handlers/*.ts | grep -v 'index\.ts\|utils\.ts')
SILENT_DROPS=$(for file in $ALL_HANDLERS; do
    python3 - "$file" <<'PYEOF'
import sys, re
content = open(sys.argv[1]).read()
blocks = re.findall(r'console\.error\([^)]*\)[^}]{0,200}?return;', content, re.DOTALL)
bad = [b for b in blocks if 'throw' not in b]
if bad:
    print(sys.argv[1])
PYEOF
  done || true)
if [ -z "$SILENT_DROPS" ]; then pass "no silent drops in extraction handlers"; else fail "extraction handlers silently drop queue items — throw instead of return" "$SILENT_DROPS"; fi

echo ""

# ------------------------------------------------------------------
# 7. Extraction update handlers must type-guard description before use
#    LLMs occasionally return boolean true for description fields.
#    Handlers must use typeof check before accepting description as a string,
#    not raw truthiness (!result.description). This prevents boolean "true"
#    from being stored as a description or causing spurious validation failures.
# ------------------------------------------------------------------
echo "Handlers — description field type-guarded in update handlers"
UPDATE_HANDLERS="$ROOT/src/core/handlers/human-matching.ts"
UNGUARDED=$(grep -n "result\.description" "$UPDATE_HANDLERS" 2>/dev/null \
  | grep -v "typeof result\.description" \
  | grep -v "resolvedDescription" \
  | grep -v "!!result\.description" \
  || true)
if [ -z "$UNGUARDED" ]; then pass "description type-guarded in update handlers"; else fail "raw result.description used without typeof guard in update handlers" "$UNGUARDED"; fi

echo ""

# ------------------------------------------------------------------
# 8. Extraction pipeline — every queue_enqueue in human-extraction.ts
#    must carry extraction_model in its data block (literal key or via
#    ...options spread). Without it, downstream handlers can't forward
#    the model and silently fall back to the user's default.
#    room-extraction.ts is intentionally excluded — rooms have no
#    per-extraction model setting.
# ------------------------------------------------------------------
echo "Extraction pipeline — extraction_model forwarded in every queue_enqueue"
MISSING_EXTRACTION_MODEL=$(python3 - "$ROOT/src/core/orchestrators/human-extraction.ts" <<'PYEOF'
import re, sys

content = open(sys.argv[1]).read()
lines = content.splitlines()
violations = []

for i, line in enumerate(lines):
    if 'queue_enqueue(' in line:
        block = '\n'.join(lines[i:i+30])
        data_match = re.search(r'data:\s*\{(.*?)\}[,\s]*\}', block, re.DOTALL)
        if data_match:
            data_content = data_match.group(1)
            has_literal = 'extraction_model' in data_content
            has_options_spread = '...options' in data_content
            has_context_spread = '...context' in data_content
            has_effective_options_spread = '...effectiveOptions' in data_content
            if not (has_literal or has_options_spread or has_context_spread or has_effective_options_spread):
                next_step = re.search(r'next_step:\s*LLMNextStep\.(\w+)', block)
                ns = next_step.group(1) if next_step else '?'
                violations.append(f"  line {i+1}: {ns}")

if violations:
    for v in violations:
        print(v)
PYEOF
)
if [ -z "$MISSING_EXTRACTION_MODEL" ]; then
  pass "extraction_model forwarded in all human-extraction.ts queue_enqueue calls"
else
  fail "queue_enqueue missing extraction_model in data (human-extraction.ts)" "$MISSING_EXTRACTION_MODEL"
fi

echo ""

# ------------------------------------------------------------------
# 9. No hardcoded "Human" speaker labels in prompt builders or UI components
#    The human's display name should come from the lookup chain:
#      settings.name_display || facts["Nickname/Preferred Name"] || "Human"
#    Hardcoded "Human" as a speaker label is the anti-pattern this guards.
#    Scope: src/prompts/ (prompt text), tui/src/components/, web/src/components/
#    Note: "Human" in prose instructions, type checks, or structural headers is fine —
#    only rendered speaker attribution contexts are in scope here.
# ------------------------------------------------------------------
echo "Human display name — no hardcoded speaker labels"
HARDCODED_HUMAN=$(grep -rn '"Human"' \
  "$ROOT/src/prompts/" \
  "$ROOT/tui/src/components/" \
  "$ROOT/web/src/components/" \
  --include="*.ts" --include="*.tsx" 2>/dev/null \
  | grep -v '|| "Human"' \
  | grep -v 'createSignal("Human")' \
  | grep -vE ':\s+"Human"[;,]?$' \
  || true)
if [ -z "$HARDCODED_HUMAN" ]; then
  pass "no hardcoded 'Human' speaker labels in prompts or UI components"
else
  fail "hardcoded 'Human' speaker label found — use dynamic name chain (name_display || Nickname/Preferred Name || 'Human')" "$HARDCODED_HUMAN"
fi

echo ""

# ------------------------------------------------------------------
# 10. TUI commands — catch blocks with showNotification error must also log
#     If a catch block surfaces an error to the user via showNotification(..., "error"),
#     it must also call logger.error/warn so the full stack trace goes to tui.log.
#     Silent notification-only catches bury the stack and make debugging impossible.
#     Scope: tui/src/ (commands, util, context)
# ------------------------------------------------------------------
echo "TUI catch blocks — showNotification error must be paired with logger call"
UNLOGGED_CATCHES=$(python3 << 'PYEOF'
import re, os, sys

src = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "tui", "src")
violations = []

for root, dirs, files in os.walk(src):
    dirs[:] = [d for d in dirs if d != "node_modules"]
    for fname in files:
        if not fname.endswith((".ts", ".tsx")):
            continue
        fpath = os.path.join(root, fname)
        with open(fpath) as f:
            lines = f.readlines()

        i = 0
        while i < len(lines):
            if re.search(r'\bcatch\s*\(', lines[i]):
                catch_line = i + 1
                brace_depth = 0
                block_lines = []
                j = i
                while j < len(lines):
                    for ch in lines[j]:
                        if ch == '{': brace_depth += 1
                        elif ch == '}': brace_depth -= 1
                    block_lines.append(lines[j])
                    if brace_depth < 0 or (brace_depth == 0 and j > i):
                        break
                    j += 1

                block = "".join(block_lines)
                has_notif_error = bool(re.search(r'showNotification\s*\(.*"error"', block))
                has_logger = bool(re.search(r'logger\.(error|warn|debug|info)\s*\(', block))

                if has_notif_error and not has_logger:
                    rel = os.path.relpath(fpath, src)
                    violations.append(f"  {rel}:{catch_line}")

                i = j
            i += 1

for v in violations:
    print(v)
PYEOF
)
if [ -z "$UNLOGGED_CATCHES" ]; then
  pass "all TUI catch blocks with showNotification error also call logger"
else
  fail "TUI catch blocks show error notification without logger call (stack trace lost)" "$UNLOGGED_CATCHES"
fi

echo ""

# ------------------------------------------------------------------
# 11. callLLMRaw — only called from queue-processor.ts
#     Direct calls from elsewhere bypass the queue system, priority
#     ordering, and the DLQ — any new caller must go through the queue.
# ------------------------------------------------------------------
echo "callLLMRaw — only called from queue-processor.ts"
DIRECT_LLM_CALLS=$(grep -rn "callLLMRaw(" "$ROOT/src/" --include="*.ts" \
  | grep -v "src/core/queue-processor.ts" \
  | grep -v "src/core/llm-client.ts" \
  || true)
if [ -z "$DIRECT_LLM_CALLS" ]; then pass "callLLMRaw only in queue-processor.ts + llm-client.ts"; else fail "callLLMRaw() called outside queue-processor.ts (bypasses queue system)" "$DIRECT_LLM_CALLS"; fi

echo ""

# ------------------------------------------------------------------
# 12. Test isolation — unit tests must not call real callLLMRaw
#     callLLMRaw has a real side effect: writeNetworkDump writes to
#     EI_DATA_PATH/logs/ when EI_DEBUG_NETWORK_VERBOSE=1. Unit tests
#     that import and call it directly (instead of mocking it) will
#     bleed log files into the developer's real profile directory.
#     Required pattern: vi.mock('...llm-client...') OR no import at all.
#     Exception: src/core/llm-client.ts itself and the dedicated
#     call-llm-raw.test.ts which tests callLLMRaw directly — that file
#     must instead guard by mocking writeNetworkDump or clearing the env.
# ------------------------------------------------------------------
echo "Test isolation — unit tests must mock llm-client (no real callLLMRaw)"
IMPORTS_LLM_CLIENT=$(grep -rln "llm-client" \
  "$ROOT/tests/unit/" \
  "$ROOT/tui/src/" \
  --include="*.test.ts" --include="*.test.tsx" 2>/dev/null \
  | grep -v "tests/unit/core/call-llm-raw.test.ts" \
  | grep -v "tests/unit/core/llm-client.test.ts" \
  | grep -v "tests/unit/core/resolve-model.test.ts" \
  | grep -v "tests/unit/core/resolve-token-limit.test.ts" \
  || true)
LLM_WITHOUT_MOCK=""
for f in $IMPORTS_LLM_CLIENT; do
  if ! grep -q "vi\.mock.*llm-client" "$f"; then
    LLM_WITHOUT_MOCK="$LLM_WITHOUT_MOCK  $f"
  fi
done
if [ -z "$LLM_WITHOUT_MOCK" ]; then
  pass "all unit tests that import llm-client mock it with vi.mock"
else
  fail "unit tests import llm-client without vi.mock — writeNetworkDump will write to real EI_DATA_PATH" "$LLM_WITHOUT_MOCK"
fi

CALL_LLM_RAW_TEST="$ROOT/tests/unit/core/call-llm-raw.test.ts"
if [ -f "$CALL_LLM_RAW_TEST" ]; then
  if grep -q "EI_DEBUG_NETWORK_VERBOSE" "$CALL_LLM_RAW_TEST"; then
    pass "call-llm-raw.test.ts suppresses EI_DEBUG_NETWORK_VERBOSE"
  else
    fail "call-llm-raw.test.ts must clear EI_DEBUG_NETWORK_VERBOSE to prevent log bleed into real EI_DATA_PATH" "$CALL_LLM_RAW_TEST"
  fi
fi

echo ""

# ------------------------------------------------------------------
# 13. Test isolation — unit tests must not use real FileStorage
#     FileStorage reads/writes EI_DATA_PATH on disk. Unit tests that
#     instantiate FileStorage directly (rather than using the
#     createMockStorage() helper) will bleed into the developer's
#     real profile or require a real filesystem. The only allowed
#     exception is tests/tui/storage/file.test.ts and
#     tests/unit/cli/retrieval.test.ts — those are intentional
#     integration tests for the storage layer itself.
# ------------------------------------------------------------------
echo "Test isolation — unit tests must not instantiate real FileStorage"
REAL_FILE_STORAGE=$(grep -rn "new FileStorage(" \
  "$ROOT/tests/unit/" \
  "$ROOT/tui/src/" \
  --include="*.test.ts" --include="*.test.tsx" 2>/dev/null \
  | grep -v "tests/tui/storage/file.test.ts" \
  | grep -v "tests/unit/cli/retrieval.test.ts" \
  || true)
if [ -z "$REAL_FILE_STORAGE" ]; then
  pass "no unit tests instantiate real FileStorage (use createMockStorage)"
else
  fail "unit tests use real FileStorage — use createMockStorage() helper instead" "$REAL_FILE_STORAGE"
fi

echo ""

# ------------------------------------------------------------------
# 14. Test isolation — all TUI E2E tests must set EI_DATA_PATH
#     If EI_DATA_PATH is missing, the TUI process falls back to
#     ~/.local/share/ei and writes test artifacts into the real profile.
# ------------------------------------------------------------------
echo "TUI E2E tests — EI_DATA_PATH set"
TUI_E2E_DIR="$ROOT/tui/tests/e2e"
MISSING_DATA_PATH=""
while IFS= read -r -d '' f; do
  MISSING_DATA_PATH="$MISSING_DATA_PATH  $(basename "$f")"
done < <(grep -rLZ "EI_DATA_PATH" "$TUI_E2E_DIR" --include="*.test.ts" 2>/dev/null || true)
if [ -z "$MISSING_DATA_PATH" ]; then
  pass "all TUI E2E test files set EI_DATA_PATH"
else
  fail "TUI E2E test files missing EI_DATA_PATH in env block" "$MISSING_DATA_PATH"
fi

echo ""

# ------------------------------------------------------------------
# Summary
# ------------------------------------------------------------------
if [ "$FAILURES" -eq 0 ]; then
  echo "All structural checks passed."
  exit 0
else
  echo "$FAILURES structural check(s) failed."
  exit 1
fi
