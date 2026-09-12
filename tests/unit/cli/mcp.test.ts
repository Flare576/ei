import { describe, it, expect, vi, afterEach } from "vitest";

// Preserve Zod's namespace export under Vitest's bare-specifier interop --
// same workaround as tests/unit/cli/corrections-endpoints.test.ts and
// tests/unit/cli/persona-corrections.test.ts. Without it, evaluating
// mcp.ts's own module-level zod schema literals (ei_signal_confirm/
// ei_signal_dismiss/ei_quote_* inputSchema) throws "z.string is not a
// function" while this file's other imports are being collected.
vi.mock("zod", async (importOriginal) => {
  const actual = await importOriginal() as Record<string, unknown>;
  return {
    ...actual,
    z: (actual.z ?? actual.default ?? actual) as Record<string, unknown>,
  };
});

const {
  MockCorrectionValidationError,
  mockRetrieveBalanced,
  mockLookupById,
  mockLoadLatestState,
  mockListPersonaSignals,
  mockCreateEntity,
  mockUpdateEntity,
  mockRemoveEntity,
  mockCreateQuoteEntity,
  mockFixQuoteEntity,
  mockRelinkQuoteEntity,
  mockCreatePersonaEntity,
  mockUpdatePersonaEntity,
  mockRemovePersonaEntity,
  mockApplyPersonaSignal,
} = vi.hoisted(() => {
  class MockCorrectionValidationError extends Error {}
  return {
    MockCorrectionValidationError,
    mockRetrieveBalanced: vi.fn().mockResolvedValue([
      { type: "fact", id: "fact_1", name: "Test Fact", description: "A test fact", sentiment: 0.5 },
    ]),
    mockLookupById: vi.fn().mockResolvedValue(null),
    mockLoadLatestState: vi.fn(),
    mockListPersonaSignals: vi.fn(),
    mockCreateEntity: vi.fn(),
    mockUpdateEntity: vi.fn(),
    mockRemoveEntity: vi.fn(),
    mockCreateQuoteEntity: vi.fn(),
    mockFixQuoteEntity: vi.fn(),
    mockRelinkQuoteEntity: vi.fn(),
    mockCreatePersonaEntity: vi.fn(),
    mockUpdatePersonaEntity: vi.fn(),
    mockRemovePersonaEntity: vi.fn(),
    mockApplyPersonaSignal: vi.fn(),
  };
});

vi.mock("../../../src/cli/retrieval.js", () => ({
  retrieveBalanced: mockRetrieveBalanced,
  lookupById: mockLookupById,
  loadLatestState: mockLoadLatestState,
  listPersonaSignals: mockListPersonaSignals,
}));

vi.mock("../../../src/cli/corrections-endpoints.js", () => ({
  createEntity: mockCreateEntity,
  updateEntity: mockUpdateEntity,
  removeEntity: mockRemoveEntity,
  createQuoteEntity: mockCreateQuoteEntity,
  fixQuoteEntity: mockFixQuoteEntity,
  relinkQuoteEntity: mockRelinkQuoteEntity,
  CorrectionValidationError: MockCorrectionValidationError,
}));

vi.mock("../../../src/cli/persona-corrections.js", () => ({
  createPersonaEntity: mockCreatePersonaEntity,
  updatePersonaEntity: mockUpdatePersonaEntity,
  removePersonaEntity: mockRemovePersonaEntity,
  applyPersonaSignal: mockApplyPersonaSignal,
}));



import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMcpServer } from "../../../src/cli/mcp.js";

async function setupClient() {
  const server = createMcpServer();
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test-client", version: "1.0.0" });
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  return { client, server };
}

describe("MCP server", () => {
  let client: Client;

  afterEach(async () => {
    if (client) {
      await client.close();
    }
  });

  it("registers ei_search and ei_lookup tools", async () => {
    ({ client } = await setupClient());
    const result = await client.listTools();
    const names = result.tools.map((t) => t.name);
    expect(names).toContain("ei_search");
    expect(names).toContain("ei_lookup");
  });

  it("ei_search returns JSON content", async () => {
    ({ client } = await setupClient());
    const result = await client.callTool({ name: "ei_search", arguments: { query: "test", limit: 1 } });
    const content = result.content as Array<{ type: string; text: string }>;
    expect(Array.isArray(content)).toBe(true);
    expect(content.length).toBeGreaterThan(0);
    expect(content[0].type).toBe("text");
    const parsed = JSON.parse(content[0].text);
    expect(Array.isArray(parsed)).toBe(true);
  });

  it("ei_lookup returns not-found message for unknown ID", async () => {
    ({ client } = await setupClient());
    const result = await client.callTool({ name: "ei_lookup", arguments: { id: "nonexistent-id" } });
    const content = result.content as Array<{ type: string; text: string }>;
    expect(content[0].text).toContain("No entity found");
  });

  it("ei_search type schema includes personas as a valid enum value", async () => {
    ({ client } = await setupClient());
    const tools = await client.listTools();
    const eiSearch = tools.tools.find((t) => t.name === "ei_search");
    expect(eiSearch).toBeDefined();
    const typeSchema = (eiSearch!.inputSchema as Record<string, unknown>);
    const properties = typeSchema.properties as Record<string, unknown>;
    const typeProperty = properties?.type as Record<string, unknown>;
    const enumValues = typeProperty?.enum as string[];
    expect(Array.isArray(enumValues)).toBe(true);
    expect(enumValues).toContain("personas");
  });

  it("ei_search description and type description never claim balanced search covers personas", async () => {
    ({ client } = await setupClient());
    const tools = await client.listTools();
    const eiSearch = tools.tools.find((t) => t.name === "ei_search");
    expect(eiSearch).toBeDefined();

    // Regression guard for the mcp.ts finding: the tool's top-level `description`
    // and the `type` field's `.describe()` call both used to claim balanced
    // search (omitting `type`) covers personas too ("all 5"/"all types"). It
    // doesn't — retrieveBalanced() never returns personas. Phrases implying
    // "all types"/"all five" are only acceptable when paired with language
    // that explicitly excludes personas from that set.
    function impliesPersonasInBalancedSearch(text: string): boolean {
      const claimsAllTypes = /\ball\s+(data\s+)?types\b/i.test(text) || /\ball\s+five\b/i.test(text) || /\ball\s+5\b/i.test(text);
      if (!claimsAllTypes) return false;
      const explicitlyExcludesPersonas = /persona/i.test(text) && /exclud/i.test(text);
      return !explicitlyExcludesPersonas;
    }

    const description = eiSearch!.description ?? "";
    expect(impliesPersonasInBalancedSearch(description)).toBe(false);
    expect(description).toMatch(/personas?.{0,40}exclud|exclud.{0,40}personas?/i);

    const typeSchema = eiSearch!.inputSchema as Record<string, unknown>;
    const properties = typeSchema.properties as Record<string, unknown>;
    const typeProperty = properties?.type as Record<string, unknown>;
    const typeDescription = (typeProperty?.description as string) ?? "";
    expect(impliesPersonasInBalancedSearch(typeDescription)).toBe(false);
    expect(typeDescription).toMatch(/personas?.{0,40}exclud|exclud.{0,40}personas?/i);
  });

  it("registers ei_create, ei_update, and ei_remove tools", async () => {
    ({ client } = await setupClient());
    const result = await client.listTools();
    const names = result.tools.map((t) => t.name);
    expect(names).toContain("ei_create");
    expect(names).toContain("ei_update");
    expect(names).toContain("ei_remove");
  });

  it("ei_create returns the created id and record as JSON", async () => {
    mockCreateEntity.mockResolvedValueOnce({ id: "new-id", record: { id: "new-id", name: "Test" } });
    ({ client } = await setupClient());
    const result = await client.callTool({
      name: "ei_create",
      arguments: { entity_type: "fact", data: { name: "Test", description: "x", sentiment: 0, validated_date: "" } },
    });
    const content = result.content as Array<{ type: string; text: string }>;
    const parsed = JSON.parse(content[0].text);
    expect(parsed.id).toBe("new-id");
    expect(parsed.record.name).toBe("Test");
    expect(mockCreateEntity).toHaveBeenCalledWith("fact", { name: "Test", description: "x", sentiment: 0, validated_date: "" });
  });

  it("ei_create surfaces CorrectionValidationError as text content with isError: true", async () => {
    mockCreateEntity.mockRejectedValueOnce(new MockCorrectionValidationError("Invalid fact: description: Required"));
    ({ client } = await setupClient());
    const result = await client.callTool({ name: "ei_create", arguments: { entity_type: "fact", data: {} } });
    const content = result.content as Array<{ type: string; text: string }>;
    expect(content[0].text).toContain("Error: Invalid fact");
    expect(result.isError).toBe(true);
  });

  it("ei_update returns the updated record as JSON", async () => {
    mockUpdateEntity.mockResolvedValueOnce({ id: "abc-123", name: "Updated" });
    ({ client } = await setupClient());
    const result = await client.callTool({
      name: "ei_update",
      arguments: { entity_type: "topic", id: "abc-123", data: { name: "Updated" } },
    });
    const content = result.content as Array<{ type: string; text: string }>;
    const parsed = JSON.parse(content[0].text);
    expect(parsed.name).toBe("Updated");
    expect(mockUpdateEntity).toHaveBeenCalledWith("topic", "abc-123", { name: "Updated" });
  });

  it("ei_update surfaces not-found errors as text content with isError: true", async () => {
    mockUpdateEntity.mockRejectedValueOnce(new Error("No topic found with id: missing-id"));
    ({ client } = await setupClient());
    const result = await client.callTool({
      name: "ei_update",
      arguments: { entity_type: "topic", id: "missing-id", data: {} },
    });
    const content = result.content as Array<{ type: string; text: string }>;
    expect(content[0].text).toContain("Error: No topic found with id: missing-id");
    expect(result.isError).toBe(true);
  });

  it("ei_remove returns removed confirmation as JSON", async () => {
    mockRemoveEntity.mockResolvedValueOnce(undefined);
    ({ client } = await setupClient());
    const result = await client.callTool({ name: "ei_remove", arguments: { entity_type: "person", id: "p-1" } });
    const content = result.content as Array<{ type: string; text: string }>;
    const parsed = JSON.parse(content[0].text);
    expect(parsed).toEqual({ removed: true, id: "p-1" });
    expect(mockRemoveEntity).toHaveBeenCalledWith("person", "p-1");
  });

  it("ei_remove surfaces not-found errors as text content with isError: true", async () => {
    mockRemoveEntity.mockRejectedValueOnce(new Error("No person found with id: missing-id"));
    ({ client } = await setupClient());
    const result = await client.callTool({ name: "ei_remove", arguments: { entity_type: "person", id: "missing-id" } });
    const content = result.content as Array<{ type: string; text: string }>;
    expect(content[0].text).toContain("Error: No person found with id: missing-id");
    expect(result.isError).toBe(true);
  });

  it("ei_update accepts entity_type: 'quote' and calls updateEntity with 'quote'", async () => {
    mockUpdateEntity.mockResolvedValueOnce({ id: "quote-1", text: "Corrected quote text" });
    ({ client } = await setupClient());
    const result = await client.callTool({
      name: "ei_update",
      arguments: { entity_type: "quote", id: "quote-1", data: { data_item_ids: ["person-b-id"] } },
    });
    const content = result.content as Array<{ type: string; text: string }>;
    const parsed = JSON.parse(content[0].text);
    expect(parsed.id).toBe("quote-1");
    expect(mockUpdateEntity).toHaveBeenCalledWith("quote", "quote-1", { data_item_ids: ["person-b-id"] });
  });

  it("ei_create rejects entity_type: 'quote' with a schema validation error before reaching createEntity", async () => {
    ({ client } = await setupClient());
    const callsBefore = mockCreateEntity.mock.calls.length;
    const result = await client.callTool({ name: "ei_create", arguments: { entity_type: "quote", data: {} } });
    expect(result.isError).toBe(true);
    const content = result.content as Array<{ type: string; text: string }>;
    expect(content[0].text).toContain("entity_type");
    expect(mockCreateEntity.mock.calls.length).toBe(callsBefore);
  });

  it("ei_remove accepts entity_type: 'quote' and calls removeEntity with 'quote'", async () => {
    mockRemoveEntity.mockResolvedValueOnce(undefined);
    ({ client } = await setupClient());
    const result = await client.callTool({ name: "ei_remove", arguments: { entity_type: "quote", id: "quote-1" } });
    const content = result.content as Array<{ type: string; text: string }>;
    const parsed = JSON.parse(content[0].text);
    expect(parsed).toEqual({ removed: true, id: "quote-1" });
    expect(mockRemoveEntity).toHaveBeenCalledWith("quote", "quote-1");
  });

  it("ei_remove(entity_type: 'quote') forwards a queued/pending response verbatim, never claiming {removed: true} (I3)", async () => {
    mockRemoveEntity.mockResolvedValueOnce({
      status: "queued",
      id: "quote-1",
      message: "Quote remove queued: a live Ei instance is processing this write; it has not been confirmed yet.",
    });
    ({ client } = await setupClient());
    const result = await client.callTool({ name: "ei_remove", arguments: { entity_type: "quote", id: "quote-1" } });
    const content = result.content as Array<{ type: string; text: string }>;
    const parsed = JSON.parse(content[0].text);
    expect(parsed).toEqual({ status: "queued", id: "quote-1", message: expect.stringContaining("queued") });
    expect(parsed).not.toEqual({ removed: true, id: "quote-1" });
    expect(result.isError).toBeUndefined();
  });

  it("ei_remove surfaces a quote not-found error as text content with isError: true", async () => {
    mockRemoveEntity.mockRejectedValueOnce(new Error("Cannot remove quote: no quote found with the supplied id"));
    ({ client } = await setupClient());
    const result = await client.callTool({ name: "ei_remove", arguments: { entity_type: "quote", id: "missing-id" } });
    const content = result.content as Array<{ type: string; text: string }>;
    expect(content[0].text).toBe("Error: Cannot remove quote: no quote found with the supplied id");
    expect(result.isError).toBe(true);
  });

  it("ei_create with entity_type 'persona' dispatches to createPersonaEntity and returns id+record", async () => {
    mockCreatePersonaEntity.mockResolvedValueOnce({
      id: "persona-new",
      record: { id: "persona-new", display_name: "New Persona" },
    });
    const createEntityCallsBefore = mockCreateEntity.mock.calls.length;
    ({ client } = await setupClient());
    const result = await client.callTool({
      name: "ei_create",
      arguments: { entity_type: "persona", data: { display_name: "New Persona" } },
    });
    const content = result.content as Array<{ type: string; text: string }>;
    const parsed = JSON.parse(content[0].text);
    expect(parsed.id).toBe("persona-new");
    expect(parsed.record.display_name).toBe("New Persona");
    expect(mockCreatePersonaEntity).toHaveBeenCalledWith({ display_name: "New Persona" });
    expect(mockCreateEntity.mock.calls.length).toBe(createEntityCallsBefore);
  });

  it("ei_update with entity_type 'persona' dispatches to updatePersonaEntity and returns the updated record", async () => {
    mockUpdatePersonaEntity.mockResolvedValueOnce({ id: "persona-1", display_name: "Updated Persona" });
    const updateEntityCallsBefore = mockUpdateEntity.mock.calls.length;
    ({ client } = await setupClient());
    const result = await client.callTool({
      name: "ei_update",
      arguments: { entity_type: "persona", id: "persona-1", data: { display_name: "Updated Persona" } },
    });
    const content = result.content as Array<{ type: string; text: string }>;
    const parsed = JSON.parse(content[0].text);
    expect(parsed.display_name).toBe("Updated Persona");
    expect(mockUpdatePersonaEntity).toHaveBeenCalledWith("persona-1", { display_name: "Updated Persona" });
    expect(mockUpdateEntity.mock.calls.length).toBe(updateEntityCallsBefore);
  });
  it("ei_update with entity_type 'persona' forwards optional settings and returns the full updated record", async () => {
    const data = { include_message_timestamps: true, preferred_theme: "dark" };
    const updatedPersona = { id: "persona-forward", ...data };
    mockUpdatePersonaEntity.mockResolvedValueOnce(updatedPersona);
    const updateEntityCallsBefore = mockUpdateEntity.mock.calls.length;
    ({ client } = await setupClient());
    const result = await client.callTool({
      name: "ei_update",
      arguments: { entity_type: "persona", id: "persona-forward", data },
    });
    const content = result.content as Array<{ type: string; text: string }>;
    const parsed = JSON.parse(content[0].text);
    expect(mockUpdatePersonaEntity).toHaveBeenCalledWith("persona-forward", data);
    expect(mockUpdateEntity.mock.calls.length).toBe(updateEntityCallsBefore);
    expect(parsed).toEqual(updatedPersona);
  });

  it("ei_remove with entity_type 'persona' dispatches to removePersonaEntity and returns {removed: true, id}", async () => {
    mockRemovePersonaEntity.mockResolvedValueOnce(undefined);
    const removeEntityCallsBefore = mockRemoveEntity.mock.calls.length;
    ({ client } = await setupClient());
    const result = await client.callTool({ name: "ei_remove", arguments: { entity_type: "persona", id: "persona-1" } });
    const content = result.content as Array<{ type: string; text: string }>;
    const parsed = JSON.parse(content[0].text);
    expect(parsed).toEqual({ removed: true, id: "persona-1" });
    expect(mockRemovePersonaEntity).toHaveBeenCalledWith("persona-1");
    expect(mockRemoveEntity.mock.calls.length).toBe(removeEntityCallsBefore);
  });

  it("ei_create with entity_type 'persona' surfaces a CorrectionValidationError (missing display_name) as isError: true", async () => {
    mockCreatePersonaEntity.mockRejectedValueOnce(
      new MockCorrectionValidationError("Invalid persona: display_name: Required")
    );
    ({ client } = await setupClient());
    const result = await client.callTool({ name: "ei_create", arguments: { entity_type: "persona", data: {} } });
    const content = result.content as Array<{ type: string; text: string }>;
    expect(content[0].text).toContain("Error: Invalid persona: display_name: Required");
    expect(result.isError).toBe(true);
  });

  it("ei_remove with entity_type 'persona' and id 'ei' returns isError: true with the exact reserved-persona message", async () => {
    mockRemovePersonaEntity.mockRejectedValueOnce(new Error('Cannot delete reserved persona "ei". Use archive instead.'));
    ({ client } = await setupClient());
    const result = await client.callTool({ name: "ei_remove", arguments: { entity_type: "persona", id: "ei" } });
    const content = result.content as Array<{ type: string; text: string }>;
    expect(content[0].text).toBe('Error: Cannot delete reserved persona "ei". Use archive instead.');
    expect(result.isError).toBe(true);
  });

  it("ei_remove with entity_type 'persona' and id 'emmet' returns isError: true with the exact reserved-persona message", async () => {
    mockRemovePersonaEntity.mockRejectedValueOnce(new Error('Cannot delete reserved persona "emmet". Use archive instead.'));
    ({ client } = await setupClient());
    const result = await client.callTool({ name: "ei_remove", arguments: { entity_type: "persona", id: "emmet" } });
    const content = result.content as Array<{ type: string; text: string }>;
    expect(content[0].text).toBe('Error: Cannot delete reserved persona "emmet". Use archive instead.');
    expect(result.isError).toBe(true);
    expect(mockRemovePersonaEntity).toHaveBeenCalledWith("emmet");
  });

  // I1 (.sisyphus/reviews/quote-attestation-final-implementation.md):
  // ei_quote_create/ei_quote_fix/ei_quote_relink register a `.passthrough()`
  // z.object() SCHEMA INSTANCE for inputSchema, not a flat raw shape --
  // a raw shape gets rebuilt by the MCP SDK into a plain (non-strict)
  // z.object(shape) that silently STRIPS any undeclared key during its
  // own pre-handler parse (see
  // node_modules/@modelcontextprotocol/sdk/dist/esm/server/zod-compat.js
  // `objectFromShape()`) -- that silent strip was the original I1 bug: a
  // forged field like `speaker` never reached createQuoteEntity/
  // fixQuoteEntity, so the endpoint's own strict schema never got a
  // chance to reject it, and the call reported success. `.passthrough()`
  // instead keeps every key in the parsed object, and mcp.ts's own
  // rejectUnknownQuoteFields() checks it against an allow-list BEFORE
  // any named field is destructured, returning isError: true with a
  // fixed, generic message (never the caller's own key name) and never
  // calling the endpoint at all.
  it("registers ei_quote_create and ei_quote_fix tools", async () => {
    ({ client } = await setupClient());
    const result = await client.listTools();
    const names = result.tools.map((t) => t.name);
    expect(names).toContain("ei_quote_create");
    expect(names).toContain("ei_quote_fix");
  });

  it("ei_quote_create's schema declares only message_id/text/start/end -- no speaker/channel/created_by/etc.", async () => {
    ({ client } = await setupClient());
    const tools = await client.listTools();
    const tool = tools.tools.find((t) => t.name === "ei_quote_create");
    const properties = (tool!.inputSchema as Record<string, unknown>).properties as Record<string, unknown>;
    expect(Object.keys(properties).sort()).toEqual(["end", "message_id", "start", "text"]);
  });

  it("ei_quote_fix's schema declares only quote_id/text/start/end -- no message_id/speaker/created_by/etc.", async () => {
    ({ client } = await setupClient());
    const tools = await client.listTools();
    const tool = tools.tools.find((t) => t.name === "ei_quote_fix");
    const properties = (tool!.inputSchema as Record<string, unknown>).properties as Record<string, unknown>;
    expect(Object.keys(properties).sort()).toEqual(["end", "quote_id", "start", "text"]);
  });

  it("M2: ei_quote_create/ei_quote_fix's start/end field descriptions describe a first-match consistency check, never a disambiguation/selection mechanism", async () => {
    ({ client } = await setupClient());
    const tools = await client.listTools();
    for (const toolName of ["ei_quote_create", "ei_quote_fix"] as const) {
      const tool = tools.tools.find((t) => t.name === toolName);
      const properties = (tool!.inputSchema as Record<string, unknown>).properties as Record<string, { description?: string }>;
      const startDescription = properties.start.description ?? "";
      expect(startDescription).not.toMatch(/disambiguate/i);
      expect(startDescription).toMatch(/first-match|first match/i);
    }
  });

  it("ei_quote_create forwards message_id/text/start/end to createQuoteEntity and returns the created record as JSON", async () => {
    mockCreateQuoteEntity.mockResolvedValueOnce({ id: "new-quote-1", text: "the lease bug is the real defect", channel: "Test Room" });
    ({ client } = await setupClient());
    const result = await client.callTool({
      name: "ei_quote_create",
      arguments: { message_id: "ei:room-msg-1", text: "the lease bug is the real defect", start: 6, end: 38 },
    });
    const content = result.content as Array<{ type: string; text: string }>;
    const parsed = JSON.parse(content[0].text);
    expect(parsed.id).toBe("new-quote-1");
    expect(result.isError).toBeUndefined();
    expect(mockCreateQuoteEntity).toHaveBeenCalledWith({ message_id: "ei:room-msg-1", text: "the lease bug is the real defect", start: 6, end: 38 });
  });

  it("ei_quote_create omits start/end from the forwarded call when the caller doesn't supply them", async () => {
    mockCreateQuoteEntity.mockResolvedValueOnce({ id: "new-quote-2" });
    ({ client } = await setupClient());
    await client.callTool({
      name: "ei_quote_create",
      arguments: { message_id: "ei:room-msg-1", text: "the lease bug is the real defect" },
    });
    expect(mockCreateQuoteEntity).toHaveBeenCalledWith({ message_id: "ei:room-msg-1", text: "the lease bug is the real defect", start: undefined, end: undefined });
  });

  it("ei_quote_create rejects an undeclared 'speaker' argument with isError: true, never reaching createQuoteEntity (I1)", async () => {
    ({ client } = await setupClient());
    const callsBefore = mockCreateQuoteEntity.mock.calls.length;
    const result = await client.callTool({
      name: "ei_quote_create",
      // @ts-expect-error -- deliberately supplying an undeclared field to prove it's rejected, not silently stripped
      arguments: { message_id: "ei:room-msg-1", text: "the lease bug is the real defect", speaker: "forged" },
    });
    expect(result.isError).toBe(true);
    const content = result.content as Array<{ type: string; text: string }>;
    expect(content[0].text).toBe("Error: Invalid quote (create): unrecognized field(s) present");
    expect(mockCreateQuoteEntity.mock.calls.length).toBe(callsBefore);
  });

  it("ei_quote_create surfaces a refusal Error as isError: true text", async () => {
    mockCreateQuoteEntity.mockRejectedValueOnce(new Error("Cannot create quote: quote text not found in source message"));
    ({ client } = await setupClient());
    const result = await client.callTool({
      name: "ei_quote_create",
      arguments: { message_id: "ei:room-msg-1", text: "not present anywhere" },
    });
    const content = result.content as Array<{ type: string; text: string }>;
    expect(content[0].text).toBe("Error: Cannot create quote: quote text not found in source message");
    expect(result.isError).toBe(true);
  });

  it("ei_quote_create surfaces CorrectionValidationError as text content with isError: true", async () => {
    mockCreateQuoteEntity.mockRejectedValueOnce(new MockCorrectionValidationError("Invalid quote (create): message_id: Required"));
    ({ client } = await setupClient());
    const result = await client.callTool({ name: "ei_quote_create", arguments: { message_id: "x", text: "y" } });
    const content = result.content as Array<{ type: string; text: string }>;
    expect(content[0].text).toContain("Error: Invalid quote (create)");
    expect(result.isError).toBe(true);
  });

  it("ei_quote_fix forwards quote_id/text/start/end to fixQuoteEntity and returns the fixed record as JSON", async () => {
    mockFixQuoteEntity.mockResolvedValueOnce({ id: "sourced-quote-1", text: "corrected text" });
    ({ client } = await setupClient());
    const result = await client.callTool({
      name: "ei_quote_fix",
      arguments: { quote_id: "sourced-quote-1", text: "corrected text", start: 10, end: 24 },
    });
    const content = result.content as Array<{ type: string; text: string }>;
    const parsed = JSON.parse(content[0].text);
    expect(parsed.text).toBe("corrected text");
    expect(result.isError).toBeUndefined();
    expect(mockFixQuoteEntity).toHaveBeenCalledWith({ quote_id: "sourced-quote-1", text: "corrected text", start: 10, end: 24 });
  });

  it("ei_quote_fix rejects an undeclared 'message_id' argument with isError: true, never reaching fixQuoteEntity (I1)", async () => {
    ({ client } = await setupClient());
    const callsBefore = mockFixQuoteEntity.mock.calls.length;
    const result = await client.callTool({
      name: "ei_quote_fix",
      // @ts-expect-error -- deliberately supplying an undeclared field to prove it's rejected, not silently stripped
      arguments: { quote_id: "sourced-quote-1", text: "anything", message_id: "forged" },
    });
    expect(result.isError).toBe(true);
    const content = result.content as Array<{ type: string; text: string }>;
    expect(content[0].text).toBe("Error: Invalid quote (fix): unrecognized field(s) present");
    expect(mockFixQuoteEntity.mock.calls.length).toBe(callsBefore);
  });

  it("ei_quote_fix surfaces a refusal Error as isError: true text", async () => {
    mockFixQuoteEntity.mockRejectedValueOnce(new Error("Cannot fix quote: no source message to verify against"));
    ({ client } = await setupClient());
    const result = await client.callTool({ name: "ei_quote_fix", arguments: { quote_id: "orphaned-1", text: "anything" } });
    const content = result.content as Array<{ type: string; text: string }>;
    expect(content[0].text).toBe("Error: Cannot fix quote: no source message to verify against");
    expect(result.isError).toBe(true);
  });

  it("registers ei_quote_relink tool", async () => {
    ({ client } = await setupClient());
    const result = await client.listTools();
    const names = result.tools.map((t) => t.name);
    expect(names).toContain("ei_quote_relink");
  });

  it("ei_quote_relink's schema declares only id/data_item_ids -- no text/message_id/verified/etc.", async () => {
    ({ client } = await setupClient());
    const tools = await client.listTools();
    const tool = tools.tools.find((t) => t.name === "ei_quote_relink");
    const properties = (tool!.inputSchema as Record<string, unknown>).properties as Record<string, unknown>;
    expect(Object.keys(properties).sort()).toEqual(["data_item_ids", "id"]);
  });

  it("ei_quote_relink forwards id/data_item_ids to relinkQuoteEntity and returns the relinked record as JSON", async () => {
    mockRelinkQuoteEntity.mockResolvedValueOnce({ id: "quote-1", data_item_ids: ["person-b-id"] });
    ({ client } = await setupClient());
    const result = await client.callTool({
      name: "ei_quote_relink",
      arguments: { id: "quote-1", data_item_ids: ["person-b-id"] },
    });
    const content = result.content as Array<{ type: string; text: string }>;
    const parsed = JSON.parse(content[0].text);
    expect(parsed).toEqual({ id: "quote-1", data_item_ids: ["person-b-id"] });
    expect(mockRelinkQuoteEntity).toHaveBeenCalledWith({ id: "quote-1", data_item_ids: ["person-b-id"] });
  });

  it("ei_quote_relink rejects an undeclared 'text' argument with isError: true, never reaching relinkQuoteEntity (I1)", async () => {
    ({ client } = await setupClient());
    const callsBefore = mockRelinkQuoteEntity.mock.calls.length;
    const result = await client.callTool({
      name: "ei_quote_relink",
      // @ts-expect-error -- deliberately supplying an undeclared field to prove it's rejected, not silently stripped
      arguments: { id: "quote-1", data_item_ids: [], text: "forged" },
    });
    expect(result.isError).toBe(true);
    const content = result.content as Array<{ type: string; text: string }>;
    expect(content[0].text).toBe("Error: Invalid quote (relink): unrecognized field(s) present");
    expect(mockRelinkQuoteEntity.mock.calls.length).toBe(callsBefore);
  });

  it("ei_quote_relink surfaces a not-found refusal as isError: true text", async () => {
    mockRelinkQuoteEntity.mockRejectedValueOnce(new Error("Cannot relink quote: no quote found with the supplied id"));
    ({ client } = await setupClient());
    const result = await client.callTool({ name: "ei_quote_relink", arguments: { id: "missing-id", data_item_ids: [] } });
    const content = result.content as Array<{ type: string; text: string }>;
    expect(content[0].text).toBe("Error: Cannot relink quote: no quote found with the supplied id");
    expect(result.isError).toBe(true);
  });

  it("ei_quote_relink surfaces CorrectionValidationError as text content with isError: true", async () => {
    mockRelinkQuoteEntity.mockRejectedValueOnce(new MockCorrectionValidationError("Invalid quote (relink): data_item_ids references unknown or disallowed entities: made-up-id"));
    ({ client } = await setupClient());
    const result = await client.callTool({ name: "ei_quote_relink", arguments: { id: "quote-1", data_item_ids: ["made-up-id"] } });
    const content = result.content as Array<{ type: string; text: string }>;
    expect(content[0].text).toContain("Error: Invalid quote (relink)");
    expect(result.isError).toBe(true);
  });
  // Bolt 003 D3/R3/AT3: ei_signal_confirm/ei_signal_dismiss register a
  // `.passthrough()` z.object() schema instance, same rationale as the
  // quote tools above (I1) -- a raw shape gets rebuilt by the MCP SDK
  // into a non-strict z.object() that silently strips an undeclared key
  // (including a caller-forged `delta`) before the handler ever sees
  // it. mcp.ts's own rejectUnknownSignalFields() checks the parsed
  // object against an allow-list BEFORE any named field is
  // destructured, returning isError: true with the same fixed,
  // generic message shape the quote tools' own helper uses.
  describe("ei_signal_confirm / ei_signal_dismiss (Bolt 003 D1/D3, R1/R3, AT1/AT3)", () => {
    it("registers ei_signal_confirm and ei_signal_dismiss tools", async () => {
      ({ client } = await setupClient());
      const result = await client.listTools();
      const names = result.tools.map((t) => t.name);
      expect(names).toContain("ei_signal_confirm");
      expect(names).toContain("ei_signal_dismiss");
    });

    it("ei_signal_confirm's schema declares only persona_id/signal_id/actor -- no delta", async () => {
      ({ client } = await setupClient());
      const tools = await client.listTools();
      const tool = tools.tools.find((t) => t.name === "ei_signal_confirm");
      const properties = (tool!.inputSchema as Record<string, unknown>).properties as Record<string, unknown>;
      expect(Object.keys(properties).sort()).toEqual(["actor", "persona_id", "signal_id"]);
    });

    it("ei_signal_confirm rejects an undeclared 'delta' argument with isError: true, never reaching applyPersonaSignal (AT1/AT3)", async () => {
      ({ client } = await setupClient());
      const callsBefore = mockApplyPersonaSignal.mock.calls.length;
      const result = await client.callTool({
        name: "ei_signal_confirm",
        arguments: { persona_id: "persona-1", signal_id: "signal-1", actor: "flare576", delta: { short_description: "x", long_description: "y", traits: [], topics: [] } },
      });
      const content = result.content as Array<{ type: string; text: string }>;
      expect(content[0].text).toBe("Error: Invalid signal (confirm): unrecognized field(s) present");
      expect(result.isError).toBe(true);
      expect(mockApplyPersonaSignal.mock.calls.length).toBe(callsBefore);
    });

    it("ei_signal_confirm rejects a delta member field supplied at the top level (short_description), same as a full delta (AT1)", async () => {
      ({ client } = await setupClient());
      const callsBefore = mockApplyPersonaSignal.mock.calls.length;
      const result = await client.callTool({
        name: "ei_signal_confirm",
        arguments: { persona_id: "persona-1", signal_id: "signal-1", actor: "flare576", short_description: "Terse." },
      });
      const content = result.content as Array<{ type: string; text: string }>;
      expect(content[0].text).toBe("Error: Invalid signal (confirm): unrecognized field(s) present");
      expect(result.isError).toBe(true);
      expect(mockApplyPersonaSignal.mock.calls.length).toBe(callsBefore);
    });

    it("ei_signal_confirm forwards persona_id/signal_id/actor to applyPersonaSignal and returns the result as JSON", async () => {
      mockApplyPersonaSignal.mockResolvedValueOnce({ status: "recorded", signal: { id: "signal-1", status: "reviewed" } });
      ({ client } = await setupClient());
      const result = await client.callTool({
        name: "ei_signal_confirm",
        arguments: { persona_id: "persona-1", signal_id: "signal-1", actor: "flare576" },
      });
      const content = result.content as Array<{ type: string; text: string }>;
      expect(JSON.parse(content[0].text)).toEqual({ status: "recorded", signal: { id: "signal-1", status: "reviewed" } });
      expect(result.isError).toBeUndefined();
      expect(mockApplyPersonaSignal).toHaveBeenCalledWith("persona-1", "signal-1", "confirm", { actor: "flare576" });
    });

    it("ei_signal_dismiss's schema declares only persona_id/signal_id/actor -- no delta", async () => {
      ({ client } = await setupClient());
      const tools = await client.listTools();
      const tool = tools.tools.find((t) => t.name === "ei_signal_dismiss");
      const properties = (tool!.inputSchema as Record<string, unknown>).properties as Record<string, unknown>;
      expect(Object.keys(properties).sort()).toEqual(["actor", "persona_id", "signal_id"]);
    });

    it("ei_signal_dismiss rejects an undeclared 'delta' argument with isError: true, never reaching applyPersonaSignal (AT1/AT3)", async () => {
      ({ client } = await setupClient());
      const callsBefore = mockApplyPersonaSignal.mock.calls.length;
      const result = await client.callTool({
        name: "ei_signal_dismiss",
        arguments: { persona_id: "persona-1", signal_id: "signal-1", actor: "flare576", delta: { short_description: "x", long_description: "y", traits: [], topics: [] } },
      });
      const content = result.content as Array<{ type: string; text: string }>;
      expect(content[0].text).toBe("Error: Invalid signal (dismiss): unrecognized field(s) present");
      expect(result.isError).toBe(true);
      expect(mockApplyPersonaSignal.mock.calls.length).toBe(callsBefore);
    });

    it("ei_signal_dismiss forwards persona_id/signal_id/actor to applyPersonaSignal and returns the result as JSON", async () => {
      mockApplyPersonaSignal.mockResolvedValueOnce({ status: "recorded", signal: { id: "signal-1", status: "dismissed" } });
      ({ client } = await setupClient());
      const result = await client.callTool({
        name: "ei_signal_dismiss",
        arguments: { persona_id: "persona-1", signal_id: "signal-1", actor: "flare576" },
      });
      const content = result.content as Array<{ type: string; text: string }>;
      expect(JSON.parse(content[0].text)).toEqual({ status: "recorded", signal: { id: "signal-1", status: "dismissed" } });
      expect(result.isError).toBeUndefined();
      expect(mockApplyPersonaSignal).toHaveBeenCalledWith("persona-1", "signal-1", "dismiss", { actor: "flare576" });
    });
  });

  describe("ei_signal_list", () => {
    it("registers the ei_signal_list tool", async () => {
      ({ client } = await setupClient());
      const result = await client.listTools();
      const names = result.tools.map((t) => t.name);
      expect(names).toContain("ei_signal_list");
    });

    it("forwards listPersonaSignals' result verbatim for both lenses, called with the exact persona_id and loaded state (S5, .sisyphus/reviews/session-fixes-review/beta-code-review.md)", async () => {
      const loadedState = { personas: {} };
      mockLoadLatestState.mockResolvedValueOnce(loadedState);
      const signals = [
        {
          type: "signal",
          personaId: "persona-1",
          lens: "persona",
          id: "signal-1",
          subject_persona_id: "persona-1",
          claim: "Speaks in short sentences.",
          dimension: "voice",
          status: "candidate",
          evidence_ids: ["msg-1"],
          first_observed_at: "2026-01-01T00:00:00.000Z",
          last_observed_at: "2026-01-01T00:00:00.000Z",
          observer_kinds: ["human"],
          recurrence_count: 1,
        },
        {
          type: "signal",
          personaId: "persona-1",
          lens: "agent",
          id: "signal-2",
          subject_persona_id: "persona-1",
          claim: "Always runs the full test suite before yielding.",
          dimension: "behavior",
          status: "dismissed",
          evidence_ids: ["msg-2"],
          first_observed_at: "2026-01-02T00:00:00.000Z",
          last_observed_at: "2026-01-02T00:00:00.000Z",
          observer_kinds: ["subject_self"],
          recurrence_count: 2,
        },
      ];
      mockListPersonaSignals.mockReturnValueOnce(signals);
      ({ client } = await setupClient());
      const result = await client.callTool({ name: "ei_signal_list", arguments: { persona_id: "persona-1" } });
      const content = result.content as Array<{ type: string; text: string }>;
      expect(JSON.parse(content[0].text)).toEqual(signals);
      // S5: the forwarding test previously only checked the OUTPUT
      // matched whatever the mock was told to return -- it would have
      // passed even if the handler called listPersonaSignals with the
      // wrong persona_id or a stale/different state object. Assert the
      // actual call arguments too.
      expect(mockListPersonaSignals).toHaveBeenCalledWith("persona-1", loadedState);
    });

    it("returns an empty array (not an error) when the persona has no signals", async () => {
      mockLoadLatestState.mockResolvedValueOnce({ personas: {} });
      mockListPersonaSignals.mockReturnValueOnce([]);
      ({ client } = await setupClient());
      const result = await client.callTool({ name: "ei_signal_list", arguments: { persona_id: "persona-no-signals" } });
      const content = result.content as Array<{ type: string; text: string }>;
      expect(JSON.parse(content[0].text)).toEqual([]);
      expect(result.isError).toBeFalsy();
    });

    it("returns the exact no-saved-state message when loadLatestState resolves null", async () => {
      mockLoadLatestState.mockResolvedValueOnce(null);
      ({ client } = await setupClient());
      const result = await client.callTool({ name: "ei_signal_list", arguments: { persona_id: "persona-1" } });
      const content = result.content as Array<{ type: string; text: string }>;
      expect(content[0].text).toBe("No saved state found. Is EI_DATA_PATH set correctly?");
    });

    it("declares persona_id as a required string in its inputSchema", async () => {
      ({ client } = await setupClient());
      const tools = await client.listTools();
      const tool = tools.tools.find((t) => t.name === "ei_signal_list")!;
      const schema = tool.inputSchema as Record<string, unknown>;
      const properties = schema.properties as Record<string, { type?: string }>;
      expect(properties.persona_id.type).toBe("string");
      expect(schema.required as string[]).toContain("persona_id");
    });
  });
});
