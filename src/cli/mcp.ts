import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { retrieveBalanced, lookupById, loadLatestState, type BalancedResult } from "./retrieval.js";
import type { StorageState } from "../core/types.js";
import type { Message } from "../core/types.js";
import type { RoomMessage } from "../core/types/rooms.js";
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
        "Search the user's Ei knowledge base — a persistent memory store built from conversations. Returns facts, people, topics of interest, quotes, and personas. People results include an identifiers array (e.g. GitHub username, Discord handle, email, nickname) — query by any name or handle to find what Ei knows about that person. Persona results include traits and topics that define the persona's identity and working style — use type='personas' with the persona's name OR a natural-language description of what they do to load a persona's character sheet. Results include entity IDs that can be passed back to ei_lookup for full detail. Omit query to browse by recency (use with recent=true or persona filter).",
      inputSchema: {
        query: z.string().optional().describe("Search text. Supports natural language. Omit to browse without semantic filtering — useful with recent=true or persona filter."),
        type: z
          .enum(["facts", "people", "topics", "quotes", "personas"])
          .optional()
          .describe(
            "Filter to a specific data type. Omit to search all types (balanced across all 5). For 'personas': matches by display name first, then falls back to semantic search of persona descriptions — use the persona's name (e.g. 'Sisyphus') or a description of their role (e.g. 'primary coding agent'). For 'people': semantic search on person descriptions. Note: 'personas' and 'people' are distinct — personas are AI agent identity records with traits/topics; people are human contacts."
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
            "Filter to entities from a specific source. Prefix match against namespaced source identifiers (e.g. 'cursor', 'opencode', 'opencode:my-machine', 'opencode:my-machine:ses_abc123')."
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
            "Filter to entities from a specific source. Prefix match against namespaced source identifiers (e.g. 'cursor', 'opencode', 'opencode:my-machine', 'opencode:my-machine:ses_abc123'). If the entity does not match, returns not found."
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

  server.registerTool(
    "ei_find_memory",
    {
      description:
        "Search Ei's persistent knowledge base — facts, topics, people, and quotes learned across ALL conversations over time. Use when you need context about the user, their life, relationships, or interests that may not be visible in the current exchange. Returns results grouped by type. Use `recent: true` to retrieve what's been discussed recently.",
      inputSchema: {
        query: z
          .string()
          .optional()
          .describe(
            "What to search for — a person, topic, fact, or anything Ei has learned about the user. Omit with recent: true to browse recent items."
          ),
        types: z
          .array(z.enum(["facts", "topics", "people", "quotes"]))
          .optional()
          .describe("Limit search to specific memory types (default: all types)"),
        limit: z
          .number()
          .optional()
          .default(10)
          .describe("Max results per type to return (default: 10, max: 20)"),
        recent: z
          .boolean()
          .optional()
          .describe(
            "If true, return recently-mentioned results sorted by last_mentioned date instead of relevance. Combine with a query to filter recent results by topic."
          ),
        persona: z
          .string()
          .optional()
          .describe(
            "Filter results to what a specific persona has learned. Use the persona display name."
          ),
      },
    },
    async ({ query: rawQuery, types, limit, recent, persona }) => {
      const query = rawQuery ?? "";
      const effectiveLimit = Math.min(limit ?? 10, 20);
      const options = { recent: recent ?? false };

      const humanTypes = ["facts", "topics", "people", "quotes"] as const;
      type HumanType = (typeof humanTypes)[number];
      const requestedTypes: HumanType[] =
        types && types.length > 0
          ? (types as HumanType[])
          : [...humanTypes];

      let state: StorageState | null = null;
      let personaId: string | undefined;
      if (persona) {
        state = await loadLatestState();
        if (state) {
          personaId = resolvePersonaId(state, persona) ?? undefined;
          if (!personaId) {
            return {
              content: [{ type: "text" as const, text: `Persona "${persona}" not found.` }],
            };
          }
        }
      }

      const grouped: Record<string, unknown[]> = {};
      for (const t of requestedTypes) {
        const module = await import(`./commands/${t}.js`);
        let results = await (
          module.execute as (
            q: string,
            l: number,
            o: { recent: boolean }
          ) => Promise<{ id: string }[]>
        )(query, effectiveLimit, options);
        if (personaId && state) {
          results = filterTypeSpecificByPersona(results, state, personaId, t);
        }
        if (results.length > 0) {
          grouped[t] = results;
        }
      }

      if (Object.keys(grouped).length === 0) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ result: "No relevant memories found for this query." }),
            },
          ],
        };
      }

      return {
        content: [{ type: "text" as const, text: JSON.stringify(grouped, null, 2) }],
      };
    }
  );

  server.registerTool(
    "ei_fetch_memory",
    {
      description:
        "Retrieve the full record for a specific memory by its ID. Use when ei_find_memory or ei_search returns an item and you need its complete details. Returns the full Fact, Topic, Person, or Quote record.",
      inputSchema: {
        id: z.string().describe("The ID of the memory record to retrieve"),
      },
    },
    async ({ id }) => {
      const result = await lookupById(id);

      if (result === null || result.type === "persona") {
        return {
          content: [{ type: "text" as const, text: `No memory record found with ID: ${id}` }],
        };
      }

      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  server.registerTool(
    "ei_fetch_message",
    {
      description:
        "Retrieve a specific message by its ID, with optional surrounding context. Use when ei_find_memory returns a quote with a message_id and you want to read the original conversation. The 'before' and 'after' parameters return that many additional messages for context (default 0).",
      inputSchema: {
        id: z.string().describe("The ID of the message to retrieve"),
        before: z
          .number()
          .optional()
          .default(0)
          .describe("Number of preceding messages to include (default 0)"),
        after: z
          .number()
          .optional()
          .default(0)
          .describe("Number of following messages to include (default 0)"),
      },
    },
    async ({ id, before: beforeCount, after: afterCount }) => {
      const state = await loadLatestState();
      if (!state) {
        return {
          content: [{ type: "text" as const, text: "No saved state found. Is EI_DATA_PATH set correctly?" }],
        };
      }

      const beforeN = Math.max(0, Math.floor(beforeCount ?? 0));
      const afterN = Math.max(0, Math.floor(afterCount ?? 0));

      const stripPersonaMessage = (m: Message) => ({
        id: m.id,
        role: m.role,
        ...(m.content !== undefined ? { content: m.content } : {}),
        ...(m.silence_reason !== undefined ? { silence_reason: m.silence_reason } : {}),
        timestamp: m.timestamp,
        ...(m.speaker_name !== undefined ? { speaker_name: m.speaker_name } : {}),
      });

      for (const { entity: persona, messages } of Object.values(state.personas)) {
        const idx = messages.findIndex((m) => m.id === id);
        if (idx === -1) continue;

        const msg = messages[idx];
        const beforeMsgs = messages.slice(Math.max(0, idx - beforeN), idx).map(stripPersonaMessage);
        const afterMsgs = messages.slice(idx + 1, idx + 1 + afterN).map(stripPersonaMessage);

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                { message: stripPersonaMessage(msg), before: beforeMsgs, after: afterMsgs, source: persona.display_name },
                null,
                2
              ),
            },
          ],
        };
      }

      const resolveRoomPersonaName = (
        m: RoomMessage,
        personaMap: Record<string, { entity: { display_name: string }; messages: Message[] }>
      ): string | undefined => {
        if (m.role !== "persona" || !m.persona_id) return undefined;
        return personaMap[m.persona_id]?.entity.display_name;
      };

      const stripRoomMessage = (
        m: RoomMessage,
        personaMap: Record<string, { entity: { display_name: string }; messages: Message[] }>
      ) => ({
        id: m.id,
        role: m.role,
        ...(m.content !== undefined ? { content: m.content } : {}),
        ...(m.silence_reason !== undefined ? { silence_reason: m.silence_reason } : {}),
        timestamp: m.timestamp,
        ...(resolveRoomPersonaName(m, personaMap) !== undefined
          ? { speaker_name: resolveRoomPersonaName(m, personaMap) }
          : {}),
      });

      for (const room of Object.values(state.rooms ?? {})) {
        const idx = room.messages.findIndex((m) => m.id === id);
        if (idx === -1) continue;

        const msg = room.messages[idx];
        const beforeMsgs = room.messages
          .slice(Math.max(0, idx - beforeN), idx)
          .map((m) => stripRoomMessage(m, state.personas));
        const afterMsgs = room.messages
          .slice(idx + 1, idx + 1 + afterN)
          .map((m) => stripRoomMessage(m, state.personas));

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                { message: stripRoomMessage(msg, state.personas), before: beforeMsgs, after: afterMsgs, source: room.display_name },
                null,
                2
              ),
            },
          ],
        };
      }

      return {
        content: [{ type: "text" as const, text: `Message not found: ${id}` }],
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
