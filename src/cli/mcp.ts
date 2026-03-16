import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { retrieveBalanced, lookupById } from "./retrieval.js";

// Exported so tests can inject their own transport
export function createMcpServer(): McpServer {
  const server = new McpServer({
    name: "ei",
    version: "1.0.0",
  });

  server.registerTool(
    "ei_search",
    {
      description:
        "Search the user's Ei knowledge base — a persistent memory store built from conversations. Returns facts, people, topics of interest, and quotes. Results include entity IDs that can be passed back to ei_lookup for full detail.",
      inputSchema: {
        query: z.string().describe("Search text. Supports natural language."),
        type: z
          .enum(["facts", "people", "topics", "quotes"])
          .optional()
          .describe(
            "Filter to a specific data type. Omit to search all types (balanced across all 4)."
          ),
        limit: z
          .number()
          .optional()
          .default(10)
          .describe("Maximum number of results to return."),
        recent: z
          .boolean()
          .optional()
          .describe("If true, sort by most recently mentioned."),
      },
    },
    async ({ query, type, limit, recent }) => {
      const options = { recent: recent ?? false };
      const effectiveLimit = limit ?? 10;

      let result: unknown;
      if (type) {
        const module = await import(`./commands/${type}.js`);
        result = await (module.execute as (q: string, l: number, o: { recent: boolean }) => Promise<unknown>)(query, effectiveLimit, options);
      } else {
        result = await retrieveBalanced(query, effectiveLimit, options);
      }

      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  server.registerTool(
    "ei_lookup",
    {
      description:
        "Look up a specific entity in the Ei knowledge base by ID. Returns the full entity record. Use IDs from ei_search results.",
      inputSchema: {
        id: z.string().describe("The entity ID to look up."),
      },
    },
    async ({ id }) => {
      const result = await lookupById(id);
      const text =
        result === null
          ? `No entity found with ID: ${id}`
          : JSON.stringify(result, null, 2);

      return {
        content: [{ type: "text" as const, text }],
      };
    }
  );

  return server;
}

export async function handleMcpCommand(_args: string[]): Promise<void> {
  const server = createMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);

  process.stderr.write("Ei MCP server running on stdio\n");

  // Block until the client disconnects (stdin closes), otherwise
  // the caller's process.exit(0) fires immediately and kills the server
  // before it can process any messages.
  await new Promise<void>((resolve) => {
    process.stdin.once("end", resolve);
    process.stdin.once("close", resolve);
  });
}
