import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { retrieveBalanced, lookupById, resolveExternalMessage, loadLatestState, type BalancedResult } from "./retrieval.js";
import type { StorageState } from "../core/types.js";
import type { Message } from "../core/types.js";
import type { RoomMessage } from "../core/types/rooms.js";
import { resolvePersonaId, filterByPersona, filterTypeSpecificByPersona, filterBySource, filterTypeSpecificBySource } from "./persona-filter.js";
import { createEntity, updateEntity, removeEntity, createQuoteEntity, fixQuoteEntity, relinkQuoteEntity, CorrectionValidationError, type QuoteWritePending } from "./corrections-endpoints.js";
import { createPersonaEntity, updatePersonaEntity, removePersonaEntity } from "./persona-corrections.js";
import { classifyMalformedRoomPrimary } from "../core/utils/message-refusal.js";

/**
 * Allow-lists for ei_quote_create/ei_quote_fix/ei_quote_relink's raw MCP
 * arguments, checked BEFORE any named field is destructured out of them
 * (I1, .sisyphus/reviews/quote-attestation-final-implementation.md).
 *
 * These 3 tools register a `.passthrough()` object schema instance, not
 * the SDK's default raw-shape adapter -- a plain object-of-Zod-types
 * literal gets rebuilt by the SDK into a non-strict `z.object()` that
 * silently STRIPS any key outside the declared shape during its own
 * pre-handler parse (see node_modules/@modelcontextprotocol/sdk's
 * server/zod-compat.js `objectFromShape()`). That silent strip was the
 * entire bug: a forged top-level field like `speaker`/`created_by`/
 * `message_id` never reached createQuoteEntity/fixQuoteEntity/
 * relinkQuoteEntity, so the endpoint's own strict schema never got a
 * chance to reject it, and the call reported success instead of
 * `isError: true`. `.passthrough()` keeps every key -- forged or not --
 * in the parsed object long enough for this function to see and reject
 * it, with a FIXED, generic message that never echoes the caller's own
 * key name: Zod's own `unrecognized_keys` issue embeds the raw key text
 * verbatim (`Unrecognized key(s) in object: 'speaker'`), and relying on
 * the SDK's own z.strictObject-triggered error text would reopen the
 * exact class of MCP-text injection formatValidationIssues()
 * (src/core/entity-schemas.ts) already closes for the identical failure
 * mode -- considered and rejected for that reason.
 */
function rejectUnknownQuoteFields(
  args: Record<string, unknown>,
  allowed: readonly string[],
  label: string
): { content: { type: "text"; text: string }[]; isError: true } | null {
  const hasUnknown = Object.keys(args).some((key) => !allowed.includes(key));
  if (!hasUnknown) return null;
  return {
    content: [{ type: "text" as const, text: `Error: Invalid quote (${label}): unrecognized field(s) present` }],
    isError: true,
  };
}

const QUOTE_CREATE_FIELDS = ["message_id", "text", "start", "end"] as const;
const QUOTE_FIX_FIELDS = ["quote_id", "text", "start", "end"] as const;
const QUOTE_RELINK_FIELDS = ["id", "data_item_ids"] as const;

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
        "Search the user's Ei knowledge base — a persistent memory store built from conversations. Use at session start to load user context, and mid-session whenever the user references past work, preferences, or people. Balanced search (no type filter) returns facts, people, topics of interest, and quotes — personas are excluded unless you pass type: \"personas\" explicitly. TYPE GUIDANCE: 'facts' are ONLY user demographics (name, age, job title, location, family structure, physical traits). For interests, opinions, hobbies, or anything the human cares about, use 'topics'. For named individuals, use 'people'. For verbatim things said, use 'quotes'. For AI agent identities with traits and working style, use 'personas'. People results include an identifiers array (e.g. GitHub username, Discord handle, email, nickname) — query by any name or handle to find what Ei knows about that person. Persona results include traits and topics — use type='personas' with the persona's name OR a natural-language description of their role to load a persona's character sheet. Results include entity IDs that can be passed to ei_lookup for full detail. Omit query with recent=true to browse the most recently discussed items.",
      inputSchema: {
        query: z.string().optional().describe("Search text. Supports natural language. Omit to browse without semantic filtering — useful with recent=true or persona filter."),
        type: z
          .enum(["facts", "people", "topics", "quotes", "personas"])
          .optional()
          .describe(
            "Filter to a specific data type. Omit to search a balanced set across facts, people, topics, and quotes — personas are excluded from that balanced set and require passing type: \"personas\" explicitly. For 'personas': matches by display name first, then falls back to semantic search of persona descriptions — use the persona's name (e.g. 'Sisyphus') or a description of their role (e.g. 'primary coding agent'). For 'people': semantic search on person descriptions. Note: 'personas' and 'people' are distinct — personas are AI agent identity records with traits/topics; people are human contacts."
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
            "Filter to entities from a specific source. Prefix match against namespaced source identifiers (e.g. 'cursor', 'codex', 'opencode', 'opencode:my-machine', 'codex:my-machine:thread-id')."
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
        "Retrieve the full record for any Ei entity by ID — facts, topics, people, quotes, or personas. Use when ei_search returns an item and you need its complete details (all fields, traits, topics, identifiers, etc.). Pass the entity id from ei_search results. For facts, topics, and people, the result also includes a `linked_quotes` array listing every quote whose data_item_ids references this entity — check this before correcting a bad merge/split (e.g. un-merging an over-merged Person) to see the full blast radius.",
      inputSchema: {
        id: z.string().describe("The entity ID to look up."),
        source: z
          .string()
          .optional()
          .describe(
            "Filter to entities from a specific source. Prefix match against namespaced source identifiers (e.g. 'cursor', 'codex', 'opencode', 'opencode:my-machine', 'codex:my-machine:thread-id'). If the entity does not match, returns not found."
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
    "ei_fetch_message",
    {
      description:
        "Retrieve a specific message by its fully-qualified ID, with optional surrounding conversation context. Use when ei_search returns a quote with a message_id and you want to read the original exchange. The 'before' and 'after' parameters expand the context window in either direction (default 0). Accepts IDs from any integrated source: 'ei:uuid' searches Ei state, 'opencode:machine:session:id' queries OpenCode SQLite, 'claudecode:...' scans Claude Code JSONL files, 'cursor:...' reads the Cursor DB, and 'codex:...' reads Codex rollout history.",
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
      const beforeN = Math.max(0, Math.floor(beforeCount ?? 0));
      const afterN = Math.max(0, Math.floor(afterCount ?? 0));

      const externalResult = await resolveExternalMessage(id, beforeN, afterN);
      if (externalResult) {
        if ("error" in externalResult) {
          // I6 remaining gap (final review, round 2): retrieval.ts's
          // cross-machine error text interpolates the caller-supplied id's
          // parsed machine segment raw (`parsed.machine`, derived directly
          // from `id`) -- forwarding externalResult.error verbatim here
          // would echo arbitrary control/ANSI bytes into public MCP-facing
          // text. Drop it for a fixed, id-free message, matching this same
          // tool's other two branches below (`refused`/local-scan refusals),
          // which are already id-free at the source per the earlier I6 fix.
          return { content: [{ type: "text" as const, text: "Message is from a different machine and is not available here." }] };
        }
        if ("refused" in externalResult) {
          return { content: [{ type: "text" as const, text: String(externalResult.reason) }] };
        }
        return { content: [{ type: "text" as const, text: JSON.stringify(externalResult, null, 2) }] };
      }

      const state = await loadLatestState();
      if (!state) {
        return {
          content: [{ type: "text" as const, text: "No saved state found. Is EI_DATA_PATH set correctly?" }],
        };
      }

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
        return personaMap[m.persona_id]?.entity.display_name ?? "Participant";
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

        // I5 (.sisyphus/reviews/quote-attestation-final-implementation.md):
        // this bare-id local scan is a fallback for stale, pre-migration
        // on-disk state (resolveExternalMessage's own "ei-room" branch
        // already refuses this exact shape for any QUALIFIED id -- see
        // retrieval.ts). Reject a malformed room-persona-primary message
        // (role "persona", no persona_id at all) here too, instead of
        // silently omitting speaker_name and serving it as if it were an
        // ordinary envelope.
        const roomRefusal = classifyMalformedRoomPrimary(msg);
        if (roomRefusal) {
          return { content: [{ type: "text" as const, text: roomRefusal.reason }] };
        }
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

      // I6 remaining gap (final review, round 2): never echo the raw
      // caller-supplied `id` into this public MCP-facing text -- matches
      // the fixed, id-free "Message not found" string the sibling browser
      // executor (src/core/tools/builtin/fetch-message.ts) already uses.
      return {
        content: [{ type: "text" as const, text: "Message not found" }],
      };
    }
  );

  server.registerTool(
    "ei_create",
    {
      description:
        "Create a new entity in the user's Ei knowledge base — a fact, topic, person, or persona. Use to add data the extraction pipeline missed, split/correct bad merges, or author a new AI persona's identity (display name, description, traits, topics). The record is validated against the entity type's schema server-side; unknown fields are rejected. Returns the assigned id and the full stored record. Not available for quotes — use ei_quote_create instead, which verifies the quote's text against its resolved source message before persisting anything.",
      inputSchema: {
        entity_type: z.enum(["fact", "topic", "person", "persona"]).describe("The type of entity to create."),
        data: z
          .record(z.unknown())
          .describe(
            "The entity fields. Fact requires name/description/sentiment/validated_date. Topic requires name/description/sentiment. Person requires a name and/or at least one identifier. Persona requires display_name (traits/topics/external_reflection_only default to empty arrays/false if omitted; group_primary/groups_visible/is_paused/is_archived/tools/model and every other in-app-only setting are not accepted here at all — server-owned, see ei_update's own description). Structural validation happens server-side against the entity type's schema."
          ),
      },
    },
    async ({ entity_type, data }) => {
      try {
        if (entity_type === "persona") {
          const { id, record } = await createPersonaEntity(data);
          return { content: [{ type: "text" as const, text: JSON.stringify({ id, record }, null, 2) }] };
        }
        const { id, record } = await createEntity(entity_type, data);
        return { content: [{ type: "text" as const, text: JSON.stringify({ id, record }, null, 2) }] };
      } catch (e) {
        const message = e instanceof CorrectionValidationError ? e.message : (e as Error).message;
        return { content: [{ type: "text" as const, text: `Error: ${message}` }], isError: true };
      }
    }
  );

  server.registerTool(
    "ei_update",
    {
      description:
        "Update an existing fact, topic, person, or persona by ID. For topic/person/persona this is an RFC 7396 JSON Merge Patch, NOT a full replacement: `data` should contain ONLY the fields you're actually changing. A field you omit is left completely unchanged — do not round-trip the whole ei_lookup record back in, that used to be required and is now unnecessary (and, for a hidden/server-owned field, actively rejected, see below). Send a field's new value to set it; send `null` for a field to clear it (this is the only way to clear `pending_update` — a Critic-proposed identity revision — non-null content for it is always rejected). Arrays (traits[], topics[], aliases, notes, identifiers) replace wholesale when present: sending `traits` means \"these are ALL the traits now,\" so include every trait you want to keep, not just the new one. `fact` is the one permanent exception (ADR-029): it stays a full-record replacement exactly like before, since it has no defaults and nothing to merge onto. Neither topic/person/persona nor fact accept `tools`/`model`/`heartbeat_delay_ms`/`context_window_ms`/`include_message_timestamps`/`context_boundary`/`is_paused`/`pause_until`/`is_archived`/`archived_at`/`group_primary`/`groups_visible`/`exposure_current`/`exposure_desired`/`last_ei_asked`/`embedding`/`learned_by`/`last_changed_by`/`sources`/`interested_personas`/`persona_groups` at all — these are server-owned or in-app-only settings and are rejected as unrecognized fields, not silently ignored. Use to fix bad extracted data (e.g. correcting a person record where two people were wrongly merged into one) or author a persona's character (rewriting display_name/traits[]/topics[], or toggling `external_reflection_only`). Renaming a persona to a reserved name (\"new\", \"clone\") is rejected. Built-in reserved personas (\"ei\", \"emmet\") CANNOT be archived through this tool anymore — `is_archived` left the external contract entirely; use the TUI's `/archive` command instead. NOT usable for quotes: entity_type \"quote\" is still accepted by the schema but ALWAYS rejects, because a full-record replacement could assert text, a speaker, or a timestamp that nobody verified. Use ei_quote_fix to correct a quote's text, ei_quote_relink to change which facts/topics/people it links to, or ei_remove to delete it.",
      inputSchema: {
        entity_type: z.enum(["fact", "topic", "person", "quote", "persona"]).describe("The type of entity to update."),
        id: z.string().describe("The ID of the entity to replace, from ei_lookup or ei_search."),
        data: z
          .unknown()
          .optional()
          .describe(
            "For fact: the COMPLETE replacement record (the permanent full-record exception). For topic/person/persona: a merge patch — only the fields being changed, per RFC 7396 (omit = unchanged, null = clear, value = set; arrays replace wholesale). Not required when entity_type is \"quote\": quote update is retired (ADR-012) and always rejects before this field is ever inspected."
          ),
      },
    },
    async ({ entity_type, id, data }) => {
      try {
        const record = entity_type === "persona" ? await updatePersonaEntity(id, data) : await updateEntity(entity_type, id, data);
        return { content: [{ type: "text" as const, text: JSON.stringify(record, null, 2) }] };
      } catch (e) {
        const message = e instanceof CorrectionValidationError ? e.message : (e as Error).message;
        return { content: [{ type: "text" as const, text: `Error: ${message}` }], isError: true };
      }
    }
  );

  server.registerTool(
    "ei_remove",
    {
      description:
        "Permanently remove a fact, topic, person, quote, or persona from the user's Ei knowledge base by ID. Use to delete bad extracted data that shouldn't be split or corrected, just dropped entirely, to drop a quote that shouldn't exist at all, or to delete an AI persona that's no longer needed. Removing a quote asserts nothing about its provenance, so it is permitted on any quote — including one whose source message can no longer be resolved, or one that predates attestation (message_id is null). Reserved built-in personas (\"ei\", \"emmet\") cannot be deleted this way — `is_archived` is no longer part of the external write contract at all (ADR-031), so there is no CLI/MCP equivalent; use the TUI's `/archive` command instead.",
      inputSchema: {
        entity_type: z.enum(["fact", "topic", "person", "persona", "quote"]).describe("The type of entity to remove."),
        id: z.string().describe("The ID of the entity to remove, from ei_lookup or ei_search."),
      },
    },
    async ({ entity_type, id }) => {
      try {
        if (entity_type === "persona") {
          await removePersonaEntity(id);
          return { content: [{ type: "text" as const, text: JSON.stringify({ removed: true, id }, null, 2) }] };
        }
        // I3 (.sisyphus/reviews/quote-attestation-final-implementation.md):
        // removeEntity's quote branch can return a QuoteWritePending
        // instead of confirming -- a live Ei instance holds ei.lock, so
        // the record is only queued, not yet validated/applied. Forward
        // that honest pending shape verbatim instead of always claiming
        // {removed: true}; fact/topic/person always resolve `undefined`
        // here, so their own response stays byte-identical to before.
        const pending: QuoteWritePending | undefined = await removeEntity(entity_type, id);
        return { content: [{ type: "text" as const, text: JSON.stringify(pending ?? { removed: true, id }, null, 2) }] };
      } catch (e) {
        return { content: [{ type: "text" as const, text: `Error: ${(e as Error).message}` }], isError: true };
      }
    }
  );

  server.registerTool(
    "ei_quote_create",
    {
      description:
        "Create a new, source-verified Quote by matching caller-supplied text against a resolved source message. The message must already exist and be resolvable — use ei_fetch_message first to read it and copy the exact text to quote. speaker/timestamp/channel/embedding are all derived server-side from the resolved source and can never be supplied by the caller (rejected at the schema level). If the verified span overlaps an existing quote already on that message, the two merge into one record instead of coexisting — no new quote is inserted at all in that case, the existing one absorbs this text's links, and the response is `{status: \"merged\", quote, absorbed, message}` instead of the plain created record. Refuses without persisting anything if the text cannot be found in the source message (normalized-exact or word-boundary match), or if the source message itself cannot be resolved. `start`/`end` are optional and are a consistency check only, never a way to select a later occurrence of repeated text: if supplied, both must exactly match the location the server independently finds, or the write refuses.",
      inputSchema: z.object({
        message_id: z.string().describe("Fully-qualified id of the source message to quote from — from ei_search's quote.message_id field or ei_fetch_message."),
        text: z.string().describe("The exact quote text to verify against the source message's content. Must appear verbatim (allowing for whitespace/punctuation normalization) in the resolved message."),
        start: z.number().optional().describe("Optional: the expected raw character offset (start) of the quote within the source message — a first-match consistency check only, never a way to select a later occurrence of repeated text (the matcher always returns the first match). Must be supplied together with `end` and must exactly match what the server independently finds, or the write is refused."),
        end: z.number().optional().describe("Optional: the expected raw character offset (end, exclusive) of the quote within the source message. See `start`."),
      }).passthrough(),
    },
    async (args) => {
      const rejection = rejectUnknownQuoteFields(args, QUOTE_CREATE_FIELDS, "create");
      if (rejection) return rejection;
      const { message_id, text, start, end } = args;
      try {
        const record = await createQuoteEntity({ message_id, text, start, end });
        return { content: [{ type: "text" as const, text: JSON.stringify(record, null, 2) }] };
      } catch (e) {
        const message = e instanceof CorrectionValidationError ? e.message : (e as Error).message;
        return { content: [{ type: "text" as const, text: `Error: ${message}` }], isError: true };
      }
    }
  );

  server.registerTool(
    "ei_quote_fix",
    {
      description:
        "Re-verify and correct an existing Quote's text against its already-recorded source message. Only `text`/`start`/`end`/the embedding can change from what the caller supplies — message_id, speaker, timestamp, channel, links (data_item_ids/persona_groups), and provenance (created_at/created_by) can never be supplied by the caller (rejected at the schema level); a fix never re-resolves a new source, it only re-verifies against the one the quote already has. If the corrected span now overlaps another quote already on that message, the two merge into one record instead of coexisting — the surviving quote absorbs the other's links, and the absorbed quote no longer exists; the response is `{status: \"merged\", quote, absorbed, message}` in that case instead of the plain fixed record. Refuses without persisting anything if the quote has no message_id to verify against (it predates attestation), if the recorded source message can no longer be resolved, if the text cannot be found in that source, or if supplied start/end offsets don't match the location the server independently found.",
      inputSchema: z.object({
        quote_id: z.string().describe("The id of the existing Quote to fix, from ei_search or ei_lookup."),
        text: z.string().describe("The corrected quote text to verify against the quote's existing source message."),
        start: z.number().optional().describe("Optional: the expected raw character offset (start) of the quote — a first-match consistency check only, never a way to select a later occurrence of repeated text (the matcher always returns the first match). Must be supplied together with `end` and must exactly match what the server independently finds, or the write is refused."),
        end: z.number().optional().describe("Optional: the expected raw character offset (end, exclusive). See `start`."),
      }).passthrough(),
    },
    async (args) => {
      const rejection = rejectUnknownQuoteFields(args, QUOTE_FIX_FIELDS, "fix");
      if (rejection) return rejection;
      const { quote_id, text, start, end } = args;
      try {
        const record = await fixQuoteEntity({ quote_id, text, start, end });
        return { content: [{ type: "text" as const, text: JSON.stringify(record, null, 2) }] };
      } catch (e) {
        const message = e instanceof CorrectionValidationError ? e.message : (e as Error).message;
        return { content: [{ type: "text" as const, text: `Error: ${message}` }], isError: true };
      }
    }
  );

  server.registerTool(
    "ei_quote_relink",
    {
      description:
        "Change which facts/topics/people an existing Quote is linked to (data_item_ids) — the only field this tool can change. Asserts no provenance: it never touches text/message_id/speaker/timestamp/etc, so unlike ei_quote_create/ei_quote_fix it's permitted on every quote regardless of source state, including one whose source message can no longer be resolved (dangling) or that predates attestation entirely (orphaned, message_id is null). `data_item_ids` is the complete replacement list, not an additive delta. Every target id must already resolve to an existing fact, topic, or person, and the quote id itself must already exist, or the whole call is refused before anything is queued.",
      inputSchema: z.object({
        id: z.string().describe("The id of the existing Quote to relink, from ei_search or ei_lookup."),
        data_item_ids: z.array(z.string()).describe("The complete replacement list of fact/topic/person ids this quote should be linked to — not additive, the full new set. Every id must resolve to an existing fact, topic, or person."),
      }).passthrough(),
    },
    async (args) => {
      const rejection = rejectUnknownQuoteFields(args, QUOTE_RELINK_FIELDS, "relink");
      if (rejection) return rejection;
      const { id, data_item_ids } = args;
      try {
        const record = await relinkQuoteEntity({ id, data_item_ids });
        return { content: [{ type: "text" as const, text: JSON.stringify(record, null, 2) }] };
      } catch (e) {
        const message = e instanceof CorrectionValidationError ? e.message : (e as Error).message;
        return { content: [{ type: "text" as const, text: `Error: ${message}` }], isError: true };
      }
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
