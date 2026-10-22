/**
 * Shared input and assertions for the sub-agent parent-line signal-scan case
 * (persona-signal-scan.eval.ts) and its known-bad control
 * (persona-signal-scan-parent-line-control.observe.ts). Both build their prompt and assertions
 * here so the case and the control cannot drift apart.
 *
 * The messages come from the importer's real path: a synthetic sub-agent transcript is written to
 * a temp dir, read with OmpReader, and converted the way the importer converts a sub-agent block
 * (convertToEiMessage with the parent-speaker mapping). The known-bad variant converts the same
 * transcript WITHOUT that mapping, so the parent's line becomes `role: "human"` — what a
 * converter that ignores the line's attribution produces.
 */
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { OmpReader } from "../../src/integrations/omp/reader.js";
import { convertToEiMessage } from "../../src/integrations/shared/message-converter.js";
import { qualifyOmpMessage } from "../../src/core/utils/message-id.js";
import { buildPersonaSignalScanPrompt } from "../../src/prompts/human/persona-signal-scan.js";
import { ompHeader, ompMessage, ompSubAgent, writeOmpTree } from "../unit/integrations/shared/omp-transcript-fixtures.js";
import { hydratePrompt, type Assertion } from "./runner.js";

const SUBJECT = "Sisyphus";

const PARENT_CLAIM = "Heads up: Sisyphus tends to skip the lint step whenever a deadline is close, so double-check anything it hands back.";
const OWN_LINES = [
  "Understood. I'll start by reading the failing test.",
  "I ran the targeted test suite for the changed module before I reported the fix as safe.",
  "The fix is in place and the targeted tests pass.",
];

export async function buildParentLinePrompt(knownBad: boolean): Promise<{ system: string; user: string }> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "ei-parent-line-"));
  try {
    const tree = await writeOmpTree(root, {
      stem: "root",
      main: [ompHeader()],
      children: {
        "0": ompSubAgent({
          agent: SUBJECT,
          messages: [
            ompMessage("user", PARENT_CLAIM, { attribution: "agent" }),
            ...OWN_LINES.map((text) => ompMessage("assistant", text)),
          ],
        }),
      },
    });
    const childPath = tree.children["0"]!;
    const session = await new OmpReader().readTranscript(childPath);
    if (!session) throw new Error("synthetic sub-agent transcript could not be read");
    const messages = session.messages.map((m) =>
      convertToEiMessage(m, childPath, qualifyOmpMessage, { parentSpeaker: !knownBad })
    );
    return hydratePrompt(
      buildPersonaSignalScanPrompt({
        subject_persona_name: SUBJECT,
        channel_persona_name: SUBJECT,
        persona_roster: [],
        messages_context: [],
        messages_analyze: messages,
      }),
      messages
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

export const PARENT_LINE_ASSERTIONS: Assertion[] = [
  { type: "is-json", schema: { required: ["observations"] } },
  {
    type: "llm-judge",
    rubric: [
      `The transcript is a sub-agent's own conversation. Its first line is the parent agent's note about Sisyphus ("Sisyphus tends to skip the lint step whenever a deadline is close"); the rest are Sisyphus's own first-person lines. No human speaks anywhere in it.`,
      `PASS if no entry in observations has observer_kind "human" (an empty observations array also passes this check).`,
      `FAIL if any entry in observations has observer_kind "human".`,
    ].join(" "),
  },
  {
    type: "llm-judge",
    rubric: [
      `Sisyphus's own line says: "I ran the targeted test suite for the changed module before I reported the fix as safe." This is a concrete practice Sisyphus itself performed.`,
      `PASS if at least one entry in observations has observer_kind "subject_self" and its claim reflects Sisyphus running targeted tests before reporting a fix as safe.`,
      `FAIL if no entry in observations has observer_kind "subject_self", or if observations is empty.`,
    ].join(" "),
  },
];
