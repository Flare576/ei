import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { retrieveBalanced, lookupById, loadLatestState, type BalancedResult } from "./retrieval.js";
import type { StorageState } from "../core/types/index.js";
import { resolvePersonaId, filterByPersona, filterTypeSpecificByPersona, filterBySource, filterTypeSpecificBySource } from "./persona-filter.js";

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
        "Search the user's Ei knowledge base — a persistent memory store built from conversations. Returns facts, people, topics of interest, and quotes. People results include an identifiers array (e.g. GitHub username, Discord handle, email, nickname) — query by any name or handle to find what Ei knows about that person. Results include entity IDs that can be passed back to ei_lookup for full detail. Omit query to browse by recency (use with recent=true or persona filter).",
      inputSchema: {
        query: z.string().optional().describe("Search text. Supports natural language. Omit to browse without semantic filtering — useful with recent=true or persona filter."),
        type: z
          .enum(["facts", "people", "topics", "quotes", "personas"])
          .optional()
          .describe(
            "Filter to a specific data type. Omit to search all types (balanced across all 5)."
          ),
        persona: z
          .string()
          .optional()
          .describe(
            "Filter to entities a specific persona has learned about. Use the persona display name."
          ),
        source: z
          .string()
          .optional()
          .describe(
            "Filter to entities from a specific source. Prefix match against namespaced source identifiers (e.g. 'cursor', 'opencode', 'opencode:ses_abc123')."
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
    async ({ query: rawQuery, type, persona, source, limit, recent }) => {
      const query = rawQuery ?? "";
      const options = { recent: recent ?? false };
      const effectiveLimit = limit ?? 10;

      let state: StorageState | null = null;
      let personaId: string | undefined;
      if (persona || source) {
        state = await loadLatestState();
        if (state && persona) {
          personaId = resolvePersonaId(state, persona) ?? undefined;
          if (!personaId) {
            return {
              content: [{ type: "text" as const, text: `Persona "${persona}" not found.` }],
            };
          }
        }
      }

      let result: unknown;
      if (type) {
        const module = await import(`./commands/${type}.js`);
        result = await (module.execute as (q: string, l: number, o: { recent: boolean }) => Promise<unknown>)(query, effectiveLimit, options);
        if (personaId && state) {
          result = filterTypeSpecificByPersona(result as { id: string }[], state, personaId, type);
        }
        if (source && state) {
          result = filterTypeSpecificBySource(result as { id: string }[], state, source, type);
        }
      } else {
        result = await retrieveBalanced(query, effectiveLimit, options);
        if (personaId && state) {
          result = filterByPersona(result as BalancedResult[], state, personaId);
        }
        if (source && state) {
          result = filterBySource(result as BalancedResult[], state, source);
        }
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
        source: z
          .string()
          .optional()
          .describe(
            "Filter to entities from a specific source. Prefix match against namespaced source identifiers (e.g. 'cursor', 'opencode', 'opencode:ses_abc123'). If the entity does not match, returns not found."
          ),
      },
    },
    async ({ id, source }) => {
      const result = await lookupById(id);

      if (result === null) {
        return { content: [{ type: "text" as const, text: `No entity found with ID: ${id}` }] };
      }

      if (source) {
        const sources = (result as { sources?: string[] }).sources;
        if (!sources?.some((s) => s.startsWith(source))) {
          return { content: [{ type: "text" as const, text: `No entity found with ID: ${id}` }] };
        }
      }

      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
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
