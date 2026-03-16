import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("../../../src/cli/retrieval.js", () => ({
  retrieveBalanced: vi.fn().mockResolvedValue([
    { type: "fact", id: "fact_1", name: "Test Fact", description: "A test fact", sentiment: 0.5 },
  ]),
  lookupById: vi.fn().mockResolvedValue(null),
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
});
