/**
 * Reflection Critic eval against real persona data from a state snapshot.
 *
 * Requires EXTERNAL_STATE_FILE to be set:
 *   EXTERNAL_STATE_FILE=~/.local/share/ei/backups/2026-04-28T17-09-05.json npm run test:evals:persona-data-check
 *   EXTERNAL_STATE_FILE=~/.local/share/ei/state.json EVAL_PERSONA=Lena npm run test:evals:persona-data-check
 *
 * EVAL_PERSONA defaults to "Lena". Any persona name in the state file works.
 *
 * Output is observe-only by default — use --filter=assert to run the assertion cases.
 *
 * Do NOT commit state files. EXTERNAL_STATE_FILE stays on your filesystem.
 */

import { readFileSync } from "fs";
import { StateManager } from "../../src/core/state-manager.js";
import type { StorageState } from "../../src/core/types/integrations.js";
import type { Storage } from "../../src/storage/interface.js";
import { buildReflectionCriticPrompt } from "../../src/prompts/reflection/index.js";
import { runEval, printSummary } from "./runner.js";
import type { Assertion } from "./runner.js";

const NULL_STORAGE: Storage = {
  isAvailable: async () => true,
  save: async () => {},
  load: async () => null,
  moveToBackup: async () => {},
  loadBackup: async () => null,
  saveRollingBackup: async () => {},
};

async function loadStateSnapshot(): Promise<StateManager> {
  const stateFilePath = process.env.EXTERNAL_STATE_FILE;
  if (!stateFilePath) {
    throw new Error(
      "EXTERNAL_STATE_FILE is not set.\n" +
      "Example: EXTERNAL_STATE_FILE=~/.local/share/ei/backups/2026-04-28T17-09-05.json npm run test:evals:persona-data-check"
    );
  }
  const raw = readFileSync(stateFilePath, "utf-8");
  const state = JSON.parse(raw) as StorageState;
  const sm = new StateManager();
  await sm.initialize(NULL_STORAGE);
  sm.restoreFromState(state);
  return sm;
}

const PERSONA_NAME = process.env.EVAL_PERSONA ?? "Lena";

const sm = await loadStateSnapshot();

const persona = (() => {
  const all = sm.persona_getAll();
  const found = all.find(p => p.display_name.toLowerCase() === PERSONA_NAME.toLowerCase());
  if (!found) {
    const available = all.map(p => p.display_name).join(", ");
    throw new Error(`No persona named "${PERSONA_NAME}" in state file. Available: ${available}`);
  }
  return found;
})();

const personRecord = sm.human_person_getByIdentifier("Ei Persona", persona.id);
const personLog = personRecord?.description ?? "";

const ASSERT_CASES: Assertion[] = [
  {
    type: "is-json",
    schema: { required: ["critique"] },
  },
  {
    type: "llm-judge",
    rubric: [
      "The critique field must be coherent prose (2-4 sentences), not bullet points or an error message.",
      "If updated_identity is non-null, long_description must be ≤800 characters and must NOT contain event narrative (e.g., 'during v0.6.0', 'after the Mirror ceremony', 'has recently').",
      "If updated_identity is non-null, long_description must NOT repeat content already captured in traits or topics.",
      "If updated_identity is non-null, all numeric fields must be within valid ranges (strength/exposure 0–1, sentiment -1 to 1).",
      "It is valid (and encouraged) for updated_identity to be null when the identity already accurately reflects the observed behavior.",
    ].join(" "),
  },
  {
    type: "json-field-length",
    field: "critique",
    min: 50,
    max: 800,
  },
];

const summary = await runEval(
  [
    {
      description: `Persona data check / ${PERSONA_NAME} — observe output quality`,
      tags: ["persona-data-check", "observe", PERSONA_NAME.toLowerCase()],
      observe: true as const,
      prompt: () => buildReflectionCriticPrompt({
        persona_identity: {
          name: persona.display_name,
          long_description: persona.long_description ?? "",
          short_description: persona.short_description ?? "",
          traits: persona.traits,
          topics: persona.topics,
        },
        person_log: personLog,
      }),
    },
    {
      description: `Persona data check / ${PERSONA_NAME} — assert output quality`,
      tags: ["persona-data-check", "assert", PERSONA_NAME.toLowerCase()],
      assert: ASSERT_CASES,
      prompt: () => buildReflectionCriticPrompt({
        persona_identity: {
          name: persona.display_name,
          long_description: persona.long_description ?? "",
          short_description: persona.short_description ?? "",
          traits: persona.traits,
          topics: persona.topics,
        },
        person_log: personLog,
      }),
    },
  ],
  "tests/evals/results/lena-continuity-latest.json"
);

printSummary(summary);

if (summary.overallPassRate < 1) process.exit(1);
