# LLM Prompt Benchmarking

Tools for statistically validating prompt effectiveness across multiple model runs.

## Quick Start

```bash
npm run bench -- \
  --system tests/model/prompts/fastScan/system_01.md \
  --user tests/model/prompts/fastScan/user_01.md \
  --model local:qwen/qwen3-14b \
  --runs 20 \
  --name fast-scan-baseline \
  --validator tests/model/validators/fast-scan.ts
```

## Directory Structure

```
tests/model/
├── llm-bench.ts           # Benchmark runner script
├── prompts/               # Test prompts (gitignored, agent-visible)
│   ├── fastScan/
│   └── ei/
├── validators/            # Response validation logic
│   └── fast-scan.ts
└── results/               # JSON output files (auto-created)
```

## Arguments

| Argument | Required | Description |
|----------|----------|-------------|
| `--system` | Yes | Path to system prompt markdown file |
| `--user` | Yes | Path to user prompt markdown file |
| `--model` | Yes | Model spec (provider:model format) |
| `--runs` | Yes | Number of test iterations |
| `--name` | No | Output filename suffix |
| `--validator` | No | Path to TypeScript validator module |

## Writing Validators

Validators must export a `validate(response: string)` function:

```typescript
export interface ValidationResult {
  success: boolean;
  parsed?: unknown;
  error?: string;
  score?: number;              // Optional: 0-1 quality score
  analysis?: Record<string, unknown>;  // Optional: detailed analysis
}

export function validate(response: string): ValidationResult | Promise<ValidationResult> {
  try {
    const parsed = JSON.parse(response);
    return { success: true, parsed };
  } catch (err) {
    return { success: false, error: err.message };
  }
}
```

### Validator Types

**Basic Validator** (`validators/fast-scan.ts`):
- Validates JSON structure only
- Checks required fields and types
- Simple pass/fail

**Scoring Validator** (`validators/fast-scan-with-ideal.ts`):
- Compares response against ideal "golden record"
- Fuzzy matching for item names
- Generates quality score (0-1) based on:
  - 40% Recall: How many ideal items were found
  - 30% Precision: How many response items were valid
  - 20% Type accuracy: Correct categorization
  - 10% Confidence accuracy: Appropriate confidence levels
  - **-7.5% per hallucination**: Penalty for each extra/fabricated item
- Detailed analysis of missed/extra items with penalty tracking

## Output Format

Results are saved as JSON in `tests/model/results/`:

```json
{
  "config": { ... },
  "timestamp": "2026-01-22T15:11:00Z",
  "results": [
    {
      "run": 1,
      "durationMs": 1234,
      "response": "raw LLM response",
      "finishReason": "stop",
      "validation": {
        "success": true,
        "parsed": { ... }
      }
    }
  ],
  "summary": {
    "avgDurationMs": 1234,
    "minDurationMs": 890,
    "maxDurationMs": 1567,
    "successRate": 0.85,
    "failures": ["run 3: Invalid JSON", "run 7: Missing field"]
  }
}
```

## Workflow

1. **Create prompts** in `tests/model/prompts/` (organized by test type)
2. **Write validator** in `tests/model/validators/` (validates response structure)
3. **Run benchmark** with multiple iterations to get statistical data
4. **Compare results** across prompt variations to measure improvement

## Example: Testing Fast-Scan Improvements

```bash
# Baseline with quality scoring
npm run bench -- \
  --system prompts/fastScan/system_01.md \
  --user prompts/fastScan/user_01.md \
  --model local:qwen/qwen3-30b-a3b-2507 \
  --runs 20 \
  --name fast-scan-baseline \
  --validator validators/fast-scan-with-ideal.ts

# After prompt improvements
npm run bench -- \
  --system prompts/fastScan/system_02_improved.md \
  --user prompts/fastScan/user_01.md \
  --model local:qwen/qwen3-30b-a3b-2507 \
  --runs 20 \
  --name fast-scan-improved \
  --validator validators/fast-scan-with-ideal.ts

# Compare in results/:
# - Success rate (valid JSON)
# - Avg quality score (how close to ideal)
# - Missed/extra items (from analysis field)
```

**Output example with scoring**:
```
Run 1/20... ✓ 1234ms (score: 0.87)
Run 2/20... ✓ 1189ms (score: 0.92)
...

SUMMARY
Success rate:   95.0% (19/20)
Avg duration:   1234ms
Min duration:   890ms
Max duration:   1567ms

Quality Scores:
  Avg: 0.89
  Min: 0.82
  Max: 0.95
```

## Analyzing Results

After running multiple benchmarks, generate a summary CSV:

```bash
npm run analyze
```

**Output**:
- Console table showing all runs sorted by name/timestamp
- `analysis.csv` with columns:
  - `name`: Benchmark name (from `--name` arg)
  - `model`: Model spec used
  - `runs`: Number of iterations
  - `timestamp`: When the test ran
  - `successRate`: Percentage of valid responses (0-1)
  - `avgScore`: Average quality score if validator provides scoring
  - `avgDurationMs`: Average response time
  - `minDurationMs`: Fastest response
  - `maxDurationMs`: Slowest response
  - `failureCount`: Number of failed runs

**Console output includes**:
- Summary table of all runs
- Top 5 best scores (if scoring validator used)
- Top 5 fastest models

**Use case**: Compare multiple models or prompt variations at a glance. Import CSV into spreadsheet for deeper analysis.
