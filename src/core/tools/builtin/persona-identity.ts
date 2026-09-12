import type { ToolExecutor } from "../types.js";
import type { PersonaEntity, PersonaTrait, PersonaTopic } from "../../types.js";

type GetPersona = (id: string) => PersonaEntity | null;
/** Synchronous write — used by edit_trait/edit_topic, which must never trigger the
 * description-embedding recompute (R3/AT3). Mirrors persona-notes.ts's UpdatePersona. */
type UpdatePersonaSync = (id: string, updates: Partial<PersonaEntity>) => boolean;
/** Async write — used by update_description, which reuses persona-manager.ts's
 * updatePersona (directly or via Processor.updatePersona) so the existing
 * description-embedding recompute path fires exactly as it already does (D3). */
type UpdatePersonaAsync = (id: string, updates: Partial<PersonaEntity>) => Promise<void>;

function rejection(message: string): string {
  return JSON.stringify({ error: message });
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.length > 0;
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

// =============================================================================
// get_my_identity — read-only
// =============================================================================

export function createGetMyIdentityExecutor(getPersona: GetPersona): ToolExecutor {
  return {
    name: "get_my_identity",

    async execute(_args: Record<string, unknown>, config?: Record<string, string>): Promise<string> {
      const personaId = config?.persona_id ?? "";
      if (!personaId) {
        return rejection("Tool misconfigured: missing persona_id");
      }

      const persona = getPersona(personaId);
      if (!persona) {
        return rejection("Persona not found");
      }

      return JSON.stringify({
        short_description: persona.short_description ?? "",
        long_description: persona.long_description ?? "",
        traits: persona.traits ?? [],
        topics: persona.topics ?? [],
      });
    },
  };
}

// =============================================================================
// edit_trait — add / remove / update, synchronous, no embedding recompute
// =============================================================================

export function createEditTraitExecutor(getPersona: GetPersona, updatePersona: UpdatePersonaSync): ToolExecutor {
  return {
    name: "edit_trait",

    async execute(args: Record<string, unknown>, config?: Record<string, string>): Promise<string> {
      const personaId = config?.persona_id ?? "";
      if (!personaId) {
        return rejection("Tool misconfigured: missing persona_id");
      }

      const action = args.action;
      if (action !== "add" && action !== "remove" && action !== "update") {
        return rejection('action must be one of "add", "remove", "update"');
      }

      const persona = getPersona(personaId);
      if (!persona) {
        return rejection("Persona not found");
      }

      const traits = [...(persona.traits ?? [])];
      const now = new Date().toISOString();

      if (action === "add") {
        const { name, description, sentiment } = args;
        if (!isNonEmptyString(name)) return rejection("Missing required argument: name");
        if (typeof description !== "string") return rejection("Missing required argument: description");
        if (!isFiniteNumber(sentiment)) return rejection("Missing required argument: sentiment");

        const trait: PersonaTrait = {
          id: crypto.randomUUID(),
          name,
          description,
          sentiment,
          last_updated: now,
        };
        if (isFiniteNumber(args.strength)) trait.strength = args.strength;

        traits.push(trait);
        updatePersona(personaId, { traits });
        return JSON.stringify({ added: true, trait });
      }

      const id = typeof args.id === "string" ? args.id : "";
      if (!id) return rejection("Missing required argument: id");
      const index = traits.findIndex((t) => t.id === id);
      if (index === -1) return rejection(`No trait with id ${id}`);

      if (action === "remove") {
        traits.splice(index, 1);
        updatePersona(personaId, { traits });
        return JSON.stringify({ removed: true, id });
      }

      // action === "update"
      const existing = traits[index];
      const updated: PersonaTrait = { ...existing };
      let changed = false;

      if (args.name !== undefined) {
        if (!isNonEmptyString(args.name)) return rejection("name must be a non-empty string");
        updated.name = args.name;
        changed = true;
      }
      if (args.description !== undefined) {
        if (typeof args.description !== "string") return rejection("description must be a string");
        updated.description = args.description;
        changed = true;
      }
      if (args.sentiment !== undefined) {
        if (!isFiniteNumber(args.sentiment)) return rejection("sentiment must be a number");
        updated.sentiment = args.sentiment;
        changed = true;
      }
      if (args.strength !== undefined) {
        if (!isFiniteNumber(args.strength)) return rejection("strength must be a number");
        updated.strength = args.strength;
        changed = true;
      }

      if (!changed) return rejection("update requires at least one field to change");

      updated.last_updated = now;
      traits[index] = updated;
      updatePersona(personaId, { traits });
      return JSON.stringify({ updated: true, trait: updated });
    },
  };
}

// =============================================================================
// edit_topic — add / remove / update, synchronous, no embedding recompute
// =============================================================================

export function createEditTopicExecutor(getPersona: GetPersona, updatePersona: UpdatePersonaSync): ToolExecutor {
  return {
    name: "edit_topic",

    async execute(args: Record<string, unknown>, config?: Record<string, string>): Promise<string> {
      const personaId = config?.persona_id ?? "";
      if (!personaId) {
        return rejection("Tool misconfigured: missing persona_id");
      }

      const action = args.action;
      if (action !== "add" && action !== "remove" && action !== "update") {
        return rejection('action must be one of "add", "remove", "update"');
      }

      const persona = getPersona(personaId);
      if (!persona) {
        return rejection("Persona not found");
      }

      const topics = [...(persona.topics ?? [])];
      const now = new Date().toISOString();

      if (action === "add") {
        const { name, perspective, approach, personal_stake, sentiment, exposure_current, exposure_desired } = args;
        if (!isNonEmptyString(name)) return rejection("Missing required argument: name");
        if (typeof perspective !== "string") return rejection("Missing required argument: perspective");
        if (typeof approach !== "string") return rejection("Missing required argument: approach");
        if (typeof personal_stake !== "string") return rejection("Missing required argument: personal_stake");
        if (!isFiniteNumber(sentiment)) return rejection("Missing required argument: sentiment");
        if (!isFiniteNumber(exposure_current)) return rejection("Missing required argument: exposure_current");
        if (!isFiniteNumber(exposure_desired)) return rejection("Missing required argument: exposure_desired");

        const topic: PersonaTopic = {
          id: crypto.randomUUID(),
          name,
          perspective,
          approach,
          personal_stake,
          sentiment,
          exposure_current,
          exposure_desired,
          last_updated: now,
        };

        topics.push(topic);
        updatePersona(personaId, { topics });
        return JSON.stringify({ added: true, topic });
      }

      const id = typeof args.id === "string" ? args.id : "";
      if (!id) return rejection("Missing required argument: id");
      const index = topics.findIndex((t) => t.id === id);
      if (index === -1) return rejection(`No topic with id ${id}`);

      if (action === "remove") {
        topics.splice(index, 1);
        updatePersona(personaId, { topics });
        return JSON.stringify({ removed: true, id });
      }

      // action === "update"
      const existing = topics[index];
      const updated: PersonaTopic = { ...existing };
      let changed = false;

      if (args.name !== undefined) {
        if (!isNonEmptyString(args.name)) return rejection("name must be a non-empty string");
        updated.name = args.name;
        changed = true;
      }
      if (args.perspective !== undefined) {
        if (typeof args.perspective !== "string") return rejection("perspective must be a string");
        updated.perspective = args.perspective;
        changed = true;
      }
      if (args.approach !== undefined) {
        if (typeof args.approach !== "string") return rejection("approach must be a string");
        updated.approach = args.approach;
        changed = true;
      }
      if (args.personal_stake !== undefined) {
        if (typeof args.personal_stake !== "string") return rejection("personal_stake must be a string");
        updated.personal_stake = args.personal_stake;
        changed = true;
      }
      if (args.sentiment !== undefined) {
        if (!isFiniteNumber(args.sentiment)) return rejection("sentiment must be a number");
        updated.sentiment = args.sentiment;
        changed = true;
      }
      if (args.exposure_current !== undefined) {
        if (!isFiniteNumber(args.exposure_current)) return rejection("exposure_current must be a number");
        updated.exposure_current = args.exposure_current;
        changed = true;
      }
      if (args.exposure_desired !== undefined) {
        if (!isFiniteNumber(args.exposure_desired)) return rejection("exposure_desired must be a number");
        updated.exposure_desired = args.exposure_desired;
        changed = true;
      }

      if (!changed) return rejection("update requires at least one field to change");

      updated.last_updated = now;
      topics[index] = updated;
      updatePersona(personaId, { topics });
      return JSON.stringify({ updated: true, topic: updated });
    },
  };
}

// =============================================================================
// update_description — short/long description, reuses persona-manager.ts's
// updatePersona so the existing embedding-recompute path fires (D3/R3/AT3).
// =============================================================================

export function createUpdateDescriptionExecutor(
  getPersona: GetPersona,
  updatePersonaAsync: UpdatePersonaAsync
): ToolExecutor {
  return {
    name: "update_description",

    async execute(args: Record<string, unknown>, config?: Record<string, string>): Promise<string> {
      const personaId = config?.persona_id ?? "";
      if (!personaId) {
        return rejection("Tool misconfigured: missing persona_id");
      }

      const persona = getPersona(personaId);
      if (!persona) {
        return rejection("Persona not found");
      }

      const hasShort = typeof args.short_description === "string";
      const hasLong = typeof args.long_description === "string";
      if (!hasShort && !hasLong) {
        return rejection("At least one of short_description or long_description is required");
      }

      const updates: Partial<PersonaEntity> = {};
      if (hasShort) updates.short_description = args.short_description as string;
      if (hasLong) updates.long_description = args.long_description as string;

      await updatePersonaAsync(personaId, updates);
      return JSON.stringify({ updated: true, ...updates });
    },
  };
}
