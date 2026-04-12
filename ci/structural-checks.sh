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
            if not (has_literal or has_options_spread or has_context_spread):
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
# Summary
# ------------------------------------------------------------------
if [ "$FAILURES" -eq 0 ]; then
  echo "All structural checks passed."
  exit 0
else
  echo "$FAILURES structural check(s) failed."
  exit 1
fi
