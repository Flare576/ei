// src/core/bootstrap-tools.ts
import { StateManager } from "./state-manager.js";
import type { ToolProvider } from "./types.js";

/**
 * Seed built-in tool providers and tools if they don't exist yet.
 * Called on every startup (after state load/restore) — safe to call repeatedly.
 * New builtins added in future releases will be seeded automatically.
 */
export function bootstrapTools(stateManager: StateManager): void {
    const now = new Date().toISOString();

    for (const name of ["find_memory", "fetch_memory", "fetch_message", "read_memory"]) {
      const tool = stateManager.tools_getByName(name);
      if (tool) stateManager.tools_remove(tool.id);
    }

    // --- Ei built-in provider ---
    if (!stateManager.tools_getProviderById("ei")) {
      const eiProvider: ToolProvider = {
        id: "ei",
        name: "ei",
        display_name: "Ei Built-ins",
        description: "Built-in tools that ship with Ei. No external API needed.",
        builtin: true,
        config: {},
        enabled: true,
        created_at: now,
      };
      stateManager.tools_addProvider(eiProvider);
    }

    // file_read tool (TUI only)
    stateManager.tools_upsertBuiltin({
        id: crypto.randomUUID(),
        provider_id: "ei",
        name: "file_read",
        display_name: "Read File",
        description:
          "Read the contents of a file from the local filesystem. Use list_directory first to explore folder structure. Only available in the TUI.",
        input_schema: {
          type: "object",
          properties: {
            path: { type: "string", description: "Absolute or relative path to the file" },
          },
          required: ["path"],
        },
        runtime: "node",
        builtin: true,
        enabled: true,
        created_at: now,
        max_calls_per_interaction: 5,
    });

    // list_directory tool (TUI only)
    stateManager.tools_upsertBuiltin({
        id: crypto.randomUUID(),
        provider_id: "ei",
        name: "list_directory",
        display_name: "List Directory",
        description:
          "List the contents of a directory on the local filesystem. Returns filenames prefixed with [FILE] or [DIR]. Use this to explore folder structure before reading files. Only available in the TUI.",
        input_schema: {
          type: "object",
          properties: {
            path: { type: "string", description: "Absolute or relative path to the directory (e.g. ~/Projects/myapp or /home/user/docs)" },
          },
          required: ["path"],
        },
        runtime: "node",
        builtin: true,
        enabled: true,
        created_at: now,
        max_calls_per_interaction: 5,
    });

    // directory_tree tool (TUI only)
    stateManager.tools_upsertBuiltin({
        id: crypto.randomUUID(),
        provider_id: "ei",
        name: "directory_tree",
        display_name: "Directory Tree",
        description:
          "Show a recursive tree of a directory up to a configurable depth. Returns a JSON tree with name, type, and children fields. Default max_depth is 3, maximum is 8. Only available in the TUI.",
        input_schema: {
          type: "object",
          properties: {
            path: { type: "string", description: "Absolute or relative path to the directory" },
            max_depth: { type: "number", description: "Maximum depth to recurse (1-8, default 3)" },
          },
          required: ["path"],
        },
        runtime: "node",
        builtin: true,
        enabled: true,
        created_at: now,
        max_calls_per_interaction: 3,
    });

    // search_files tool (TUI only)
    stateManager.tools_upsertBuiltin({
        id: crypto.randomUUID(),
        provider_id: "ei",
        name: "search_files",
        display_name: "Search Files",
        description:
          "Recursively search for files by name pattern within a directory. Supports * wildcards. Returns matching absolute paths. Skips node_modules, .git, dist. Only available in the TUI.",
        input_schema: {
          type: "object",
          properties: {
            path: { type: "string", description: "Root directory to search from" },
            pattern: { type: "string", description: "Filename glob pattern, e.g. \"*.ts\" or \"README*\"" },
          },
          required: ["path", "pattern"],
        },
        runtime: "node",
        builtin: true,
        enabled: true,
        created_at: now,
        max_calls_per_interaction: 3,
    });

    // grep tool (TUI only)
    stateManager.tools_upsertBuiltin({
        id: crypto.randomUUID(),
        provider_id: "ei",
        name: "grep",
        display_name: "Grep",
        description:
          "Search file contents for lines matching a regex pattern. Recursively searches a directory (or a single file). Skips binary files and node_modules. Returns matching file, line number, and text. Only available in the TUI.",
        input_schema: {
          type: "object",
          properties: {
            pattern: { type: "string", description: "Regex pattern to search for" },
            path: { type: "string", description: "File or directory to search" },
            include: { type: "string", description: "Optional glob to filter filenames, e.g. \"*.ts\"" },
            case_insensitive: { type: "boolean", description: "Case-insensitive match (default false)" },
          },
          required: ["pattern", "path"],
        },
        runtime: "node",
        builtin: true,
        enabled: true,
        created_at: now,
        max_calls_per_interaction: 5,
    });

    // get_file_info tool (TUI only)
    stateManager.tools_upsertBuiltin({
        id: crypto.randomUUID(),
        provider_id: "ei",
        name: "get_file_info",
        display_name: "Get File Info",
        description:
          "Get metadata about a file or directory: type, size, permissions, created/modified/accessed timestamps. Only available in the TUI.",
        input_schema: {
          type: "object",
          properties: {
            path: { type: "string", description: "Absolute or relative path to the file or directory" },
          },
          required: ["path"],
        },
        runtime: "node",
        builtin: true,
        enabled: true,
        created_at: now,
        max_calls_per_interaction: 5,
    });

    // web_fetch tool
    stateManager.tools_upsertBuiltin({
        id: crypto.randomUUID(),
        provider_id: "ei",
        name: "web_fetch",
        display_name: "Web Fetch",
        description:
          "Fetch content from a URL and return the text. Useful for reading web pages, documentation, or public APIs. HTML is stripped to plain text. Only available in the TUI.",
        input_schema: {
          type: "object",
          properties: {
            url: { type: "string", description: "The URL to fetch (http or https only)" },
          },
          required: ["url"],
        },
        runtime: "node",
        builtin: true,
        enabled: true,
        created_at: now,
        max_calls_per_interaction: 3,
    });

    // --- Tavily Search provider ---
    if (!stateManager.tools_getProviderById("tavily")) {
      const tavilyProvider: ToolProvider = {
        id: "tavily",
        name: "tavily",
        display_name: "Tavily Search",
        description:
          "Browser-compatible web search. Requires a Tavily API key (free tier: 1000 requests/month).",
        builtin: true,
        config: { api_key: "" },
        enabled: false,
        created_at: now,
      };
      stateManager.tools_addProvider(tavilyProvider);
    }

    // tavily_web_search
    stateManager.tools_upsertBuiltin({
        id: crypto.randomUUID(),
        provider_id: "tavily",
        name: "tavily_web_search",
        display_name: "Web Search",
        description:
          "Search the web using Tavily. Use for current events, fact verification, or any topic that benefits from up-to-date information.",
        input_schema: {
          type: "object",
          properties: {
            query: { type: "string", description: "Search query" },
            max_results: { type: "number", description: "Number of results (default: 5, max: 10)" },
          },
          required: ["query"],
        },
        runtime: "any",
        builtin: true,
        enabled: true,
        created_at: now,
        max_calls_per_interaction: 3,
    });

    // tavily_news_search
    stateManager.tools_upsertBuiltin({
        id: crypto.randomUUID(),
        provider_id: "tavily",
        name: "tavily_news_search",
        display_name: "News Search",
        description:
          "Search recent news articles using Tavily. Use for current events and recent developments.",
        input_schema: {
          type: "object",
          properties: {
            query: { type: "string", description: "News search query" },
            max_results: { type: "number", description: "Number of results (default: 5, max: 10)" },
          },
          required: ["query"],
        },
        runtime: "any",
        builtin: true,
        enabled: true,
        created_at: now,
        max_calls_per_interaction: 3,
    });

    // --- Spotify provider ---
    if (!stateManager.tools_getProviderById("spotify")) {
      const spotifyProvider: ToolProvider = {
        id: "spotify",
        name: "spotify",
        display_name: "Spotify",
        description:
          "Access your Spotify playback and music library. Connect via Settings → Tool Kits → Spotify.",
        builtin: true,
        config: { spotify_refresh_token: "" },
        enabled: false,
        created_at: now,
      };
      stateManager.tools_addProvider(spotifyProvider);
    }

    // get_currently_playing
    stateManager.tools_upsertBuiltin({
        id: crypto.randomUUID(),
        provider_id: "spotify",
        name: "get_currently_playing",
        display_name: "Currently Playing",
        description:
          "Get the song currently playing on the user's Spotify. Returns artist, title, album, playback state, and progress. Returns nothing_playing if nothing is active.",
        input_schema: {
          type: "object",
          properties: {},
          required: [],
        },
        runtime: "any",
        builtin: true,
        enabled: true,
        created_at: now,
        max_calls_per_interaction: 3,
    });

    // get_liked_songs
    stateManager.tools_upsertBuiltin({
        id: crypto.randomUUID(),
        provider_id: "spotify",
        name: "get_liked_songs",
        display_name: "Liked Songs",
        description:
          "Get the user's full Spotify liked songs library. Returns an array of { artist, title, added_at }. Results are cached for 30 minutes. Ask the user before calling — it may return thousands of tracks.",
        input_schema: {
          type: "object",
          properties: {},
          required: [],
        },
        runtime: "any",
        builtin: true,
        enabled: true,
        created_at: now,
        max_calls_per_interaction: 1,
    });

    // submit_response tool — NOT auto-injected under any current step. submitToolByStep
    // (src/core/processor.ts) wires HandleHeartbeatCheck to submit_heartbeat_check instead.
    // PersonaResponse and RoomResponse agents use natural Markdown output instead.
    // Not user-configurable; invisible in the tools UI. Terminates the tool loop immediately
    // when called; its arguments become response.parsed.
    stateManager.tools_upsertBuiltin({
        id: crypto.randomUUID(),
        provider_id: "ei",
        name: "submit_response",
        display_name: "Submit Response",
        description: "Submit your response to the conversation. Call this when you are ready to respond — after any research or tool use is complete.",
        input_schema: {
          type: "object",
          properties: {
            should_respond: {
              type: "boolean",
              description: "Whether you are responding (true) or staying silent (false)",
            },
            content: {
              type: "string",
              description: "Your response in Markdown. Required when should_respond is true. Use _underscores_ for actions or stage directions inline with your text.",
            },
            reason: {
              type: "string",
              description: "Why you are staying silent. Only used when should_respond is false.",
            },
          },
          required: ["should_respond"],
          additionalProperties: false,
        },
        runtime: "any",
        builtin: true,
        enabled: true,
        is_submit: true,
        max_calls_per_interaction: 1,
        created_at: now,
    });

    stateManager.tools_upsertBuiltin({
        id: crypto.randomUUID(),
        provider_id: "ei",
        name: "submit_heartbeat_check",
        display_name: "Submit Heartbeat Decision",
        description: "Submit your decision on whether to reach out with a message. Call this when you have decided.",
        input_schema: {
          type: "object",
          properties: {
            should_respond: { type: "boolean", description: "Whether you want to initiate a message" },
            topic: { type: "string", description: "The specific topic you want to discuss (when should_respond is true)" },
            message: { type: "string", description: "Your actual message to them (when should_respond is true)" },
          },
          required: ["should_respond"],
          additionalProperties: false,
        },
        runtime: "any",
        builtin: true,
        enabled: true,
        is_submit: true,
        max_calls_per_interaction: 1,
        created_at: now,
    });

    stateManager.tools_upsertBuiltin({
        id: crypto.randomUUID(),
        provider_id: "ei",
        name: "submit_ei_heartbeat",
        display_name: "Submit Ei Heartbeat Decision",
        description: "Submit your choice of item to follow up on, or indicate nothing warrants reaching out.",
        input_schema: {
          type: "object",
          properties: {
            should_respond: { type: "boolean", description: "Whether Ei wants to check in about an item" },
            id: { type: "string", description: "ID of the item you chose (when should_respond is true)" },
            my_response: { type: "string", description: "The check-in message (for Person/Topic/Persona items)" },
          },
          required: ["should_respond"],
          additionalProperties: false,
        },
        runtime: "any",
        builtin: true,
        enabled: true,
        is_submit: true,
        max_calls_per_interaction: 1,
        created_at: now,
    });

    stateManager.tools_upsertBuiltin({
        id: crypto.randomUUID(),
        provider_id: "ei",
        name: "submit_dedup_decisions",
        display_name: "Submit Dedup Decisions",
        description: "Submit your merge, remove, and add decisions for this cluster of records.",
        input_schema: {
          type: "object",
          properties: {
            update: {
              type: "array",
              description: "Records to update with merged data. Must include at least one (the canonical record).",
              items: {
                type: "object",
                properties: {
                  id: { type: "string" },
                  type: { type: "string", enum: ["topic", "person", "trait"] },
                  name: { type: "string" },
                  description: { type: "string" },
                  sentiment: { type: "number" },
                  strength: { type: "number" },
                  confidence: { type: "number" },
                  exposure_current: { type: "number" },
                  exposure_desired: { type: "number" },
                  relationship: { type: "string" },
                  category: { type: "string" },
                  last_updated: { type: "string" },
                },
                required: ["id", "type", "name", "description"],
                additionalProperties: false,
              },
            },
            remove: {
              type: "array",
              description: "Duplicates to remove. Each must reference its canonical record via replaced_by.",
              items: {
                type: "object",
                properties: {
                  to_be_removed: { type: "string" },
                  replaced_by: { type: "string" },
                },
                required: ["to_be_removed", "replaced_by"],
                additionalProperties: false,
              },
            },
            add: {
              type: "array",
              description: "New records to create. Only when merging reveals a missing concept.",
              items: {
                type: "object",
                properties: {
                  type: { type: "string", enum: ["topic", "person", "trait"] },
                  name: { type: "string" },
                  description: { type: "string" },
                  sentiment: { type: "number" },
                  strength: { type: "number" },
                  confidence: { type: "number" },
                  exposure_current: { type: "number" },
                  exposure_desired: { type: "number" },
                  relationship: { type: "string" },
                  category: { type: "string" },
                },
                required: ["type", "name", "description"],
                additionalProperties: false,
              },
            },
          },
          required: ["update", "remove", "add"],
          additionalProperties: false,
        },
        runtime: "any",
        builtin: true,
        enabled: true,
        is_submit: true,
        max_calls_per_interaction: 1,
        created_at: now,
    });

    // --- Reconcile pass: prune stale tool references from persona tool lists ---
    // Build manifest of all tool IDs currently in state (everything seeded above).
    const manifestIds = new Set(stateManager.tools_getAll().map(t => t.id));

    for (const persona of stateManager.persona_getAll()) {
      if (!persona.tools?.length) continue;
      const pruned = persona.tools.filter(id => manifestIds.has(id));
      if (pruned.length !== persona.tools.length) {
        const removed = persona.tools.length - pruned.length;
        stateManager.persona_update(persona.id, { tools: pruned });
        console.log(`[Processor] Pruned ${removed} stale tool reference(s) from persona "${persona.display_name}"`);
      }
    }
}
