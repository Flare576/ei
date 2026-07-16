import { test, expect, describe } from "bun:test";
import {
  newProviderFromYAML,
  providerToYAML,
  providerFromYAML,
  newProviderToYAML,
} from "../../src/util/yaml-provider";
import type { ProviderAccount } from "../../../src/core/types.js";

// Helper to create a minimal ProviderAccount fixture
function createTestAccount(
  overrides?: Partial<ProviderAccount>
): ProviderAccount {
  return {
    id: "test-account-1",
    name: "Test Provider",
    type: "llm",
    url: "https://api.example.com/v1",
    enabled: true,
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

describe("providerFromYAML — temperature_disabled round-trip", () => {
  test("temperature_disabled: true survives round-trip via providerToYAML → providerFromYAML when unrelated field edited", () => {
    // Create account with one model having temperature_disabled: true and different model_id
    const account = createTestAccount({
      models: [
        {
          id: "model-1",
          name: "claude-opus",
          model_id: "claude-opus-4-8",
          token_limit: 200000,
          temperature_disabled: true,
        },
      ],
    });

    // Serialize to YAML (what user sees in $EDITOR)
    const yaml = providerToYAML(account);

    // Simulate user editing an unrelated field: change the model name
    // This is the bug reproduction: the existing code would lose temperature_disabled on save
    const editedYaml = yaml.replace(
      "  - name: claude-opus",
      "  - name: claude-opus-renamed"
    );

    // Deserialize back with the original account for reference (to preserve IDs)
    const result = providerFromYAML(editedYaml, account);

    // Assert temperature_disabled is still true after round-trip
    expect(result.account.models).toBeDefined();
    expect(result.account.models!.length).toBe(1);
    expect(result.account.models![0].temperature_disabled).toBe(true);
  });

  test("temperature_disabled: false explicitly set round-trips correctly and does not become undefined", () => {
    // Create account with one model having temperature_disabled: false
    const account = createTestAccount({
      models: [
        {
          id: "model-2",
          name: "gpt-4",
          model_id: "gpt-4-turbo",
          temperature_disabled: false,
        },
      ],
    });

    // Round-trip through providerToYAML → providerFromYAML
    const yaml = providerToYAML(account);
    const result = providerFromYAML(yaml, account);

    // Assert temperature_disabled is still false, not coerced to undefined
    expect(result.account.models).toBeDefined();
    expect(result.account.models!.length).toBe(1);
    expect(result.account.models![0].temperature_disabled).toBe(false);
  });

  test("temperature_disabled: undefined (never set) stays undefined after round-trip and does not become false", () => {
    // Create account with model that never had temperature_disabled set
    const account = createTestAccount({
      models: [
        {
          id: "model-3",
          name: "default-model",
          // temperature_disabled is intentionally omitted (undefined)
        },
      ],
    });

    // Round-trip through providerToYAML → providerFromYAML
    const yaml = providerToYAML(account);
    const result = providerFromYAML(yaml, account);

    // Assert temperature_disabled is still undefined
    expect(result.account.models).toBeDefined();
    expect(result.account.models!.length).toBe(1);
    expect(result.account.models![0].temperature_disabled).toBeUndefined();
  });

  test("temperature_disabled: true can be set from scratch via newProviderToYAML → newProviderFromYAML", () => {
    // Get the template YAML for a new provider
    const templateYaml = newProviderToYAML("MyNewProvider");

    // Fill in the required placeholder fields and set temperature_disabled: true
    const filledYaml = templateYaml
      .replace("url: https://api.example.com/v1", "url: https://api.real.com/v1")
      .replace(
        "    temperature_disabled: null",
        "    temperature_disabled: true"
      );

    // Verify we didn't accidentally break the YAML
    expect(filledYaml).toContain("temperature_disabled: true");

    // Create the new provider from the template
    const account = newProviderFromYAML(filledYaml);

    // Assert the resulting model has temperature_disabled set to true
    expect(account.models).toBeDefined();
    expect(account.models!.length).toBe(1);
    expect(account.models![0].temperature_disabled).toBe(true);
  });
});

describe("providerFromYAML — explicit override is written, not merged with existing (Beta review T4)", () => {
  test("T4 (P1): editing temperature_disabled: true to false in YAML persists false, not the prior true", () => {
    const account = createTestAccount({
      models: [
        {
          id: "model-1",
          name: "claude-opus",
          model_id: "claude-opus-4-8",
          temperature_disabled: true,
        },
      ],
    });

    const yaml = providerToYAML(account);
    expect(yaml).toContain("temperature_disabled: true");

    // The operator explicitly flips the flag — this must NOT be merged back with the
    // account's existing (stale) `true` value via the `existing` name-match lookup.
    const editedYaml = yaml.replace("temperature_disabled: true", "temperature_disabled: false");

    const result = providerFromYAML(editedYaml, account);

    expect(result.account.models![0].temperature_disabled).toBe(false);
  });
});

describe("temperature_disabled — malformed scalar rejection (Beta review M1/T5)", () => {
  // Note: the quoted-string case is already covered by Beta's dedicated
  // tui/tests/unit/temperature-disabled-yaml-validation.test.ts for both parse paths —
  // these cover the remaining scalar shapes (number, object) she flagged as in scope.
  test("T5 (P2): providerFromYAML rejects a numeric value instead of silently coercing it", () => {
    const account = createTestAccount({
      models: [{ id: "model-1", name: "claude-opus", model_id: "claude-opus-4-8" }],
    });
    const yaml = providerToYAML(account).replace(
      "temperature_disabled: null",
      "temperature_disabled: 1"
    );

    expect(() => providerFromYAML(yaml, account)).toThrow(/temperature_disabled/);
  });

  test("T5 (P2): providerFromYAML rejects an object value instead of silently coercing it", () => {
    const account = createTestAccount({
      models: [{ id: "model-1", name: "claude-opus", model_id: "claude-opus-4-8" }],
    });
    const yaml = providerToYAML(account).replace(
      "temperature_disabled: null",
      "temperature_disabled: {nested: true}"
    );

    expect(() => providerFromYAML(yaml, account)).toThrow(/temperature_disabled/);
  });
});
