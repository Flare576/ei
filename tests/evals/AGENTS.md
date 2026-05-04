# Evals — Agent Guide

## MANDATORY: Never run evals yourself

Eval suites make live LLM calls against a local model. Each case takes 10–60 seconds. A full suite runs 4–6 minutes. **Always delegate to a subagent.**

```typescript
task(category="quick", load_skills=[], run_in_background=true, description="Run person-update evals",
  prompt="Run: cd /Users/flare576/Projects/Personal/ei && npm run test:evals -- person-update --filter=identity-bleed\nReport the full output.")
```

Use `--filter=<tag-or-substring>` to run a single case while iterating on a prompt. Full suite only when you need to check for regressions.

## Running evals

```bash
npm run test:evals                                      # all 20 suites
npm run test:evals -- person-update                     # person-update.eval.ts only (~5 min)
npm run test:evals -- person                            # all person-*.eval.ts files
npm run test:evals -- person-update --filter=identity-bleed  # file match + case filter (~1 min)
npm run test:evals -- --filter=regression               # case filter across ALL files

EVAL_FILTER=identity-bleed npm run test:evals -- person-update  # same via env var
npm run test:evals -- --help                            # show full usage
```

The runner (`tests/evals/run.ts`) discovers all `*.eval.ts` files automatically — no package.json entry needed when you add a new eval file. Results are written to `tests/evals/results/`.

## Observe scripts

Observe scripts (`*.observe.ts`) are dev tools for watching model behavior — they don't assert pass/fail and aren't part of the test gate. Run them directly:

```bash
npx vite-node tests/evals/reflection-critic.observe.ts
```

## Filter syntax

`--filter=<string>` matches against `description` (substring) or `tags` (exact tag name). Case-insensitive.

Every eval case has a `tags` array — use those for precise targeting. Tag conventions:

| Tag pattern | Meaning |
|---|---|
| `person-update` | All person-update cases |
| `ei-persona` | Ei Persona log path cases |
| `identity-bleed` | The identity restatement regression test |
| `no-signal` | Cases that should return `{}` |
| `known-model-limitation` | Expected failures — model behavior, not a bug |
| `borderline` | Nondeterministic case — uses `pass_threshold` below 1.0, not all runs guaranteed to pass |

## Eval provider

By default, evals run against the local LLM at `http://localhost:1234/v1` (LM Studio).

```bash
EVAL_PROVIDER=anthropic ANTHROPIC_API_KEY=sk-... npm run test:evals -- person-update
EVAL_PROVIDER=openai OPENAI_API_KEY=sk-... EVAL_MODEL=gpt-4o npm run test:evals -- topic-scan
```

## Adding a new eval case

1. Add message fixtures near the top of the `.eval.ts` file
2. Add the case to the `runEval([...])` array with `description`, `tags`, and `assert`
3. Run `--filter=<your-new-tag>` to confirm it fails before touching the prompt
4. Fix the prompt, re-run to confirm it passes
5. Run the full suite to check for regressions — **delegate this to a subagent**
6. No package.json update needed — the runner auto-discovers `*.eval.ts` files

## Testing with real persona data ("something felt wrong")

Sometimes a response doesn't land the way it should — it feels like the persona didn't know something it should have known. That's hard to reproduce with synthetic fixtures. This section is for that case.

### The pattern

`state-fixture.ts` exports `loadStateFixture(personaName)`, which loads a real `state.json` snapshot into a hydrated `StateManager` and returns a `buildPromptData(currentMessage?)` function that runs the full TopK pipeline against your actual knowledge base — the same path production uses.

```typescript
import { loadStateFixture } from "./state-fixture.js";
import { buildResponsePrompt } from "../../src/prompts/response/index.js";

const fixture = await loadStateFixture("Lena");  // or any persona name

// Inside a prompt: function — note async, runner supports it
prompt: async () => {
  const data = await fixture.buildPromptData("the message you sent that didn't land");
  return { system: buildResponsePrompt(data).system, user: "" };
},
```

### Wiring up recent conversation history

The response prompt is NOT a flat prompt — it's a conversation. The current message should be the **last entry in `priorMessages`**, not the `user` field:

```typescript
// Pull the actual last N messages from the persona's conversation
const { sm, personaId } = fixture;
const allMessages = sm.messages_get(personaId);
const recentMessages = allMessages.slice(-10);

const priorMessages = recentMessages.map(m => ({
  role: (m.role === "human" ? "user" : "assistant") as "user" | "assistant",
  content: m.content ?? m.silence_reason ?? "",
})).filter(m => m.content);

// Then in the eval case:
priorMessages: [
  ...priorMessages,
  { role: "user" as const, content: "the message that didn't land" },
],
prompt: async () => {
  const data = await fixture.buildPromptData("the message that didn't land");
  return { system: buildResponsePrompt(data).system, user: "" };
},
```

### Running it

Point `EXTERNAL_STATE_FILE` at any `state.json` — your live data, a rolling backup, or a snapshot from the moment a bug occurred:

```bash
EXTERNAL_STATE_FILE=~/.local/share/ei/state.json npm run test:evals:real-data
EXTERNAL_STATE_FILE=~/.local/share/ei/backups/2026-04-28.json npm run test:evals:real-data
EVAL_PERSONA=Lena EXTERNAL_STATE_FILE=~/.local/share/ei/state.json npm run test:evals:real-data
```

`real-data-example.eval.ts` is the reference implementation — two simple observe cases against a named persona. Copy it, rename it, change the messages and persona name to match your situation.

### What NOT to commit

State files contain personal data. Never commit them. The `EXTERNAL_STATE_FILE` env var exists specifically so the path stays on your filesystem and out of the repo. If you write an eval that captures a specific real-world failure scenario, either use sanitized synthetic fixtures or delete the eval file after the fix is validated — the infrastructure is what needs to survive, not the specific test case.

## LLM judge rubric guidelines

- State what the conversation contains before the PASS/FAIL rules
- One PASS condition per line, one FAIL condition per line
- FAIL conditions should be specific phrases or behaviors, not vague ("FAIL if bad")
- Don't require verbatim quotes from the conversation — models paraphrase
