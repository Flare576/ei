import { describe, expect, test } from "bun:test";
import {
  newProviderFromYAML,
  newProviderToYAML,
  providerFromYAML,
  providerToYAML,
} from "../../src/util/yaml-provider";
import { ProviderType } from "../../../src/core/types.js";
import type { ProviderAccount } from "../../../src/core/types.js";

function createTestAccount(overrides?: Partial<ProviderAccount>): ProviderAccount {
  return {
    id: "test-account-1",
    name: "Test Provider",
    type: ProviderType.LLM,
    url: "https://api.example.com/v1",
    enabled: true,
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

describe("temperature_disabled YAML validation", () => {
  test("newProviderFromYAML rejects quoted temperature_disabled values", () => {
    const yaml = newProviderToYAML("MyNewProvider")
      .replace("url: https://api.example.com/v1", "url: https://api.real.com/v1")
      .replace("temperature_disabled: null", 'temperature_disabled: "false"');

    expect(() => newProviderFromYAML(yaml)).toThrow(/temperature_disabled.*boolean/i);
  });

  test("providerFromYAML rejects quoted temperature_disabled values", () => {
    const account = createTestAccount({
      models: [
        {
          id: "model-1",
          name: "gpt-4",
          model_id: "gpt-4-turbo",
          temperature_disabled: false,
        },
      ],
    });
    const yaml = providerToYAML(account).replace(
      "temperature_disabled: false",
      'temperature_disabled: "false"'
    );

    expect(() => providerFromYAML(yaml, account)).toThrow(/temperature_disabled.*boolean/i);
  });
});
