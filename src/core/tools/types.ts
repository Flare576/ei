/**
 * Tool execution types — Phase 2, tool calling infrastructure.
 * ToolDefinition (data model) lives in src/core/types.ts.
 */

/** A single tool call the LLM wants to make (from the API response). */
export interface ToolCall {
  id: string;           // call_abc123 — must be echoed back in tool result message
  name: string;         // snake_case tool name ("web_search", "read_memory")
  arguments: Record<string, unknown>;  // Parsed from JSON string in the API response
}

/** Result of executing a tool call. */
export interface ToolResult {
  tool_call_id: string;
  name: string;
  result: string;       // JSON-serialized result, or error message
  error: boolean;       // true = catastrophic failure (network, 5xx); false = success or empty
}

/** Executor interface — each builtin and user tool implements this. */
export interface ToolExecutor {
  /** Tool machine name — must match ToolDefinition.name exactly. */
  name: string;
  /** Execute the tool. Returns a result string (JSON or plain text). Throws on unrecoverable error. */
  execute(args: Record<string, unknown>, config?: Record<string, string>): Promise<string>;
}
