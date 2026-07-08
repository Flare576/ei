import { describe, it, expect } from "vitest";
import { buildHumanPersonScanPrompt } from "../../../src/prompts/human/person-scan.js";
import type { PersonScanPromptData } from "../../../src/prompts/human/types.js";

function baseData(extra?: Partial<PersonScanPromptData>): PersonScanPromptData {
  return {
    persona_name: "Sisyphus",
    messages_context: [],
    messages_analyze: [],
    ...extra,
  };
}

describe("buildHumanPersonScanPrompt — attribution guard", () => {
  it("includes the cross-attribution negative example (Marcus / Priya)", () => {
    const { system } = buildHumanPersonScanPrompt(baseData());
    expect(system).toContain("belongs to Marcus's record only");
  });
});
