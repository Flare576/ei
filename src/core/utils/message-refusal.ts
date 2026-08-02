/**
 * Browser-safe terminal-refusal classification for the builtin `fetch_message`
 * tool (Wave 1 quote-attestation review, finding I3, round 2).
 *
 * Mirrors three of `resolveExternalMessage`'s (`src/cli/retrieval.ts`) refusal
 * branches — Slack, imported-document, and generated-document sources — plus
 * its malformed room-persona-primary-message branch, WITHOUT importing that
 * Node-oriented module. `resolveExternalMessage` dynamically loads five
 * external-integration readers (OpenCode/Claude Code/Cursor/Codex/Pi),
 * several of which touch Node `fs`/SQLite and have no business in the Web
 * bundle — see the review's explicit repair constraint. Every check here is
 * either pure string parsing (`parseMessageId`, itself dependency-free) or a
 * check against message data the caller already has in memory — no I/O, no
 * imports beyond `message-id.js`.
 *
 * Used by the builtin `fetch_message` executor (`tools/builtin/fetch-message.ts`)
 * on BOTH runtime registrations (TUI and browser), called before any local
 * persona/room scan, so the three explicitly-refused classes are
 * indistinguishable by runtime: TUI additionally gets the full resolver
 * afterward for genuine external-integration sources this classifier does
 * not (and, being browser-safe, must not) attempt to resolve.
 *
 * Reason strings intentionally match `resolveExternalMessage`'s wording
 * verbatim, so a caller sees an identical refusal regardless of which path
 * produced it.
 */

import { parseMessageId } from "./message-id.js";

/** Structurally identical to retrieval.ts's `ResolverRefusal` — declared independently so this module never imports src/cli/retrieval.ts. */
export interface TerminalRefusal {
  refused: true;
  reason: string;
}

/**
 * Generated documents predate the qualified-id scheme and use a literal
 * `generate:document:${slug}:${uuid}` id `parseMessageId` cannot classify
 * via `ParsedMessageId.integration` (it has no "generate" branch — see
 * message-id.ts). Recognized here by prefix instead, same workaround
 * `resolveExternalMessage` uses for this one legacy id shape.
 */
const GENERATED_DOCUMENT_PREFIX = "generate:document:";

/**
 * Classifies a message id as one of the three refused-by-format origins —
 * Slack, imported document, or generated document. Returns `null` for any
 * other shape, including a genuine external-integration id or a plain local
 * `ei:<uuid>` id: `null` here means "not one of these three formats," not
 * "resolvable" — the caller falls through to its resolver (if any) or local
 * scan exactly as it would for any other unclassified id.
 */
export function classifyRefusedMessageId(id: string): TerminalRefusal | null {
  const parsed = parseMessageId(id);

  if (parsed.integration === "slack") {
    return {
      refused: true,
      reason: `Message ${id} originates from a Slack import; Slack sources are not independently resolvable/attestable.`,
    };
  }

  if (parsed.integration === "import") {
    return {
      refused: true,
      reason: `Message ${id} originates from an imported document; document sources are not independently resolvable/attestable.`,
    };
  }

  if (id.startsWith(GENERATED_DOCUMENT_PREFIX)) {
    return {
      refused: true,
      reason: `Message ${id} originates from a generated document; document sources are not independently resolvable/attestable.`,
    };
  }

  return null;
}

/** The minimal shape this classifier needs from a room message — a structural subset of RoomMessage, declared locally so this module doesn't need to import core/types to stay minimal. */
export interface RoomPrimaryMessageShape {
  id: string;
  role: string;
  persona_id?: string;
}

/**
 * Classifies a room message as the malformed room-persona-primary shape:
 * `role: "persona"` with no `persona_id` at all, so no speaker identity can
 * be resolved for it. Mirrors `resolveRoomSpeaker`'s refusal branch in
 * retrieval.ts, without needing a resolver — every field this needs is
 * already on the message the builtin executor's own room scan just found.
 * Distinct from an orphaned `persona_id` (present, but the PersonaEntity was
 * deleted): that case still resolves with a "Participant" display fallback
 * and is NOT refused.
 */
export function classifyMalformedRoomPrimary(message: RoomPrimaryMessageShape): TerminalRefusal | null {
  if (message.role === "persona" && !message.persona_id) {
    return {
      refused: true,
      reason: `Room message ${message.id} has role "persona" but no persona_id; cannot resolve a speaker identity for this record.`,
    };
  }
  return null;
}
