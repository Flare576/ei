import { describe, it, expect } from "vitest";
import { buildPersonaSignalScanPrompt } from "../../../src/prompts/human/persona-signal-scan.js";
import type { PersonaSignalScanPromptData } from "../../../src/prompts/human/persona-signal-scan.js";

function baseData(extra?: Partial<PersonaSignalScanPromptData>): PersonaSignalScanPromptData {
  return {
    subject_persona_name: "Ei",
    channel_persona_name: "Ei",
    persona_roster: [],
    messages_context: [],
    messages_analyze: [],
    ...extra,
  };
}

describe("buildPersonaSignalScanPrompt — dev-narration exclusion guard", () => {
  it("throws without a subject persona name", () => {
    expect(() => buildPersonaSignalScanPrompt(baseData({ subject_persona_name: "" }))).toThrow(
      "subject_persona_name is required"
    );
  });

  it("instructs the model to exclude system/feature narration that merely names the subject", () => {
    const { system } = buildPersonaSignalScanPrompt(baseData());
    expect(system).toContain("## What does NOT count as evidence");
    expect(system).toContain("Development narration is not evidence");
  });

  it("gives a concrete negative example matching the 'persona has a new feature' failure shape", () => {
    const { system } = buildPersonaSignalScanPrompt(baseData({ subject_persona_name: "Ei" }));
    expect(system).toContain("Ei has a new [feature] that does [X].");
  });

  it("still requires genuine self-reaction/opinion evidence to be captured", () => {
    const { system } = buildPersonaSignalScanPrompt(baseData({ subject_persona_name: "Ei" }));
    expect(system).toContain("Ei said/felt/chose/valued");
    expect(system).toContain("this IS evidence");
  });

  it("BETA-PS-001: does not exclude a concretely observed individual action merely because a component could do something similar", () => {
    const { system } = buildPersonaSignalScanPrompt(baseData({ subject_persona_name: "Ei" }));
    expect(system).toContain('NOT a "could a machine do this too" test');
    expect(system).toContain("Ei runs final verification before saying a change is done.");
    expect(system).toContain("Still evidence even though a CI pipeline could do something similar");
  });

});
