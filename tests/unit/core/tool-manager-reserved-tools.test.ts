import { describe, it, expect, vi, type Mock } from "vitest";
import { addTool, updateTool } from "../../../src/core/tool-manager.js";
import { RESERVED_TOOL_NAMES } from "../../../src/core/types/integrations.js";
import type { ToolDefinition } from "../../../src/core/types.js";
import type { StateManager } from "../../../src/core/state-manager.js";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeToolInput(
  overrides: Partial<Omit<ToolDefinition, "id" | "created_at">> = {}
): Omit<ToolDefinition, "id" | "created_at"> {
  return {
    provider_id: "test-provider-id",
    name: "custom_tool",
    display_name: "Custom Tool",
    description: "A custom tool",
    input_schema: { type: "object", properties: {} },
    runtime: "any",
    builtin: false,
    enabled: true,
    ...overrides,
  };
}

function makeMockStateManager() {
  return {
    tools_add: vi.fn(),
    tools_update: vi.fn(),
  } as unknown as StateManager & { tools_add: Mock; tools_update: Mock };
}

// ---------------------------------------------------------------------------
// Oracle: the declared reserved-name list is exactly these five names
// ---------------------------------------------------------------------------

describe("RESERVED_TOOL_NAMES oracle", () => {
  it("declares exactly the five reserved tool names, in this order", () => {
    expect(RESERVED_TOOL_NAMES).toEqual([
      "resolve_signal",
      "get_my_identity",
      "edit_trait",
      "edit_topic",
      "update_description",
    ]);
  });
});

// ---------------------------------------------------------------------------
// addTool — create rejection for every reserved name
// ---------------------------------------------------------------------------

describe("addTool with a reserved name", () => {
  it.each(RESERVED_TOOL_NAMES)("rejects creating a tool named \"%s\"", async (reservedName) => {
    const sm = makeMockStateManager();

    await expect(
      addTool(sm, makeToolInput({ name: reservedName }))
    ).rejects.toThrow(
      `Cannot create tool with reserved name "${reservedName}". Reserved names: ${RESERVED_TOOL_NAMES.join(", ")}`
    );

    expect(sm.tools_add).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// updateTool — rename rejection for every reserved name
// ---------------------------------------------------------------------------

describe("updateTool renaming to a reserved name", () => {
  it.each(RESERVED_TOOL_NAMES)("rejects renaming a tool to \"%s\"", async (reservedName) => {
    const sm = makeMockStateManager();

    await expect(
      updateTool(sm, "existing-tool-id", { name: reservedName })
    ).rejects.toThrow(
      `Cannot rename tool to reserved name "${reservedName}". Reserved names: ${RESERVED_TOOL_NAMES.join(", ")}`
    );

    expect(sm.tools_update).not.toHaveBeenCalled();
  });
});
