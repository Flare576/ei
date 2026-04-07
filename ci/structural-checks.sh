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
# Only check extraction handlers — these process LLM-extracted user data.
# Losing a result here means data is gone. Heartbeat/dedup/rewrite returning
# on error is fine (no user data at stake).
EXTRACTION_HANDLERS="$ROOT/src/core/handlers/human-extraction.ts $ROOT/src/core/handlers/human-matching.ts"
SILENT_DROPS=$(for file in $EXTRACTION_HANDLERS; do
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
# Summary
# ------------------------------------------------------------------
if [ "$FAILURES" -eq 0 ]; then
  echo "All structural checks passed."
  exit 0
else
  echo "$FAILURES structural check(s) failed."
  exit 1
fi
