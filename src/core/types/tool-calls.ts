/**
 * EI V1 tools-ran/no-reply fallback constant
 *
 * Browser-safe leaf module: no imports at all. Must never import a Node
 * built-in, processor, queue-processor, a handler, or a barrel (directly or
 * transitively) — both frontends import this through src/core/types.ts.
 */

/**
 * `silence_reason` value of the 1:1 tools-ran/no-reply fallback row (a turn
 * where the persona ran tools but produced no reply). Written by the capture
 * path; the Web and TUI compare against it by equality.
 */
export const TOOLS_RAN_NO_REPLY_SILENCE_REASON = "tools_ran_no_reply";
