import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("../../../src/cli/retrieval.js", () => ({
  retrieveBalanced: vi.fn().mockResolvedValue([
    { type: "fact", id: "fact_1", name: "Test Fact", description: "A test fact", sentiment: 0.5 },
  ]),
  lookupById: vi.fn().mockResolvedValue(null),
}));

const { MockCorrectionValidationError, mockCreateEntity, mockUpdateEntity, mockRemoveEntity } = vi.hoisted(() => {
  class MockCorrectionValidationError extends Error {}
  return {
    MockCorrectionValidationError,
    mockCreateEntity: vi.fn(),
    mockUpdateEntity: vi.fn(),
    mockRemoveEntity: vi.fn(),
  };
});

vi.mock("../../../src/cli/corrections-endpoints.js", () => ({
  createEntity: mockCreateEntity,
  updateEntity: mockUpdateEntity,
  removeEntity: mockRemoveEntity,
  CorrectionValidationError: MockCorrectionValidationError,
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
});
