import type { ToolExecutor } from "../types.js";
import { stripControlChars } from "../../utils/message-refusal.js";
import type { EmergentSignal } from "../../types.js";

/** The two calling-persona-scoped state writes `resolve_signal` can
 * trigger — bound instance methods of `StateManager` (Bolt 003 D2). */
type SignalConfirm = (personaId: string, signalId: string, actor: string) => EmergentSignal;
type SignalDismiss = (personaId: string, signalId: string, actor: string) => EmergentSignal;

/** `resolve_signal`'s own declared schema (Bolt 003 D2, R1/AT1) — `id`
 * and `action` only. Anything else is an unrecognized field. */
const RESOLVE_SIGNAL_ALLOWED_KEYS: readonly string[] = ["id", "action"];

/**
 * Native `resolve_signal` executor (Bolt 003 D2/D4, R2/R4, AT2/AT4). A
 * direct in-process write bound to the calling persona via its own
 * registered tool configuration (`config.persona_id`, injected the same
 * trust-boundary way `add_note`/`clear_note` bind their own persona —
 * never a caller-supplied identifier) — never routed through the
 * CLI/MCP correction-queue mechanism (D2). Because `signalConfirm`/
 * `signalDismiss` only ever search the CALLING persona's own two signal
 * buckets (never another persona's), this executor cannot resolve or
 * affect a signal belonging to a different persona regardless of what
 * id it's given (AT2).
 *
 * Follows the same non-throwing rejection convention `add_note`/
 * `clear_note` already established (D19/D4): every failure — a
 * misconfigured tool, an unrecognized field, a missing/invalid
 * argument, or a refusal from `signal_confirm`/`signal_dismiss` (signal
 * not found, already terminal) — is returned as a plain result string,
 * never thrown, so the shared `executeToolCalls` wrapper always marks
 * the result `error: false` (AT1). Never accepts `delta` or any other
 * field outside `id`/`action` (R1/AT1) — a call carrying one is
 * rejected outright, with zero state change, before either state write
 * is attempted.
 */
export function createResolveSignalExecutor(signalConfirm: SignalConfirm, signalDismiss: SignalDismiss): ToolExecutor {
  return {
    name: "resolve_signal",

    async execute(args: Record<string, unknown>, config?: Record<string, string>): Promise<string> {
      if (args === null || typeof args !== "object" || Array.isArray(args)) {
        return JSON.stringify({ error: "Arguments must be a JSON object" });
      }

      const personaId = config?.persona_id ?? "";
      if (!personaId) {
        return JSON.stringify({ error: "Tool misconfigured: missing persona_id" });
      }

      const extraKeys = Object.keys(args).filter((key) => !RESOLVE_SIGNAL_ALLOWED_KEYS.includes(key));
      if (extraKeys.length > 0) {
        return JSON.stringify({ error: `unrecognized field(s) present: ${extraKeys.join(", ")}` });
      }

      const id = typeof args.id === "string" ? args.id.trim() : "";
      if (!id) {
        return JSON.stringify({ error: "Missing required argument: id" });
      }
      const action = args.action;
      if (action !== "confirm" && action !== "dismiss") {
        return JSON.stringify({ error: 'action must be "confirm" or "dismiss"' });
      }

      // Diagnostic log only after every shape/value check above has passed
      // (S3) -- `id` is confirmed non-empty and `action` one of two literal
      // values, but stripControlChars still guards `id` (and `personaId`,
      // defense-in-depth) against a control/ANSI-bearing value smuggled
      // inside an otherwise well-formed string, same as the sibling
      // fetch_message executor's `logId` precedent.
      console.log(`[resolve_signal] persona="${stripControlChars(personaId)}" id="${stripControlChars(id)}" action="${action}"`);

      try {
        const signal = action === "confirm"
          ? signalConfirm(personaId, id, personaId)
          : signalDismiss(personaId, id, personaId);
        const resolvedId = stripControlChars(signal.id);
        console.log(`[resolve_signal] ${action}ed signal ${resolvedId} -> status=${signal.status}`);
        return JSON.stringify({ resolved: true, id: resolvedId, status: signal.status, action });
      } catch (err) {
        // The underlying PersonaState refusal (not found / already
        // terminal) embeds the caller-supplied `id` verbatim in its own
        // message; strip control/ANSI bytes before it reaches a log or the
        // returned result (S3) -- the same sanitize-before-echo contract
        // src/core/entity-schemas.ts establishes for unrecognized-key
        // output.
        const rawMessage = err instanceof Error ? err.message : String(err);
        const message = stripControlChars(rawMessage);
        console.warn(`[resolve_signal] refused: ${message}`);
        return JSON.stringify({ error: message });
      }
    },
  };
}
