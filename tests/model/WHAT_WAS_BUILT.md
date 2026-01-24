# LLM Benchmark Framework - Build Summary

## What Problem This Solves

**Before**: Testing prompt improvements required manually spinning up 100+ profiles, eyeballing results, no quantitative metrics.

**After**: Statistical validation with 20+ runs, objective quality scoring, automated comparison against ideal responses.

## What Was Built

### 1. Core Infrastructure

**`llm-bench.ts`** - Benchmark runner
- Runs identical prompts N times against any model
- Tracks timing, finish reason (detects truncation)
- Validates responses via pluggable validators
- Outputs structured JSON results with summary statistics

**Added to package.json**:
```bash
npm run bench -- <args>
```

### 2. Validation Framework

Three validators created as examples:

**`validators/fast-scan.ts`** (Basic)
- Schema validation only
- Checks JSON structure, required fields, valid enum values
- Simple pass/fail

**`validators/fast-scan-with-ideal.ts`** (Scoring)
- Compares against "golden record" ideal response
- Fuzzy name matching (handles slight variations)
- Composite quality score (0-1):
  - 40% Recall: Found ideal items / Total ideal items
  - 30% Precision: Valid items / Total response items
  - 20% Type accuracy: Correct categorization
  - 10% Confidence accuracy: Appropriate confidence levels
- Detailed analysis: missed items, extra items, match counts

**`validators/detail-update.ts`** (Template)
- Minimal example for detail-update prompts
- Copy and customize for other prompt types

### 3. Ideal Response Generation

**Oracle-generated golden record**:
- Used Claude Opus 4.5 to analyze your fast-scan prompt
- Generated ideal response for your introduction text
- Saved as `fast-scan-ideal-response.json`
- Scoring validator loads and compares against this

### 4. Output & Analysis

**Console output** shows real-time progress:
```
Run 1/20... ✓ 1234ms (score: 0.87)
Run 2/20... ✓ 1189ms (score: 0.92)
...

SUMMARY
Success rate:   95.0% (19/20)
Avg duration:   1234ms

Quality Scores:
  Avg: 0.89
  Min: 0.82
  Max: 0.95
```

**JSON output** (`tests/model/results/*.json`) contains:
- Full config (prompts, model, runs)
- Every response and validation result
- Detailed analysis per run (missed/extra items)
- Summary statistics

## How To Use

### Quick Test (1 run)
```bash
npm run bench -- \
  --system tests/model/prompts/fastScan/system_01.md \
  --user tests/model/prompts/fastScan/user_01.md \
  --model local:qwen/qwen3-30b-a3b-2507 \
  --runs 1 \
  --name quick-test \
  --validator tests/model/validators/fast-scan-with-ideal.ts
```

### Full Statistical Validation (20+ runs)
```bash
npm run bench -- \
  --system tests/model/prompts/fastScan/system_01.md \
  --user tests/model/prompts/fastScan/user_01.md \
  --model local:qwen/qwen3-30b-a3b-2507 \
  --runs 20 \
  --name baseline \
  --validator tests/model/validators/fast-scan-with-ideal.ts
```

### Compare Prompt Variations
1. Run baseline with current prompt
2. Save result file
3. Modify prompt
4. Run again with new name
5. Compare scores in JSON results

## Workflow for Prompt Engineering

1. **Create ideal response**: Use Oracle or manually craft golden record
2. **Write validator**: Compare responses against ideal (see `fast-scan-with-ideal.ts`)
3. **Baseline test**: Run 20+ iterations with current prompt
4. **Iterate**:
   - Modify prompt
   - Run 20+ iterations
   - Compare scores
   - Keep changes that improve metrics
5. **Repeat** until satisfaction

## Key Insights

- **Fuzzy matching**: Names don't need exact matches ("Lis (wife)" matches "Wife Lis")
- **Composite scoring**: Multiple dimensions prevent gaming single metrics
- **Statistical validity**: 20+ runs smooth out model randomness
- **Objective metrics**: Replaces subjective "this looks better" judgments

## Files Created

```
tests/model/
├── llm-bench.ts                              # Runner script
├── README.md                                 # Usage documentation
├── WHAT_WAS_BUILT.md                         # This file
├── validators/
│   ├── fast-scan.ts                          # Basic schema validation
│   ├── fast-scan-with-ideal.ts               # Quality scoring validator
│   ├── fast-scan-ideal-response.json         # Golden record
│   └── detail-update.ts                      # Template for other prompts
└── results/                                  # Auto-generated outputs (gitignored)
```

## Next Steps (Your Call)

1. **Test the framework**: Run a quick 1-iteration test to verify plumbing
2. **Baseline current prompts**: Get current quality scores
3. **Create validators for other prompts**: detail-update, verification-parsing, etc.
4. **Iterate on prompts**: Use objective scores to measure improvement
5. **(Future) Advanced analysis**: Compare results across models, visualize trends

## Technical Details

- **Async validators supported**: Can load files, call APIs, etc.
- **ESM modules**: Uses ES6 imports (`.js` extension in imports)
- **TypeScript**: Full type safety for validators
- **Extensible**: Easy to add new validator types or scoring algorithms
- **Provider-agnostic**: Works with any model (local, OpenAI, Google, etc.)

## Key Code Change

**Exported `callLLMRaw` from `src/llm.ts`**:
- Benchmark needs access to `finishReason` (detect truncation)
- Public function now available for other tools too
